import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWithRules } from '../src/bot/classify-rules.js';
import { decide } from '../src/bot/engine.js';
import { replies } from '../src/bot/replies.js';

const media = { has: (kind, product) => kind === 'katalog' && product === 'jersey', links: () => [] };
const texts = (actions) => actions.filter((a) => a.type === 'text').map((a) => a.text);
const step = (conv, text) => {
    const { actions, patch } = decide(conv, classifyWithRules({ text, step: conv.step }), media);

    return { actions, conv: { ...conv, ...patch } };
};

test('the chat from the screenshot: "mau nanya2 dulu" is invited, not handed to CS', () => {
    let conv = { step: 'awaiting_intro' };

    let r = step(conv, 'Mas nanya2 tentang jersey');
    assert.deepEqual(r.actions.map((a) => a.type), ['media', 'text']);
    assert.deepEqual(texts(r.actions), [replies.askQuantityCatalog()], 'no "untuk desainnya akan kami cek" after a catalog');
    conv = r.conv;

    r = step(conv, 'Mau nanya2 dulu mas');
    assert.deepEqual(texts(r.actions), [replies.askFirst()]);
    assert.equal(r.conv.step, 'awaiting_quantity', 'still waiting; no handover');

    r = step(r.conv, 'lokasine ten pundi?');
    assert.match(texts(r.actions)[0], /Agus Salim/, 'the question in Javanese is answered');
    assert.notEqual(r.conv.step, 'handed_over');
});

test('"ok" and "makasih" never hand over in the middle of the flow', () => {
    for (const s of ['awaiting_intro', 'awaiting_product', 'awaiting_design']) {
        const r = step({ step: s, product: 'kaos' }, 'ok kak makasih');
        assert.deepEqual(r.actions, [], s);
        assert.equal(r.conv.step, s);
    }

    // After the quantity question it closes the flow politely: [7] + [8].
    const done = step({ step: 'awaiting_quantity', product: 'kaos' }, 'nggih matur nuwun');
    assert.deepEqual(texts(done.actions), [replies.waitForCs(), replies.socials()]);
});

test('price questions: which product, the catalog, or [4]; never a number', () => {
    let r = step({ step: 'awaiting_product' }, 'harganya brp kak?');
    assert.deepEqual(texts(r.actions), [replies.priceWhich()]);

    r = step(r.conv, 'jersey');
    assert.deepEqual(r.actions.map((a) => a.type), ['media', 'text'], 'then the jersey catalog');

    r = step({ step: 'awaiting_quantity', product: 'jersey' }, 'pinten regane mas');
    assert.deepEqual(r.actions.map((a) => a.kind ?? a.type), ['katalog'], 'the catalog again: it has the price list');

    r = step({ step: 'awaiting_quantity', product: 'kaos' }, 'biayanya berapa?');
    assert.equal(r.conv.step, 'handed_over', 'design products: CS gives the price');
    assert.deepEqual(texts(r.actions), [replies.waitForCs()]);
});

test('a Javanese customer goes through the whole flow', () => {
    let r = step({ step: 'new' }, 'sugeng dalu mas');
    assert.equal(r.conv.step, 'awaiting_intro');

    r = step(r.conv, 'kulo Slamet saking Kutoarjo');
    assert.equal(r.conv.name, 'Slamet');
    assert.equal(r.conv.origin, 'Kutoarjo');

    r = step(r.conv, 'badhe damel kaos kelas');
    assert.equal(r.conv.step, 'awaiting_design');

    r = step(r.conv, 'dereng wonten desaine mas');
    assert.equal(r.conv.step, 'awaiting_quantity');

    r = step(r.conv, 'kinten-kinten 35 pcs');
    assert.equal(r.conv.step, 'handed_over');
    assert.deepEqual(texts(r.actions), [replies.waitForCs(), replies.socials()]);
});
