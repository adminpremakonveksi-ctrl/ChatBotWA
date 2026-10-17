import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { describeRequest, listActivity, pruneActivity, recordActivity } from '../src/activity.js';
import { Bot } from '../src/bot/bot.js';
import { classifyWithRules } from '../src/bot/classify-rules.js';
import { run } from '../src/db.js';

test('console changes are described in words, never with their values', () => {
    assert.equal(describeRequest('PUT', '/templates/clarify', { text: 'rahasia' }), 'Mengubah template clarify');
    assert.equal(describeRequest('POST', '/products', { name: 'Celana Formal' }), 'Menambah produk "Celana Formal"');
    assert.equal(describeRequest('PUT', '/settings', { botName: 'Mawar', maxMisses: 3 }), 'Mengubah Pengaturan (botName, maxMisses)');

    const ai = describeRequest('PUT', '/ai', { key: 'sk-RAHASIA-123', model: 'gemma4:31b' });
    assert.match(ai, /kunci API/);
    assert.ok(!ai.includes('RAHASIA'), 'the key itself is never written');

    assert.equal(describeRequest('POST', '/sessions/utama/rescan', {}), 'Nomor WhatsApp utama: scan ulang QR');
    assert.equal(describeRequest('PATCH', '/aneh', {}), 'PATCH /aneh', 'unknown routes keep method and path');
});

test('the log lists newest first, filters by source and text, and is pruned', () => {
    run('DELETE FROM activity_log');
    recordActivity({ source: 'dashboard', page: 'Produk', action: 'Membuka halaman Produk' });
    recordActivity({ source: 'dashboard', page: 'Produk', action: 'Menambah produk "Celana Formal"' });
    recordActivity({ source: 'bot', action: 'Pesan dari +62811 dikenali sebagai product (kaos)' });

    assert.deepEqual(listActivity().map((e) => e.action.slice(0, 13)), ['Pesan dari +6', 'Menambah prod', 'Membuka halam']);
    assert.equal(listActivity({ source: 'dashboard' }).length, 2);
    assert.equal(listActivity({ q: 'Celana' }).length, 1);

    run(`UPDATE activity_log SET at = datetime('now', '-200 days') WHERE source = 'bot'`);
    assert.equal(pruneActivity(90), 1);
});

test('what the bot does with a message, and a handover, go to the log', async () => {
    run('DELETE FROM activity_log');
    run('DELETE FROM conversations');
    const bot = new Bot({ classify: async (input) => classifyWithRules(input), media: { links: () => [], files: () => [], has: () => false }, isActive: () => true, debounceMs: 5 });
    const wa = { newMessageId: () => `A${Math.random()}`, send: async () => {} };

    bot.onIncoming('utama', wa, { jid: '628123@s.whatsapp.net', id: 'm1', text: 'mau ngobrol sama admin aja' });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();

    const actions = listActivity({ source: 'bot' }).map((e) => e.action);
    assert.ok(actions.some((a) => /\+628123 dikenali sebagai human/.test(a)));
    assert.ok(actions.some((a) => /Diserahkan ke CS: \+628123/.test(a)));
});
