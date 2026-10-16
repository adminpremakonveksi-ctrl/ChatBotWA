import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { Bot } from '../src/bot/bot.js';
import { classifyWithRules } from '../src/bot/classify-rules.js';
import { replies } from '../src/bot/replies.js';
import * as store from '../src/bot/store.js';
import { run } from '../src/db.js';

const SELF = '6281319504143@s.whatsapp.net';

function setup() {
    run('DELETE FROM conversations');
    run('DELETE FROM message_log');
    const sent = [];
    // Outside the night window: the self-chat test still answers.
    const bot = new Bot({ classify: async (input) => classifyWithRules(input), media: { links: () => [], files: () => [], has: () => false }, isActive: () => false, debounceMs: 5 });
    const wa = { newMessageId: () => `S${sent.length}`, send: async (jid, action) => sent.push(action.text) };
    const say = async (text, id) => {
        bot.onIncoming('utama', wa, { jid: SELF, id, text, selfTest: true });
        await new Promise((r) => setTimeout(r, 20));
        await bot.drain();
    };

    return { bot, sent, say };
}

test('the bot number messaging itself is answered like a customer, at any hour', async () => {
    const { bot, sent, say } = setup();

    await say('halo kak saya Budi', 'm1');
    assert.equal(sent[0], replies.greetKnown('Budi'));
    assert.ok(bot.isBotMessage('S0'), 'its echo in the self-chat is known, so it is not read as the next test message');
    assert.notEqual(store.loadConversation('utama', SELF).step, 'handed_over');
});

test('"reset" in the test chat starts over, even after a handover', async () => {
    const { sent, say } = setup();

    store.markHandover('utama', SELF, 'tes');
    await say('reset', 'm2');
    assert.match(sent[0], /Mode uji/);
    assert.equal(store.loadConversation('utama', SELF).step, 'new');

    await say('halo', 'm3');
    assert.equal(sent.length, 2, 'answered again');
});

test('a normal customer is still silent outside the night window', async () => {
    const { bot, sent } = setup();

    bot.onIncoming('utama', { newMessageId: () => 'x', send: async (j, a) => sent.push(a.text) }, { jid: '6287777@s.whatsapp.net', id: 'c1', text: 'halo' });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();
    assert.deepEqual(sent, []);
});
