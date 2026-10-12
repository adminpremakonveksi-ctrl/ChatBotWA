import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { Bot } from '../src/bot/bot.js';
import { classifyWithRules } from '../src/bot/classify-rules.js';
import { replies } from '../src/bot/replies.js';
import * as store from '../src/bot/store.js';
import { run } from '../src/db.js';

let counter = 0;

/** Stands in for a WhatsApp session. */
function fakeTransport() {
    const sent = [];

    return {
        sent,
        texts: () => sent.filter((m) => m.action.type === 'text').map((m) => m.action.text),
        newMessageId: () => `BOT${++counter}`,
        async send(jid, action, id) {
            sent.push({ jid, action, id });
        },
    };
}

const makeBot = (active = true) =>
    new Bot({ classify: async (input) => classifyWithRules(input), isActive: () => active, debounceMs: 20 });

const SESSION = 'utama';
const fresh = () => run('DELETE FROM conversations');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('full conversation over several messages', async () => {
    fresh();
    const bot = makeBot();
    const wa = fakeTransport();
    const jid = '6281111@s.whatsapp.net';

    const say = async (text, extra = {}) => {
        bot.onIncoming(SESSION, wa, { jid, id: `IN${++counter}`, text, ...extra });
        await bot.drain();
    };

    await say('halo kak');
    assert.deepEqual(wa.texts(), [replies.greetUnknown()]);

    await say('Budi dari Jogja');
    assert.equal(wa.texts().at(-1), replies.afterIntro('Budi'));

    await say('mau bikin hoodie angkatan');
    assert.equal(wa.texts().at(-1), replies.askDesign('Hoodie'));

    await say('belum ada kak');
    assert.deepEqual(wa.texts().slice(-2), [replies.portfolio(), replies.askQuantity()]);

    await say('sekitar 40 pcs');
    assert.deepEqual(wa.texts().slice(-2), [replies.waitForCs(), replies.socials()]);

    const before = wa.sent.length;
    await say('oke kak ditunggu');
    assert.equal(wa.sent.length, before, 'silent after handover');

    assert.equal(store.loadConversation(SESSION, jid).step, 'handed_over');
});

test('bubbles sent in quick succession are answered once', async () => {
    fresh();
    const bot = makeBot();
    const wa = fakeTransport();
    const jid = '6282222@s.whatsapp.net';

    bot.onIncoming(SESSION, wa, { jid, id: 'a1', text: 'halo kak' });
    bot.onIncoming(SESSION, wa, { jid, id: 'a2', text: 'saya Rina dari Magelang' });
    bot.onIncoming(SESSION, wa, { jid, id: 'a3', text: 'mau tanya jersey' });

    await wait(60);
    await bot.drain();

    assert.equal(wa.texts()[0], replies.greetKnown('Rina'));
    assert.equal(wa.sent.filter((m) => m.action.type === 'file').length, 1, 'jersey catalog sent once');
    assert.equal(wa.texts().filter((t) => t.startsWith('Halo')).length, 1);
});

test('silent during working hours', async () => {
    fresh();
    const bot = makeBot(false);
    const wa = fakeTransport();

    bot.onIncoming(SESSION, wa, { jid: '6283333@s.whatsapp.net', id: 'b1', text: 'halo' });
    await wait(40);
    await bot.drain();

    assert.equal(wa.sent.length, 0);
});

test('CS typing from the phone stops the bot for that customer', async () => {
    fresh();
    const bot = makeBot();
    const wa = fakeTransport();
    const jid = '6284444@s.whatsapp.net';

    bot.onIncoming(SESSION, wa, { jid, id: 'c1', text: 'halo kak saya Andi dari Kebumen' });
    await bot.drain();

    // WhatsApp echoes the bot's own replies back as fromMe; those are not CS.
    for (const { id } of wa.sent) bot.onOwnMessage(SESSION, { jid, id });
    assert.equal(store.loadConversation(SESSION, jid).step, 'awaiting_product');

    bot.onOwnMessage(SESSION, { jid, id: 'PHONE-1' });
    assert.equal(store.loadConversation(SESSION, jid).step, 'handed_over');

    const before = wa.sent.length;
    bot.onIncoming(SESSION, wa, { jid, id: 'c2', text: 'mau bikin kaos' });
    await bot.drain();
    assert.equal(wa.sent.length, before);
});

test('a CS reply during a pending batch cancels it', async () => {
    fresh();
    const bot = makeBot();
    const wa = fakeTransport();
    const jid = '6285555@s.whatsapp.net';

    bot.onIncoming(SESSION, wa, { jid, id: 'd1', text: 'halo' });
    bot.onOwnMessage(SESSION, { jid, id: 'PHONE-2' });
    await wait(40);
    await bot.drain();

    assert.equal(wa.sent.length, 0);
});

test('handover expires after HANDOVER_HOURS and the customer is greeted by name', async () => {
    fresh();
    const jid = '6286666@s.whatsapp.net';

    store.saveConversation(SESSION, jid, { step: 'handed_over', name: 'Dewi', handed_over_at: '2000-01-01 00:00:00' });

    const conversation = store.loadConversation(SESSION, jid);
    assert.equal(conversation.step, 'new');
    assert.equal(conversation.name, 'Dewi');
});

test('messages are counted per day', () => {
    const [today] = store.stats(1);
    assert.ok(today.masuk > 0);
    assert.ok(today.keluar > 0);
});
