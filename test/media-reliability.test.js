import './setup.js';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { chatTurn } from '../src/bot/chat.js';
import { createMedia } from '../src/bot/media.js';
import { updateProduct, getProduct } from '../src/bot/products.js';
import { replies } from '../src/bot/replies.js';
import { decide } from '../src/bot/engine.js';
import { classifyWithRules } from '../src/bot/classify-rules.js';
import { config } from '../src/config.js';
import { Bot } from '../src/bot/bot.js';
import { Session } from '../src/session.js';
import { run } from '../src/db.js';

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const fresh = (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prema-media-regression-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return createMedia(dir);
};
const answer = (extra = {}) => ({ reply: 'Siap Kak.', product: '', send: [], answered: [], handover: false, reason: '', ...extra });
const withAi = async (fn) => {
    const before = config.ollama.apiKey;
    config.ollama.apiKey = 'test-key';
    try { return await fn(); } finally { config.ollama.apiKey = before; }
};

test('an uploaded chart is sent as an actual WhatsApp image followed by measurement guidance, even without AI', async (t) => {
    const media = fresh(t);
    const uploaded = media.save('size-chart:kemeja:reguler', JPG);
    const oldMode = config.bot.mode;
    config.bot.mode = 'ai';
    t.after(() => { config.bot.mode = oldMode; });
    run('DELETE FROM outgoing_queue');
    const bot = new Bot({ media, isActive: () => true });
    const sent = [];
    let id = 0;
    await bot.handle('media-test', { newMessageId: () => `media-test-${++id}`, send: async (jid, action) => sent.push(action) }, '628444@s.whatsapp.net', { texts: ['minta size chart kemeja'], hasImage: false });
    const pictureAt = sent.findIndex((a) => a.type === 'file');
    assert.ok(pictureAt >= 0, 'a text saying it was sent is insufficient');
    assert.equal(sent[pictureAt].file, uploaded);
    assert.deepEqual(Session.content(sent[pictureAt]), { image: { url: uploaded }, mimetype: 'image/jpeg' });
    assert.equal(sent[pictureAt + 1].text, replies.sizeChartNote());
});

test('missing product asks which chart; naming the product next sends its uploaded variant with regular fallback', async (t) => {
    const media = fresh(t);
    media.save('size-chart:kaos:reguler', JPG);
    media.save('size-chart:kaos:oversize', JPG);
    const ask = async () => assert.fail('a chart request must not require AI');
    const first = await chatTurn({ step: 'chat' }, { text: 'minta size chart' }, { media, ask });
    assert.equal(first.patch.step, 'awaiting_size_chart_product');
    assert.equal(first.actions[0].text, replies.sizeChartWhich());
    const next = await chatTurn({ step: 'chat', ...first.patch }, { text: 'kaos oversize' }, { media, ask });
    assert.equal(next.actions[0].variant, 'oversize');
    const fallback = await chatTurn({ step: 'chat', product: 'kaos' }, { text: 'minta size chart boxy' }, { media, ask });
    assert.equal(fallback.actions[0].variant, 'reguler');
    const missing = await chatTurn({ step: 'chat', product: 'hoodie' }, { text: 'minta size chart' }, { media, ask });
    assert.equal(missing.actions[0].text, replies.sizeChartMissing('Hoodie'));
    assert.ok(!missing.actions.some((a) => a.type === 'media'), 'never substitutes another product\'s chart');
});

test('AI forgetting attachments cannot skip the chart before asking for size details', async (t) => {
    const media = fresh(t);
    media.save('size-chart:kaos:reguler', JPG);
    const original = getProduct('kaos').info;
    updateProduct('kaos', { info: { tanya: ['warna', 'rincian ukuran'] } });
    t.after(() => updateProduct('kaos', { info: original }));
    const conv = { step: 'chat', order_info: JSON.stringify({ produk: 'kaos', jawaban: {}, ditanya: 'warna' }) };
    const turn = await withAi(() => chatTurn(conv, { text: 'navy', who: 'media-sizes' }, { media, ask: async () => answer({ reply: 'Warna navy saya catat, Kak. Rincian ukurannya berapa?', answered: [{ hal: 'warna', isi: 'navy' }] }) }));
    assert.equal(turn.actions[0].kind, 'size-chart');
    assert.equal(turn.actions[1].text, replies.sizeChartNote());
    assert.ok(!turn.actions.some((a) => /Rincian ukurannya berapa/.test(a.text ?? '')));
    assert.equal(JSON.parse(turn.patch.order_info).ditanya, 'rincian ukuran');
    assert.equal(turn.patch.step, 'chat', 'collecting sizes can take days');
    const follow = await withAi(() => chatTurn({ ...conv, ...turn.patch }, { text: 'ukuran menyusul', who: 'media-sizes' }, { media, ask: async () => answer({ answered: [{ hal: 'rincian ukuran', isi: 'menyusul' }] }) }));
    assert.ok(!follow.actions.some((a) => a.kind === 'size-chart'), 'does not spam the same chart every turn');
});

test('the scripted mode also sends the chart before the size question', (t) => {
    const media = fresh(t);
    media.save('size-chart:kaos:reguler', JPG);
    const old = getProduct('kaos').questions;
    updateProduct('kaos', { questions: ['Ukuran apa saja ya Kak?'] });
    t.after(() => updateProduct('kaos', { questions: old }));
    const turn = decide({ step: 'awaiting_quantity', product: 'kaos' }, classifyWithRules({ text: '40 pcs', step: 'awaiting_quantity' }), media);
    assert.equal(turn.actions[0].kind, 'size-chart');
    assert.equal(turn.actions[1].text, replies.sizeChartNote());
    assert.equal(turn.actions[2].text, 'Ukuran apa saja ya Kak?');
});

test('a product catalog goes out automatically when AI forgets kirim, and is not repeated next turn', async (t) => {
    const media = fresh(t);
    media.save('katalog:jersey', JPG);
    const first = await withAi(() => chatTurn({ step: 'chat' }, { text: 'mau bikin jersey', who: 'media-catalog' }, { media, ask: async () => answer() }));
    assert.equal(first.actions[0].kind, 'katalog');
    assert.equal(first.actions.filter((a) => a.kind === 'katalog').length, 1);
    const next = await withAi(() => chatTurn({ step: 'chat', ...first.patch }, { text: '40 pcs', who: 'media-catalog' }, { media, ask: async () => answer() }));
    assert.ok(!next.actions.some((a) => a.kind === 'katalog'));
});
