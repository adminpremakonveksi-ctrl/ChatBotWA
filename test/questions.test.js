import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWithRules } from '../src/bot/classify-rules.js';
import { decide } from '../src/bot/engine.js';
import { productQuestions, updateProduct } from '../src/bot/products.js';
import { replies } from '../src/bot/replies.js';
import { SIZE_QUESTION, SEED_QUESTIONS } from '../src/seeds.js';

const media = { has: (kind, product) => kind === 'katalog' && product === 'jersey', links: () => [] };
const texts = (actions) => actions.filter((a) => a.type === 'text').map((a) => a.text);
const step = (conv, text) => {
    const { actions, patch } = decide(conv, classifyWithRules({ text, step: conv.step }), media);

    return { actions, conv: { ...conv, ...patch } };
};

test('"saya mau pesan Kemeja 2000 PCS": the agreed flow first ([4]), the follow-up questions last, then CS', () => {
    updateProduct('kemeja', { questions: [...SEED_QUESTIONS.kemeja, SIZE_QUESTION] });

    // The flow as agreed: the product gets [4] straight away; the amount is kept.
    let r = step({ step: 'awaiting_product', name: 'Budi' }, 'saya mau pesan Kemeja 2000 PCS');
    assert.equal(r.conv.product, 'kemeja');
    assert.equal(r.conv.quantity, '2000 pcs');
    assert.deepEqual(texts(r.actions), [replies.askDesign('Kemeja')]);
    assert.equal(r.conv.step, 'awaiting_design');

    // The design answer; the amount is known, so no [5]: now the questions, just before the order goes to CS.
    r = step(r.conv, 'logo perusahaan di dada kiri, warna navy');
    assert.deepEqual(texts(r.actions), [SEED_QUESTIONS.kemeja[0]]);
    assert.equal(r.conv.step, 'awaiting_detail');

    // "PDH lengan panjang" names another product (PDL); here it is the answer.
    r = step(r.conv, 'PDH lengan panjang');
    assert.equal(r.conv.product, 'kemeja');
    assert.deepEqual(texts(r.actions), [SIZE_QUESTION]);

    // The size list is the last thing asked; then [7] + [8].
    r = step(r.conv, 'S 500, M 800, L 700');
    assert.deepEqual(texts(r.actions), [replies.waitForCs(), replies.socials(), replies.handoverNotice()]);
    assert.deepEqual(JSON.parse(r.conv.details).map((d) => d.a), ['PDH lengan panjang', 'S 500, M 800, L 700']);

    updateProduct('kemeja', { questions: [] });
});

test('a question of their own in between is answered, and the follow-up waits', () => {
    updateProduct('kaos', { questions: SEED_QUESTIONS.kaos });

    let r = step({ step: 'awaiting_product' }, 'mau bikin kaos kelas');
    assert.equal(r.conv.step, 'awaiting_design', 'the agreed flow: [4] first');
    r = step(r.conv, 'belum ada desain kak');
    assert.equal(r.conv.step, 'awaiting_quantity');
    r = step(r.conv, '40 pcs');
    assert.equal(r.conv.step, 'awaiting_detail', 'then the follow-up question');

    r = step(r.conv, 'lokasinya dimana kak?');
    assert.match(texts(r.actions)[0], /Agus Salim/);
    assert.equal(r.conv.step, 'awaiting_detail', 'still waiting for the kaos answer');

    r = step(r.conv, 'ok');
    assert.deepEqual(r.actions, []);

    r = step(r.conv, 'lengan pendek, sablon depan belakang');
    assert.equal(r.conv.step, 'handed_over');

    updateProduct('kaos', { questions: [] });
});

test('catalog products: the catalog and [5] first, the questions last', () => {
    updateProduct('jersey', { questions: SEED_QUESTIONS.jersey });

    let r = step({ step: 'awaiting_product' }, 'mau bikin jersey');
    assert.deepEqual(r.actions.map((a) => a.kind ?? a.text), ['katalog', replies.askQuantityCatalog()]);

    r = step(r.conv, '15 stel');
    assert.deepEqual(texts(r.actions), [SEED_QUESTIONS.jersey[0]]);

    r = step(r.conv, 'futsal');
    assert.equal(r.conv.step, 'handed_over');

    updateProduct('jersey', { questions: [] });
});

test('questions are edited per product: add, change, remove', () => {
    updateProduct('topi', { questions: 'Topinya model apa kak?\nBordir atau sablon?' });
    assert.deepEqual(productQuestions('topi'), ['Topinya model apa kak?', 'Bordir atau sablon?']);

    updateProduct('topi', { questions: 'Bordir atau sablon?' });
    assert.deepEqual(productQuestions('topi'), ['Bordir atau sablon?']);

    updateProduct('topi', { questions: '' });
    assert.deepEqual(productQuestions('topi'), []);

    assert.throws(() => updateProduct('topi', { questions: '1\n2\n3\n4\n5\n6\n7' }), /Maksimal 6/);
});

test('an amount is only an amount with a unit, or when the bot asked how many', () => {
    assert.equal(classifyWithRules({ text: 'kaos untuk SMA 1 Purworejo', step: 'awaiting_product' }).quantity, null);
    assert.equal(classifyWithRules({ text: 'jaket 2 lusin', step: 'awaiting_product' }).quantity, '2 lusin');
    assert.equal(classifyWithRules({ text: '150', step: 'awaiting_quantity' }).quantity, '150');
});
