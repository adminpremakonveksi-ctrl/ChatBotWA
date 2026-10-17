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

test('"saya mau pesan Kemeja 2000 PCS": which kemeja, which sizes, the design, then CS', () => {
    updateProduct('kemeja', { questions: [...SEED_QUESTIONS.kemeja, SIZE_QUESTION] });

    let r = step({ step: 'awaiting_product', name: 'Budi' }, 'saya mau pesan Kemeja 2000 PCS');
    assert.equal(r.conv.product, 'kemeja');
    assert.equal(r.conv.quantity, '2000 pcs');
    assert.deepEqual(texts(r.actions), [SEED_QUESTIONS.kemeja[0]], 'first: which kemeja');

    // "PDH lengan panjang" names another product (PDL); here it is the answer.
    r = step(r.conv, 'PDH lengan panjang');
    assert.equal(r.conv.product, 'kemeja');
    assert.deepEqual(texts(r.actions), [SIZE_QUESTION]);

    // Sizes with numbers are the answer, not a size chart request.
    r = step(r.conv, 'S 500, M 800, L 700');
    assert.deepEqual(texts(r.actions), [replies.askDesign('Kemeja')]);
    assert.equal(r.conv.step, 'awaiting_design');

    // The quantity is known: no [5], straight to [7] + [8].
    r = step(r.conv, 'logo perusahaan di dada kiri, warna navy');
    assert.deepEqual(texts(r.actions), [replies.waitForCs(), replies.socials(), replies.handoverNotice()]);
    assert.deepEqual(JSON.parse(r.conv.details).map((d) => d.a), ['PDH lengan panjang', 'S 500, M 800, L 700']);

    updateProduct('kemeja', { questions: [] });
});

test('a question of their own in between is answered, and the follow-up waits', () => {
    updateProduct('kaos', { questions: SEED_QUESTIONS.kaos });

    let r = step({ step: 'awaiting_product' }, 'mau bikin kaos kelas');
    assert.equal(r.conv.step, 'awaiting_detail');

    r = step(r.conv, 'lokasinya dimana kak?');
    assert.match(texts(r.actions)[0], /Agus Salim/);
    assert.equal(r.conv.step, 'awaiting_detail', 'still waiting for the kaos answer');

    r = step(r.conv, 'ok');
    assert.deepEqual(r.actions, []);

    r = step(r.conv, 'lengan pendek, sablon depan belakang');
    assert.equal(r.conv.step, 'awaiting_design');

    updateProduct('kaos', { questions: [] });
});

test('catalog products: the catalog first, then the questions, then [5]', () => {
    updateProduct('jersey', { questions: SEED_QUESTIONS.jersey });

    let r = step({ step: 'awaiting_product' }, 'mau bikin jersey');
    assert.deepEqual(r.actions.map((a) => a.kind ?? a.text), ['katalog', SEED_QUESTIONS.jersey[0]]);

    r = step(r.conv, 'futsal');
    assert.deepEqual(texts(r.actions), [replies.askQuantityCatalog()]);

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
