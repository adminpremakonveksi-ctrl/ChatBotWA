import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_AUTO_MESSAGES, isAutoMessage, setAutoMessages } from '../src/bot/auto-messages.js';
import { Bot } from '../src/bot/bot.js';
import { classifyWithRules } from '../src/bot/classify-rules.js';
import { replies } from '../src/bot/replies.js';
import * as store from '../src/bot/store.js';
import { run } from '../src/db.js';

const JID = '6285555@s.whatsapp.net';

test('the WhatsApp Business Salam is not CS typing: no handover, no second greeting', async () => {
    run('DELETE FROM conversations');
    run('DELETE FROM message_log');
    const sent = [];
    const bot = new Bot({ classify: async (input) => classifyWithRules(input), media: { links: () => [], files: () => [], has: () => false }, isActive: () => true, debounceMs: 5 });
    const wa = { newMessageId: () => `A${sent.length}`, send: async (jid, action) => sent.push(action.text) };

    // The customer writes; WhatsApp Business answers with its Salam from our number.
    bot.onIncoming('utama', wa, { jid: JID, id: 'c1', text: 'halo kak' });
    bot.onOwnMessage('utama', { jid: JID, id: 'wa-salam', text: DEFAULT_AUTO_MESSAGES[0].replace('{bot}', 'ANGGUN') });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();

    assert.notEqual(store.loadConversation('utama', JID).step, 'handed_over');
    assert.deepEqual(sent, [], 'the Salam already greeted and asked their name');

    bot.onIncoming('utama', wa, { jid: JID, id: 'c2', text: 'saya Budi dari Kebumen' });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();
    assert.deepEqual(sent, [replies.afterIntro('Budi')], 'the bot carries on with [3]');

    // CS really typing still hands over.
    bot.onOwnMessage('utama', { jid: JID, id: 'cs1', text: 'Halo kak Budi, saya bantu ya' });
    assert.equal(store.loadConversation('utama', JID).step, 'handed_over');
});

test('the team edits the list; an edited Salam is still recognised from its start', () => {
    assert.ok(isAutoMessage(DEFAULT_AUTO_MESSAGES[0].replace('{bot}', 'Mawar')));
    // The Salam still saved in the WhatsApp app with the old name is recognised too.
    assert.ok(isAutoMessage(DEFAULT_AUTO_MESSAGES[0].replace('{bot}', 'ANGGUN')));
    assert.ok(!isAutoMessage('ok kak'));

    setAutoMessages('Terima kasih sudah menghubungi kami, kami sedang di luar jam kerja.\n---\nHalo kak, ini salam baru');
    assert.ok(isAutoMessage('Terima kasih sudah menghubungi kami, kami sedang di luar jam kerja. Akan kami balas besok.'));
    assert.ok(!isAutoMessage(DEFAULT_AUTO_MESSAGES[0].replace('{bot}', 'Mawar')), 'the old Salam was removed from the list');
    setAutoMessages(DEFAULT_AUTO_MESSAGES.join('\n---\n'));
});
