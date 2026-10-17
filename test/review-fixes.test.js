import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { Bot } from '../src/bot/bot.js';
import { classifyWithRules } from '../src/bot/classify-rules.js';
import { decide } from '../src/bot/engine.js';
import { updateProduct } from '../src/bot/products.js';
import { replies } from '../src/bot/replies.js';
import * as store from '../src/bot/store.js';
import { run } from '../src/db.js';
import { SEED_QUESTIONS, SIZE_QUESTION } from '../src/seeds.js';

/**
 * One test per problem found in the code review, so none of them comes back.
 */

const media = { has: (kind, product) => kind === 'katalog' && product === 'jersey', links: () => [] };
const texts = (actions) => actions.filter((a) => a.type === 'text').map((a) => a.text);
const step = (conv, text, extra = {}) => {
    const { actions, patch } = decide(conv, { ...classifyWithRules({ text, step: conv.step }), ...extra }, media);

    return { actions, conv: { ...conv, ...patch } };
};

test('misses are counted whatever the label, so asking again always ends at CS', () => {
    // A picture at the product question is "has_reference": not understood there, and still counted.
    let conv = { step: 'awaiting_product' };
    for (let i = 0; i < 2; i++) {
        const r = step(conv, '', { intent: 'has_reference' });
        assert.deepEqual(texts(r.actions), [replies.clarify()]);
        conv = r.conv;
    }
    assert.equal(step(conv, '', { intent: 'has_reference' }).conv.step, 'handed_over');
});

test('at a follow-up question: another product is a change of mind, a greeting is not an answer', () => {
    updateProduct('kemeja', { questions: [...SEED_QUESTIONS.kemeja, SIZE_QUESTION] });

    let r = step({ step: 'awaiting_product' }, 'mau bikin kemeja');
    r = step(r.conv, 'halo kak');
    assert.deepEqual(r.actions, []);
    assert.equal(r.conv.details ?? null, null, 'a greeting is not stored as the answer');

    r = step(r.conv, 'eh kalau jaket bisa?');
    assert.equal(r.conv.product, 'jaket', 'switched to jaket');

    updateProduct('kemeja', { questions: [] });
});

test('asking the price during the follow-up questions keeps them', () => {
    updateProduct('jersey', { questions: [...SEED_QUESTIONS.jersey, SIZE_QUESTION] });

    let r = step({ step: 'awaiting_product' }, 'mau bikin jersey');
    r = step(r.conv, 'harganya berapa?');
    assert.equal(r.conv.step, 'awaiting_detail', 'still at the follow-up question');

    r = step(r.conv, 'futsal');
    assert.deepEqual(texts(r.actions), [SIZE_QUESTION], 'the size question is still asked');

    updateProduct('jersey', { questions: [] });
});

test('a new customer whose first message asks for a person goes to CS at once', () => {
    const r = step({ step: 'new' }, 'mau ngobrol sama admin aja');
    assert.equal(r.conv.step, 'handed_over');
});

test('the amount said for one product does not carry over to another', () => {
    let r = step({ step: 'awaiting_product' }, 'mau bikin kaos 50 pcs');
    assert.equal(r.conv.quantity, '50 pcs');

    r = step({ ...r.conv, step: 'awaiting_quantity' }, 'eh jersey aja deh');
    assert.equal(r.conv.product, 'jersey');
    assert.equal(r.conv.quantity, null);
    assert.deepEqual(texts(r.actions), [replies.askQuantityCatalog()], 'asked how many jerseys');
});

test('after the WhatsApp Business Salam: the first message is not apologised for, and an old Salam is ignored', async () => {
    run('DELETE FROM conversations');
    const sent = [];
    const bot = new Bot({ classify: async (input) => classifyWithRules(input), media: { links: () => [], files: () => [], has: () => false }, isActive: () => true, debounceMs: 5 });
    const wa = { newMessageId: () => `R${sent.length}`, send: async (jid, action) => sent.push(action.text) };
    const salam = replies.greetUnknown();

    bot.onIncoming('utama', wa, { jid: 'a@s.whatsapp.net', id: 'a1', text: 'xyz qwerty' });
    bot.onOwnMessage('utama', { jid: 'a@s.whatsapp.net', id: 'salam-a', text: salam });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();
    assert.deepEqual(sent, [], 'no "belum paham" to the very first message');
    assert.equal(store.loadConversation('utama', 'a@s.whatsapp.net').step, 'awaiting_intro');

    // A Salam from long ago (sent by day) does not mute the night.
    bot.onOwnMessage('utama', { jid: 'b@s.whatsapp.net', id: 'salam-b', text: salam });
    bot.autoGreeted.set('utama|b@s.whatsapp.net', Date.now() - 60 * 60 * 1000);
    bot.onIncoming('utama', wa, { jid: 'b@s.whatsapp.net', id: 'b1', text: 'halo kak' });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();
    assert.deepEqual(sent, [replies.greetUnknown()], 'greeted as usual');
});

test('from the simulated chats: names, sizes, amounts and design said along the way', () => {
    updateProduct('hoodie', { questions: [SEED_QUESTIONS.hoodie[0], SIZE_QUESTION] });

    // "SMA 1" is not one piece; "perkenalkan saya Dimas" is a name.
    let r = step({ step: 'new' }, 'Selamat malam, perkenalkan saya Dimas dari SMA 1 Purworejo');
    assert.equal(r.conv.name, 'Dimas');
    assert.equal(r.conv.quantity ?? null, null);

    r = step(r.conv, 'Kami berencana memesan hoodie angkatan sebanyak 120 pcs');
    assert.equal(r.conv.quantity, '120 pcs');
    r = step(r.conv, 'Pakai resleting');

    // "Ukuran beragam, nanti kami kirimkan datanya" answers the size question (no size chart, no "Seragam").
    r = step(r.conv, 'Ukuran beragam, nanti kami kirimkan datanya');
    assert.equal(r.conv.product, 'hoodie');
    assert.deepEqual(texts(r.actions), [replies.askDesign('Hoodie')]);

    // "nanti saya kirim filenya" is not a name; the design is ready and the amount known: done.
    r = step(r.conv, 'Desainnya sudah ada, nanti saya kirim filenya');
    assert.equal(r.conv.name, 'Dimas');
    assert.equal(r.conv.step, 'handed_over');

    updateProduct('hoodie', { questions: [] });
});

test('"belum ada desain" during the follow-up questions skips [4]', () => {
    updateProduct('kaos', { questions: SEED_QUESTIONS.kaos });

    let r = step({ step: 'awaiting_product' }, 'mau bikin kaos');
    r = step(r.conv, 'lengan pendek, belum ada desain kak');
    assert.deepEqual(texts(r.actions), [replies.portfolio(), replies.askQuantity()]);
    assert.equal(r.conv.step, 'awaiting_quantity');

    updateProduct('kaos', { questions: [] });
});
