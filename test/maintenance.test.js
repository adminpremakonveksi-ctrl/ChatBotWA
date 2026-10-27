import './setup.js';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { replies } from '../src/bot/replies.js';

import { Bot } from '../src/bot/bot.js';
import { classifyWithRules } from '../src/bot/classify-rules.js';
import { media } from '../src/bot/media.js';
import { simulate } from '../src/bot/simulator.js';
import * as store from '../src/bot/store.js';
import { config } from '../src/config.js';
import { all, run } from '../src/db.js';
import { backup, buildRecap } from '../src/maintenance.js';

const SINCE = '2000-01-01 00:00:00';

test('backup copies the database and keeps only the newest copies', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-backup-'));
    for (const day of ['2026-01-01', '2026-01-02', '2026-01-03']) fs.writeFileSync(path.join(dir, `chatbot-${day}.sqlite`), 'old');

    const { file, removed } = await backup(dir, 2);

    assert.ok(fs.statSync(file).size > 0);
    assert.equal(removed, 2);
    assert.equal(fs.readdirSync(dir).length, 2);
});

test('prune deletes chat text past the retention window', () => {
    run(`INSERT INTO message_log (session_key, jid, direction, text, created_at) VALUES ('utama', 'old@s.whatsapp.net', 'in', 'lama', '2000-01-01 00:00:00')`);
    store.logMessage({ sessionKey: 'utama', jid: 'new@s.whatsapp.net', direction: 'in', text: 'baru' });

    const { messages } = store.prune(90);

    assert.equal(messages, 1);
    assert.deepEqual(all(`SELECT text FROM message_log WHERE jid IN ('old@s.whatsapp.net', 'new@s.whatsapp.net')`).map((r) => r.text), ['baru']);
});

test('morning recap lists overnight customers CS has not answered yet', () => {
    run('DELETE FROM conversations');
    store.saveConversation('utama', '628111@s.whatsapp.net', { step: 'handed_over', name: 'Budi', origin: 'Jogja', product: 'hoodie', handover_reason: 'alur selesai' });
    store.logMessage({ sessionKey: 'utama', jid: '628111@s.whatsapp.net', direction: 'in', text: 'sekitar 40 pcs' });
    store.saveConversation('utama', '628222@s.whatsapp.net', { step: 'handed_over', name: 'Rina', handover_reason: 'CS membalas' });
    store.saveConversation('utama', '123@lid', { step: 'awaiting_design', product: 'kaos' });

    const text = buildRecap(SINCE);

    assert.match(text, /2 pelanggan/);
    assert.match(text, /Kak Budi \(Jogja\) · Hoodie/);
    assert.match(text, /alur selesai, menunggu CS/);
    assert.match(text, /wa\.me\/628111/);
    assert.match(text, /"sekitar 40 pcs"/);
    assert.match(text, /ditanya desain, belum menjawab/);
    assert.match(text, /nomor disembunyikan/);
    assert.doesNotMatch(text, /Rina/, 'already answered by CS');
});

test('no recap when nobody chatted', () => {
    run('DELETE FROM conversations');
    assert.equal(buildRecap(SINCE), null);
});

test('the bot never greets the recap recipients as customers', async () => {
    config.recap.to = ['628999'];

    try {
        const sent = [];
        const bot = new Bot({ classify: async (input) => classifyWithRules(input), isActive: () => true, debounceMs: 5 });
        const wa = { newMessageId: () => `X${sent.length}`, send: async (jid, action) => sent.push(action) };

        bot.onIncoming('utama', wa, { jid: '628999@s.whatsapp.net', id: 'r1', text: 'ok makasih' });
        await new Promise((r) => setTimeout(r, 20));
        await bot.drain();

        assert.equal(sent.length, 0);
    } finally {
        config.recap.to = [];
    }
});

test('media checklist reports what is missing', () => {
    const items = media.checklist();
    const byFile = Object.fromEntries(items.map((i) => [i.expected.split('.')[0], i.ok]));

    assert.equal(byFile['katalog/jersey'], true);
    assert.equal(byFile['size-chart/kaos'], true);
    assert.equal(byFile['size-chart/hoodie'], false);
    assert.ok(!('size-chart/topi' in byFile), 'no size chart expected for hats');
});

test('simulator walks the same flow without WhatsApp', async () => {
    const first = await simulate('t1', { text: 'halo kak saya Budi dari Jogja mau bikin jersey' });
    assert.equal(first.intent, 'product');
    assert.equal(first.step, 'awaiting_quantity');
    assert.deepEqual(first.replies.map((r) => r.type), ['text', 'file', 'text']);

    const second = await simulate('t1', { text: '24 pcs' });
    assert.equal(second.step, 'handed_over');
    assert.equal(second.replies.at(-1).type, 'handover');

    const sizeChart = await simulate('t2', { text: 'size chart hoodie dong' });
    assert.ok(!sizeChart.replies.some((r) => r.type === 'handover'), 'a missing size chart does not close the chat');
    assert.ok(sizeChart.replies.some((r) => r.text === replies.sizeChartMissing('Hoodie')));
});

test('the morning recap carries what the AI chat collected: each answered item, the AI note, not the summary twice', () => {
    run('DELETE FROM conversations');
    store.saveConversation('utama', '628333@s.whatsapp.net', {
        step: 'handed_over',
        name: 'Haikal',
        product: 'jas-almamater',
        handover_reason: 'data pesanan lengkap',
        order_info: JSON.stringify({ produk: 'jas-almamater', jawaban: { jumlah: '40 pcs', warna: 'navy', 'rincian ukuran': 'menyusul' } }),
        notes: JSON.stringify(['Pesanan Jas Almamater · jumlah: 40 pcs · warna: navy', 'Untuk himpunan, acara bulan depan']),
    });

    const text = buildRecap(SINCE);
    assert.match(text, /- jumlah: 40 pcs/);
    assert.match(text, /- rincian ukuran: menyusul/);
    assert.match(text, /📝 Untuk himpunan, acara bulan depan/);
    assert.doesNotMatch(text, /Pesanan Jas Almamater ·/, 'the one-line summary is not repeated');
});
