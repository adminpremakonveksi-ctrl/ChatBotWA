import './setup.js';

import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { markKey, pickKey, resetKeyStates } from '../src/ai-keys.js';
import { updateAiSettings } from '../src/ai-settings.js';
import { PROBE_EVERY_MS, healAi, resetProbe } from '../src/ai-recovery.js';
import { loadConversation, saveConversation } from '../src/bot/store.js';
import { run } from '../src/db.js';
import { listHealed } from '../src/heal-log.js';

const KEYS = ['heal-key-0000000001', 'heal-key-0000000002'];
const answered = { ok: true, status: 200, json: async () => ({ message: { content: '{"ok":true}' } }) };
const refused = (status) => ({ ok: false, status, json: async () => ({ error: 'Add usage credits' }) });
const BASE = Date.now();
const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const failedChat = (jid) => saveConversation('toko', jid, { step: 'handed_over', handover_reason: 'AI tidak dapat menjawab: Ollama 402', handed_over_at: stamp() });

const fresh = () => {
    updateAiSettings({ key: KEYS[0], key2: KEYS[1], key3: '', key4: '' });
    resetKeyStates();
    resetProbe();
    run(`DELETE FROM activity_log WHERE source = 'pemulihan'`);
    run(`DELETE FROM conversations`);
};

test.afterEach(() => {
    updateAiSettings({ key: '', key2: '', key3: '', key4: '' });
    resetKeyStates();
});

test('with nothing wrong the AI is not tested and no quota is used', async () => {
    fresh();
    let calls = 0;
    const result = await healAi({ fetchImpl: async () => { calls++; return answered; } });

    assert.equal(result.probe, 'tidak perlu');
    assert.equal(calls, 0);
});

test('chats handed over by a failing AI are tested first and returned only when the AI really answers', async () => {
    fresh();
    failedChat('6281@s.whatsapp.net');

    const down = await healAi({ fetchImpl: async () => refused(402), now: BASE });
    assert.equal(down.probe, 'gagal');
    assert.equal(down.released, 0);
    assert.equal(loadConversation('toko', '6281@s.whatsapp.net').step, 'handed_over');

    resetKeyStates();
    const up = await healAi({ fetchImpl: async () => answered, now: BASE + PROBE_EVERY_MS + 1 });
    assert.equal(up.probe, 'ok');
    assert.equal(up.released, 1);
    assert.equal(loadConversation('toko', '6281@s.whatsapp.net').step, 'new');
    assert.ok(listHealed(1).some((h) => /dikembalikan ke bot/.test(h.action)));
});

test('the test is not repeated more often than every five minutes', async () => {
    fresh();
    failedChat('6282@s.whatsapp.net');
    let calls = 0;
    const fetchImpl = async () => { calls++; return refused(402); };

    await healAi({ fetchImpl, now: BASE });
    resetKeyStates();
    const again = await healAi({ fetchImpl, now: BASE + 60000 });

    assert.equal(again.probe, 'baru dicek');
    const afterFirst = calls;
    await healAi({ fetchImpl, now: BASE + 120000 });
    assert.equal(calls, afterFirst, 'no new request inside the five minutes');
});

test('while every key is resting nothing is asked', async () => {
    fresh();
    failedChat('6283@s.whatsapp.net');
    markKey(KEYS[0], 402, 'Add usage credits');
    markKey(KEYS[1], 402, 'Add usage credits');
    let calls = 0;

    const result = await healAi({ fetchImpl: async () => { calls++; return answered; } });

    assert.equal(result.probe, 'dilewati');
    assert.equal(calls, 0);
});

test('switching to another key is written to the recovery list in plain words', () => {
    fresh();
    markKey(KEYS[0], 402, 'Add usage credits');

    assert.equal(pickKey().slot, 2);
    assert.ok(listHealed(1).some((h) => h.action === 'Kunci AI 1 tidak bisa dipakai, bot pindah ke kunci 2'));
});

test('the recovery route and the Ringkasan list exist', async () => {
    fresh();
    markKey(KEYS[0], 402, 'x');
    pickKey();

    const { app } = await import('../src/index.js');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');

    try {
        const body = await (await fetch(`http://127.0.0.1:${server.address().port}/heal/summary?hours=24`)).json();
        assert.ok(body.items.length >= 1);
    } finally {
        server.close();
    }

    const fs = await import('node:fs');
    const page = fs.readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');
    assert.ok(page.includes('id="healList"'));
});
