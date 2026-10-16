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
import { patternNames, seedText } from './helpers.js';

const c = (text, step = 'awaiting_product', extra = {}) => classifyWithRules({ text, step, ...extra });
const media = { has: (kind, product) => kind === 'katalog' && product === 'jersey' };
const texts = (actions) => actions.filter((a) => a.type === 'text').map((a) => a.text);

test('one message, several questions: all are recognised', () => {
    const r = c('mau bikin jersey futsal, minimal order berapa? lokasinya dimana?');

    assert.equal(r.intent, 'custom');
    assert.deepEqual(patternNames(r).sort(), ['Lokasi', 'Minimal order']);
    assert.deepEqual(r.extras, ['product']);
    assert.equal(r.product, 'jersey');
});

test('a product only named in passing does not start its flow', () => {
    assert.deepEqual(c('size chart jersey dong').extras, []);
});

test('several questions get every answer, and the bot question comes last', () => {
    const r = c('mau bikin jersey, minimal order berapa? bisa kirim ke makassar?');
    const { actions, patch } = decide({ step: 'awaiting_product' }, r, media);

    assert.deepEqual(texts(actions), [seedText('shipping', 0), seedText('moq', 0), seedText('moq', 1), replies.askQuantity()]);
    assert.equal(patch.step, 'awaiting_quantity');
    assert.equal(actions.filter((a) => a.type === 'media').length, 1, 'jersey catalog');
});

test('a side question next to the expected answer is answered too', () => {
    const r = c('belum ada kak, oh iya lokasinya dimana?', 'awaiting_design');
    assert.equal(r.intent, 'no_reference');

    const { actions, patch } = decide({ step: 'awaiting_design', product: 'kaos' }, r, media);
    assert.deepEqual(texts(actions), [seedText('location', 0), seedText('location', 1), replies.portfolio(), replies.askQuantity()]);
    assert.equal(patch.step, 'awaiting_quantity');
});

test('typos are tolerated on longer words', () => {
    assert.equal(editDistance('jresey', 'jersey'), 1, 'swap counts once');
    assert.equal(c('bikin hoddie angkatan bisa?').product, 'hoodie');
    assert.equal(c('mau pesan lanyrd').product, 'id-card-lanyard');
    assert.equal(c('lokais nya di mana').pattern?.name, 'Lokasi');
    assert.equal(c('minta portopolio dong').intent, 'design_reference');
});

test('short words are never fuzzy-matched', () => {
    assert.equal(c('kamu siapa').product, null, '"kamu" is not "kaos"');
    assert.equal(c('kak bisa bayar paylater?').intent, 'other');
});

test('keywords taught from the console take effect immediately', () => {
    assert.equal(c('ada mockup nya kak?').intent, 'other');

    addKeyword({ phrase: 'Mockup!', intent: 'design_reference' });
    addKeyword({ phrase: 'kaos bazar', intent: 'product', product: 'kaos' });

    assert.equal(c('ada mockup nya kak?').intent, 'design_reference');
    assert.equal(c('mau order kaos bazar 17an').product, 'kaos');
    assert.ok(customKeywords().some((k) => k.phrase === 'mockup' && k.source === 'tim'));

    for (const k of customKeywords().filter((k) => ['mockup', 'kaos bazar'].includes(k.phrase))) removeKeyword(k.id);
    assert.equal(c('ada mockup nya kak?').intent, 'other');
});

test('teaching rejects nonsense', () => {
    assert.throws(() => addKeyword({ phrase: 'x', intent: 'size_chart' }), /2-60/);
    assert.throws(() => addKeyword({ phrase: 'saya budi', intent: 'introduction' }), /Maksud/);
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
