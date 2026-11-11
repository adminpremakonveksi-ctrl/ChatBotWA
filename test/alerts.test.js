import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { GAP_MS, REPEAT_AFTER_MS, actionAlerts, checkAlerts, gapText, resetAlertState } from '../src/alerts.js';
import { config } from '../src/config.js';
import { getSetting, setSetting } from '../src/db.js';
import { latestErrorId, recordError } from '../src/errors.js';
import { currentSettings, updateSettings } from '../src/settings.js';

const KEYS_OUT = 'semua kunci AI sudah dicek satu per satu dan semuanya habis jatahnya';

const fixture = ({ state = 'connected', failSend = false } = {}) => {
    const sent = [];
    const session = { key: 'toko', state };
    const manager = { defaultSession: async () => session };
    const bot = {
        sendNotice: async (key, transport, jid, text, id) => {
            if (failSend) throw new Error('belum tersambung');
            sent.push({ jid, text, id });
        },
    };

    return { manager, bot, sent, session };
};

const reset = () => {
    resetAlertState(latestErrorId());
    setSetting('alert:sent', '{}');
    setSetting('alert:connected_at', '');
    config.recap.to = ['6281234567890', '6289876543210'];
    config.recap.alerts = true;
};

test('only known action-level problems become alerts, once per cause', () => {
    const entry = (message) => {
        recordError({ level: 'error', message });
        return undefined;
    };
    entry(KEYS_OUT);
    entry('kunci AI abc1 ditolak Ollama (401)');
    entry('sesuatu yang belum pernah terjadi');
    entry('Ada versi baru? bot ini belum versi terbaru');
    entry(KEYS_OUT);

    return import('../src/errors.js').then(({ errorsSince }) => {
        const items = actionAlerts(errorsSince(0), {}, Date.now());
        const meanings = items.map((i) => i.meaning);

        assert.equal(new Set(meanings).size, meanings.length);
        assert.ok(meanings.some((m) => /kunci/i.test(m)));
        assert.ok(items.every((i) => i.todo));
        assert.equal(meanings.some((m) => /versi bot yang lebih baru/i.test(m)), false);
    });
});

test('a cause already sent is not sent again before six hours pass', () => {
    const at = Date.now();
    const entries = [{ guide: { level: 'tindak', known: true, push: true, meaning: 'Masalah A', todo: 'Lakukan A' } }];

    assert.equal(actionAlerts(entries, { 'Masalah A': at - 60000 }, at).length, 0);
    assert.equal(actionAlerts(entries, { 'Masalah A': at - REPEAT_AFTER_MS - 1 }, at).length, 1);
});

test('the owner gets one message per number when keys run out, then nothing more for the same cause', async () => {
    reset();
    const { manager, bot, sent } = fixture();
    recordError({ level: 'error', message: KEYS_OUT });

    const first = await checkAlerts({ manager, bot });
    assert.equal(first.sent.length > 0, true);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent.map((s) => s.jid), ['6281234567890@s.whatsapp.net', '6289876543210@s.whatsapp.net']);
    assert.match(sent[0].text, /perlu dicek/);
    assert.match(sent[0].text, /kunci/i);
    assert.notEqual(sent[0].id, sent[1].id);

    recordError({ level: 'error', message: KEYS_OUT });
    const again = await checkAlerts({ manager, bot });
    assert.deepEqual(again.sent, []);
    assert.equal(sent.length, 2);
    assert.ok(getSetting('alert:sent').includes('habis'));
});

test('while WhatsApp is not connected nothing is sent and the problem waits for the next check', async () => {
    reset();
    const offline = fixture({ state: 'connecting' });
    recordError({ level: 'error', message: KEYS_OUT });
    await checkAlerts({ manager: offline.manager, bot: offline.bot });
    assert.equal(offline.sent.length, 0);

    const online = fixture();
    const result = await checkAlerts({ manager: online.manager, bot: online.bot });
    assert.equal(result.sent.length > 0, true);
    assert.equal(online.sent.length, 2);
});

test('a failed send does not mark the problem as reported', async () => {
    reset();
    recordError({ level: 'error', message: KEYS_OUT });
    const broken = fixture({ failSend: true });
    await assert.rejects(checkAlerts({ manager: broken.manager, bot: broken.bot }), /belum tersambung/);
    assert.equal(getSetting('alert:sent'), '{}');

    const fine = fixture();
    await checkAlerts({ manager: fine.manager, bot: fine.bot });
    assert.equal(fine.sent.length, 2);
});

test('a gap longer than ten minutes is reported after reconnecting, a short one is not', async () => {
    reset();
    const { manager, bot, sent } = fixture();
    const at = Date.now();

    setSetting('alert:connected_at', String(at - GAP_MS + 60000));
    await checkAlerts({ manager, bot }, at);
    assert.equal(sent.length, 0);

    setSetting('alert:connected_at', String(at - 95 * 60000));
    const result = await checkAlerts({ manager, bot }, at);
    assert.deepEqual(result.sent, ['terputus']);
    assert.equal(sent.length, 2);
    assert.match(sent[0].text, /sempat tidak tersambung/);
    assert.match(sent[0].text, /1 jam 35 menit/);
    assert.equal(getSetting('alert:connected_at'), String(at));
});

test('the gap text names the length without guessing the cause', () => {
    const text = gapText(Date.now() - 25 * 60000, Date.now());

    assert.match(text, /25 menit/);
    assert.doesNotMatch(text, /listrik|internet mati|rusak/i);
});

test('alerts can be switched off, and without numbers nothing is sent', async () => {
    reset();
    const { manager, bot, sent } = fixture();
    recordError({ level: 'error', message: KEYS_OUT });

    updateSettings({ alertsOn: false });
    assert.equal(currentSettings().alertsOn, false);
    await checkAlerts({ manager, bot });
    assert.equal(sent.length, 0);

    updateSettings({ alertsOn: true });
    config.recap.to = [];
    await checkAlerts({ manager, bot });
    assert.equal(sent.length, 0);

    config.recap.to = ['6281234567890'];
    reset();
});
