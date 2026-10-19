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

test('Salam then "Pesan tidak di tempat": neither is CS, the bot carries on (2026-10-19)', async () => {
    run('DELETE FROM conversations');
    run('DELETE FROM message_log');
    const sent = [];
    const bot = new Bot({ classify: async (input) => classifyWithRules(input), media: { links: () => [], files: () => [], has: () => false }, isActive: () => true, debounceMs: 5 });
    const wa = { newMessageId: () => `B${sent.length}`, send: async (jid, action) => sent.push(action.text) };

    // As WhatsApp delivers them: formatting marks gone, the name typed in the app.
    const salam = DEFAULT_AUTO_MESSAGES[0].replace('{bot}', 'ANGGUN').replace(/[*_]/g, '');
    const away = 'Terima kasih telah menghubungi Prema Konveksi. Mohon menunggu ya kak, pesan kakak akan segera kami respon ketika customer service online kembali.\n\nJam kerja customer service (fast response), adalah pukul 08.30 sd 17.00 😇🙏';

    bot.onIncoming('utama', wa, { jid: JID, id: 'd1', text: 'halo' });
    bot.onOwnMessage('utama', { jid: JID, id: 'wa-salam-2', text: salam });
    bot.onOwnMessage('utama', { jid: JID, id: 'wa-away', text: away });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();
    assert.notEqual(store.loadConversation('utama', JID).step, 'handed_over', 'neither automatic message is CS');

    bot.onIncoming('utama', wa, { jid: JID, id: 'd2', text: 'saya Budi dari Kebumen' });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();
    assert.deepEqual(sent, [replies.afterIntro('Budi')]);
});

test('migration 013 adds the away message to a list the team already saved', async () => {
    const { autoMessages } = await import('../src/bot/auto-messages.js');
    const { addAwayMessage } = await import('../src/migrations.js');
    const { SEED_AWAY_MESSAGE: AWAY_MESSAGE } = await import('../src/seeds.js');
    const { db } = await import('../src/db.js');

    setAutoMessages('Halo kak, ini salam tim sendiri yang sudah disimpan');
    addAwayMessage(db);
    addAwayMessage(db);
    assert.deepEqual(autoMessages(), ['Halo kak, ini salam tim sendiri yang sudah disimpan', AWAY_MESSAGE], 'kept theirs, added once');
    setAutoMessages(DEFAULT_AUTO_MESSAGES.join('\n---\n'));
});

test('the Salam\'s own "-------" line does not cut it in two when the list is saved (2026-10-19)', async () => {
    const { autoMessages } = await import('../src/bot/auto-messages.js');
    setAutoMessages(DEFAULT_AUTO_MESSAGES.join('\n---\n'));
    assert.equal(autoMessages().length, 2, 'Salam and away message, whole');

    // A list saved before the fix, the Salam already in two pieces: still recognised.
    const [head, tail] = DEFAULT_AUTO_MESSAGES[0].split('-------');
    setAutoMessages([head, tail, DEFAULT_AUTO_MESSAGES[1]].join('\n---\n'));
    assert.ok(isAutoMessage(DEFAULT_AUTO_MESSAGES[0].replace('{bot}', 'ANGGUN').replace(/[*_]/g, '')));
    assert.ok(!isAutoMessage('Halo kak, saya Anggun. Untuk kaosnya minimal berapa pcs ya rencananya?'), 'a CS reply still is CS');
    setAutoMessages(DEFAULT_AUTO_MESSAGES.join('\n---\n'));
});
