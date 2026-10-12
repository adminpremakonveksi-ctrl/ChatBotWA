import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWithRules, editDistance } from '../src/bot/classify-rules.js';
import { decide } from '../src/bot/engine.js';
import { addKeyword, customKeywords, removeKeyword } from '../src/bot/keywords.js';
import { replies } from '../src/bot/replies.js';
import { nextChange } from '../src/bot/schedule.js';
import * as store from '../src/bot/store.js';
import { run } from '../src/db.js';

const c = (text, step = 'awaiting_product', extra = {}) => classifyWithRules({ text, step, ...extra });
const media = { has: (kind, product) => kind === 'katalog' && product === 'jersey' };
const texts = (actions) => actions.filter((a) => a.type === 'text').map((a) => a.text);

test('one message, several questions: all are recognised', () => {
    const r = c('mau bikin jersey futsal, minimal order berapa? lokasinya dimana?');

    assert.equal(r.intent, 'location');
    assert.deepEqual(r.extras.sort(), ['moq', 'product']);
    assert.equal(r.product, 'jersey');
});

test('a product only named in passing does not start its flow', () => {
    assert.deepEqual(c('size chart jersey dong').extras, []);
});

test('several questions get every answer, and the bot question comes last', () => {
    const r = c('mau bikin jersey, minimal order berapa? bisa kirim ke makassar?');
    const { actions, patch } = decide({ step: 'awaiting_product' }, r, media);

    assert.deepEqual(texts(actions), [replies.shipping(), replies.moq1(), replies.moq2(), replies.askQuantity()]);
    assert.equal(patch.step, 'awaiting_quantity');
    assert.equal(actions.filter((a) => a.type === 'media').length, 1, 'jersey catalog');
});

test('a side question next to the expected answer is answered too', () => {
    const r = c('belum ada kak, oh iya lokasinya dimana?', 'awaiting_design');
    assert.equal(r.intent, 'no_reference');

    const { actions, patch } = decide({ step: 'awaiting_design', product: 'kaos' }, r, media);
    assert.deepEqual(texts(actions), [replies.location(), replies.locationMap(), replies.portfolio(), replies.askQuantity()]);
    assert.equal(patch.step, 'awaiting_quantity');
});

test('typos are tolerated on longer words', () => {
    assert.equal(editDistance('jresey', 'jersey'), 1, 'swap counts once');
    assert.equal(c('bikin hoddie angkatan bisa?').product, 'hoodie');
    assert.equal(c('mau pesan lanyrd').product, 'id-card-lanyard');
    assert.equal(c('lokais nya di mana').intent, 'location');
    assert.equal(c('minta portopolio dong').intent, 'design_reference');
});

test('short words are never fuzzy-matched', () => {
    assert.equal(c('kamu siapa').product, null, '"kamu" is not "kaos"');
    assert.equal(c('kak bisa bayar paylater?').intent, 'other');
});

test('keywords taught from the console take effect immediately', () => {
    assert.equal(c('bisa pakai rekber?').intent, 'other');

    addKeyword({ phrase: 'Rekber!', intent: 'trust' });
    addKeyword({ phrase: 'kaos panitia', intent: 'product', product: 'kaos' });

    assert.equal(c('bisa pakai rekber?').intent, 'trust');
    assert.equal(c('mau order kaos panitia 17an').product, 'kaos');
    assert.deepEqual(customKeywords().map((k) => k.phrase).sort(), ['kaos panitia', 'rekber']);

    for (const k of customKeywords()) removeKeyword(k.id);
    assert.equal(c('bisa pakai rekber?').intent, 'other');
});

test('teaching rejects nonsense', () => {
    assert.throws(() => addKeyword({ phrase: 'x', intent: 'trust' }), /2-60/);
    assert.throws(() => addKeyword({ phrase: 'halo', intent: 'greeting' }), /Maksud/);
    assert.throws(() => addKeyword({ phrase: 'baju', intent: 'product' }), /produk/);
});

test('incoming messages are labelled, and the unrecognised ones listed for teaching', () => {
    run('DELETE FROM message_log');
    store.logMessage({ sessionKey: 'utama', jid: 'a@s.whatsapp.net', direction: 'in', text: 'bisa paylater?' });
    store.tagIncoming('utama', 'a@s.whatsapp.net', 'other');
    store.logMessage({ sessionKey: 'utama', jid: 'b@s.whatsapp.net', direction: 'in', text: 'lokasi dimana' });
    store.tagIncoming('utama', 'b@s.whatsapp.net', 'location');

    assert.deepEqual(store.unrecognised(30).map((m) => m.text), ['bisa paylater?']);

    const a = store.analytics(7);
    assert.equal(a.daily.length, 7);
    assert.equal(a.totals.masuk, 2);
    assert.equal(a.recognisedRate, 0.5);
    assert.equal(a.hours.length, 24);
    assert.equal(a.hours.reduce((sum, h) => sum + h.n, 0), 2);
});

test('next switch between active and silent', () => {
    const options = { timezone: 'Asia/Jakarta', activeFrom: '17:30', activeUntil: '07:30', forceMode: '' };

    // Monday 12.00 WIB -> starts 17.30 WIB.
    assert.equal(nextChange(new Date('2026-10-05T05:00:00Z'), options).toISOString(), '2026-10-05T10:30:00.000Z');
    // Saturday 20.00 WIB -> runs through Sunday, stops Monday 07.30 WIB.
    assert.equal(nextChange(new Date('2026-10-10T13:00:00Z'), options).toISOString(), '2026-10-12T00:30:00.000Z');
    assert.equal(nextChange(new Date(), { ...options, forceMode: 'always' }), null);
});
