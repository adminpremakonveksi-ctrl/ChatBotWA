import './setup.js';

import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { handoverBrief } from '../src/bot/brief.js';
import { chatTurn } from '../src/bot/chat.js';
import { listProducts } from '../src/bot/products.js';
import { closeUnanswered, listUnanswered, openUnansweredCount, recordUnanswered } from '../src/bot/unanswered.js';
import { config } from '../src/config.js';
import { get } from '../src/db.js';
import { migrationIds } from '../src/migrations.js';

const json = { 'Content-Type': 'application/json' };

test('the unanswered table has its own numbered migration', () => {
    assert.ok(migrationIds().includes('025_unanswered_questions'));
    assert.ok(get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'unanswered'`));
});

test('the same question is counted, not listed twice, and sorted by how often it comes', () => {
    recordUnanswered({ question: 'Bisa sablon glow in the dark?', missing: 'teknik tidak ada di data', product: 'kaos' });
    recordUnanswered({ question: '  bisa SABLON glow in the dark ', missing: '' });
    recordUnanswered({ question: 'Ada kemeja anak?', missing: 'produk tidak ada' });

    const items = listUnanswered();
    assert.equal(items.length, 2);
    assert.equal(items[0].times, 2);
    assert.equal(items[0].missing, 'teknik tidak ada di data');
    assert.equal(openUnansweredCount(), 2);
    assert.equal(recordUnanswered({ question: '   ' }), null);
});

test('answered and dismissed questions leave the list; a repeat of an answered one comes back', () => {
    const [first, second] = listUnanswered();

    closeUnanswered(first.id, 'done');
    closeUnanswered(second.id, 'dismissed');
    assert.equal(listUnanswered().length, 0);

    recordUnanswered({ question: first.question });
    assert.deepEqual(listUnanswered().map((i) => i.id), [first.id]);

    recordUnanswered({ question: second.question });
    assert.equal(listUnanswered().some((i) => i.id === second.id), false, 'a dismissed one stays dismissed');

    assert.throws(() => closeUnanswered(first.id, 'hapus'), /Status/);
    assert.throws(() => closeUnanswered(999999, 'done'), /tidak ditemukan/);
});

test('a turn where the AI says it lacks the data carries the question for the list; a normal answer does not', async () => {
    const withKey = async (fn) => {
        const before = config.ollama.apiKey;
        config.ollama.apiKey = 'test-key-1234567890';
        try {
            return await fn();
        } finally {
            config.ollama.apiKey = before;
        }
    };
    const ask = (over) => async () => ({ reply: 'Aku teruskan ke admin ya, Kak', send: [], handover: true, reason: 'tidak_bisa_bantu', note: '', name: '', product: '', answered: [], thought: '', gap: true, missing: 'teknik tidak ada di data', ...over });

    const lacking = await withKey(() => chatTurn({ step: 'chat' }, { text: 'bisa sablon glow in the dark?', who: 'toko|a@s.whatsapp.net' }, { ask: ask({}) }));
    assert.equal(lacking.unanswered.question, 'bisa sablon glow in the dark?');
    assert.equal(lacking.unanswered.missing, 'teknik tidak ada di data');

    const normal = await withKey(() => chatTurn({ step: 'chat' }, { text: 'minimal order berapa?', who: 'toko|b@s.whatsapp.net' }, { ask: ask({ handover: false, reason: '', gap: false, missing: '' }) }));
    assert.equal(normal.unanswered, null);
});

test('the brief names what the customer wants, what is known and what is still missing', () => {
    const product = listProducts().find((p) => p.info.tanya.length >= 2);
    assert.ok(product, 'a seeded product with questions');
    const [first, second] = product.info.tanya;

    const brief = handoverBrief({
        order_info: JSON.stringify({ produk: product.key, jawaban: { [first]: '40 pcs' }, ditanya: second, lain: {}, media_sent: {} }),
        notes: JSON.stringify([`Pesanan ${product.name} · ${first}: 40 pcs`, 'Pelanggan minta pengiriman ke Makassar']),
    });

    assert.match(brief.want, new RegExp(product.name));
    assert.deepEqual(brief.have, [{ hal: first, isi: '40 pcs' }]);
    assert.ok(brief.missing.includes(second));
    assert.equal(brief.note, 'Pelanggan minta pengiriman ke Makassar');

    assert.equal(handoverBrief({ order_info: null, notes: null }), null);
    assert.equal(handoverBrief({ order_info: null, notes: JSON.stringify(['Tanya garansi']) }).want, 'Produk belum disebut');
});

test('a promised-later answer is listed as missing, not as known', () => {
    const product = listProducts().find((p) => p.info.tanya.length >= 1);
    const [first] = product.info.tanya;
    const brief = handoverBrief({ order_info: JSON.stringify({ produk: product.key, jawaban: { [first]: 'menyusul' }, ditanya: null, lain: {}, media_sent: {} }), notes: '[]' });

    assert.deepEqual(brief.have, []);
    assert.ok(brief.missing.includes(first));
});

test('knowledge and conversation routes expose the list, the brief and the close actions', async () => {
    const { app } = await import('../src/index.js');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;

    try {
        recordUnanswered({ question: 'Apakah bisa bordir 3D?', missing: 'tidak ada di data' });
        const listed = await (await fetch(`${base}/knowledge`)).json();
        const item = listed.unanswered.find((i) => i.question === 'Apakah bisa bordir 3D?');
        assert.ok(item);

        const closed = await fetch(`${base}/knowledge/unanswered/${item.id}/done`, { method: 'POST', headers: json, body: '{}' });
        assert.equal(closed.status, 200);
        assert.equal((await closed.json()).unanswered.some((i) => i.id === item.id), false);

        const bad = await fetch(`${base}/knowledge/unanswered/${item.id}/hapus`, { method: 'POST', headers: json, body: '{}' });
        assert.equal(bad.status, 422);

        const detail = await (await fetch(`${base}/conversations/toko/${encodeURIComponent('628111@s.whatsapp.net')}`)).json();
        assert.equal(detail.brief, null);
    } finally {
        server.close();
    }
});

test('the dashboard has the new cards, switches and the phone menu bar stays slim', async () => {
    const fs = await import('node:fs');
    const page = fs.readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');

    for (const marker of ['id="unansweredCard"', 'id="restoreCard"', 'name="alertsOn"', 'name="aiTrim"', 'data-make-test', 'id="chProducts"', 'id="chUnanswered"']) {
        assert.ok(page.includes(marker), marker);
    }
    assert.ok(page.includes('grid-template-rows:auto minmax(0,1fr); align-content:start'), 'the menu bar must not stretch on tall phone screens');
    assert.equal(page.includes('id="chIntents"'), false, 'the intent chart means nothing in AI-only mode');
    assert.equal((page.match(/<aside/g) ?? []).length, 1);
});
