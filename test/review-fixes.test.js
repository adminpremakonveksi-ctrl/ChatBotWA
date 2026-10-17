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
        assert.deepEqual(texts(r.actions), [replies.clarify(i)]);
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

test('odd messages: unknown products, "kamu bot?", anger, phone, amounts in words', () => {
    const c = (text, s = 'awaiting_product') => classifyWithRules({ text, step: s });

    assert.equal(c('bisa bikin sepatu?').intent, 'product_unknown');
    assert.deepEqual(texts(step({ step: 'awaiting_product' }, 'bisa bikin sepatu?').actions), [replies.productUnknown()]);

    assert.equal(c('kamu bot ya?').intent, 'about_bot');
    const bot = step({ step: 'awaiting_design', product: 'kaos' }, 'kamu bot ya?');
    assert.deepEqual(texts(bot.actions), [replies.aboutBot()]);
    assert.equal(bot.conv.step, 'awaiting_design', 'no handover for asking');

    assert.equal(c('goblok bot nya lama banget').intent, 'human');
    assert.equal(c('tolong telpon saya aja di nomor itu').intent, 'human');

    assert.equal(c('bikin kaos 2rb pcs').quantity, '2rb pcs');
    assert.equal(c('dua ratus biji aja deh', 'awaiting_detail').quantity, 'dua ratus pcs');
    assert.equal(c('how much for 100 pieces?').quantity, '100 pcs');

    // A typo guess for a pattern does not beat a product named exactly.
    assert.equal(c('seragam batik kantor').product, 'kemeja');
    assert.notEqual(c('seragam batik kantor').intent, 'custom');

    assert.equal(classifyWithRules({ text: 'sya agus dr wonosobo', step: 'awaiting_intro' }).name, 'Agus');
});

test('one message asking for the same catalog twice sends it once', () => {
    const asked = { has: () => true, links: () => [] };
    const r = classifyWithRules({ text: 'ada contoh desain jersey ga? mau bikin jersey', step: 'awaiting_product' });
    const { actions } = decide({ step: 'awaiting_product', name: 'Wawan' }, r, asked);

    assert.equal(actions.filter((a) => a.type === 'media' && a.kind === 'katalog').length, 1);
});

test('questions only CS can answer: noted, said so once, the chat goes on', () => {
    let r = step({ step: 'awaiting_product' }, 'bisa dp dulu ga kak?');
    assert.deepEqual(texts(r.actions), [replies.csQuestion()]);
    assert.equal(r.conv.step, 'awaiting_product');
    assert.deepEqual(JSON.parse(r.conv.notes), ['bisa dp dulu ga kak?']);

    // Next to a question the bot answers: both.
    r = step({ step: 'awaiting_product' }, 'minimal order berapa? terus bisa dicicil?');
    assert.equal(r.actions.filter((a) => a.text === replies.csQuestion()).length, 1);
    assert.ok(texts(r.actions).some((t) => /minimum pemesanan/.test(t)));

    // A product chosen later keeps the note (it is not part of the order details).
    r = step({ step: 'awaiting_product', notes: JSON.stringify(['bisa dp?']) }, 'mau bikin kaos');
    assert.equal(r.conv.notes, JSON.stringify(['bisa dp?']));
});

test('a voice note is asked to be typed; a picture is received and noted', () => {
    const voice = decide({ step: 'awaiting_product' }, classifyWithRules({ text: '', hasAudio: true, step: 'awaiting_product' }), media);
    assert.deepEqual(texts(voice.actions), [replies.voiceNote()]);

    const picture = decide({ step: 'awaiting_product' }, classifyWithRules({ text: '', hasImage: true, step: 'awaiting_product' }), media);
    assert.deepEqual(texts(picture.actions), [replies.imageReceived()]);
    assert.deepEqual(JSON.parse(picture.patch.notes), ['[gambar dari pelanggan]']);
});

test('the AI gets the lines before the message, never the message twice', async () => {
    const { recentHistory, logMessage } = store;
    run('DELETE FROM message_log');
    logMessage({ sessionKey: 'utama', jid: 'h@s.whatsapp.net', direction: 'in', text: 'mau bikin jersey' });
    logMessage({ sessionKey: 'utama', jid: 'h@s.whatsapp.net', direction: 'out', text: 'Jersey-nya untuk olahraga apa kak?' });
    logMessage({ sessionKey: 'utama', jid: 'h@s.whatsapp.net', direction: 'in', text: 'yang tadi itu buat futsal' });

    assert.deepEqual(recentHistory('utama', 'h@s.whatsapp.net', 1), [
        { who: 'pelanggan', text: 'mau bikin jersey' },
        { who: 'bot', text: 'Jersey-nya untuk olahraga apa kak?' },
    ]);
});

test('"belum paham" is worded differently each time it is said in a row', () => {
    assert.notEqual(replies.clarify(0), replies.clarify(1));
    assert.ok(replies.isClarify(replies.clarify(2)));
    assert.ok(!replies.isClarify('halo'));
});
