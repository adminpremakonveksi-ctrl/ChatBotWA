import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { Bot } from '../src/bot/bot.js';
import { classifyWithRules } from '../src/bot/classify-rules.js';
import * as store from '../src/bot/store.js';
import { run } from '../src/db.js';
import { conversationJid, learnFromKey, pnJidOf, rememberLid, withLidFallback } from '../src/lid.js';

// From the client PC (2026-10-19): the bot's own LID, its phone (device 0), a customer's LID.
const OWN_LID = '28067997159547:12@lid';
const OWN_PN = '6281999911895:12@s.whatsapp.net';
const CUSTOMER_LID = '247768274698362@lid';
const CUSTOMER_PN = '6285700001111@s.whatsapp.net';

test('a message from our own phone addressed by LID is decrypted with the session made under the number', async () => {
    run('DELETE FROM lid_map');
    rememberLid(OWN_LID, OWN_PN);

    // Sessions as Baileys 6.7 holds them: our phone under its number only.
    const sessions = new Set(['6281999911895.0']);
    const tried = [];
    const repository = {
        async decryptMessage({ jid, ciphertext }) {
            const address = `${jid.split('@')[0].split(':')[0]}.${jid.split('@')[0].split(':')[1] ?? 0}`;
            tried.push(address);
            if (!sessions.has(address)) throw Object.assign(new Error('No matching sessions found for message'), { name: 'SessionError' });

            return Buffer.from(`plain:${ciphertext}`);
        },
    };

    withLidFallback(repository);

    const out = await repository.decryptMessage({ jid: '28067997159547:0@lid', type: 'msg', ciphertext: 'abc' });
    assert.equal(String(out), 'plain:abc');
    assert.deepEqual(tried, ['28067997159547.0', '6281999911895.0'], 'LID first, then the number of the same device');

    // Another failure, or a LID we do not know, is passed on unchanged.
    await assert.rejects(repository.decryptMessage({ jid: '99999:0@lid', type: 'msg', ciphertext: 'x' }), /No matching sessions/);
});

test('which LID is which number is learnt from the messages', () => {
    run('DELETE FROM lid_map');

    learnFromKey({ remoteJid: CUSTOMER_LID, senderPn: CUSTOMER_PN, fromMe: false });
    assert.equal(conversationJid(CUSTOMER_LID), CUSTOMER_PN);
    assert.equal(pnJidOf('247768274698362:3@lid'), '6285700001111:3@s.whatsapp.net');

    assert.equal(conversationJid('11111@lid'), '11111@lid', 'an unknown LID stays as it is');
    assert.equal(conversationJid(CUSTOMER_PN), CUSTOMER_PN);
});

test('CS replying on the phone to a LID chat silences the bot for that customer (one conversation)', async () => {
    run('DELETE FROM lid_map');
    run('DELETE FROM conversations');
    run('DELETE FROM message_log');

    const sent = [];
    const bot = new Bot({ classify: async (input) => classifyWithRules(input), media: { links: () => [], files: () => [], has: () => false }, isActive: () => true, debounceMs: 5 });
    const wa = { newMessageId: () => `L${sent.length}`, send: async (jid, action) => sent.push({ jid, text: action.text }) };

    // The customer writes by number; later the chat is addressed by LID.
    learnFromKey({ remoteJid: CUSTOMER_LID, senderPn: CUSTOMER_PN });
    bot.onIncoming('utama', wa, { jid: conversationJid(CUSTOMER_PN), id: 'c1', text: 'halo kak saya Budi dari Jogja' });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();

    // CS types on the phone; WhatsApp addresses that chat by LID.
    bot.onOwnMessage('utama', { jid: conversationJid(CUSTOMER_LID), id: 'cs-1', text: 'Halo kak Budi, saya bantu ya' });
    assert.equal(store.loadConversation('utama', CUSTOMER_PN).step, 'handed_over');

    sent.length = 0;
    bot.onIncoming('utama', wa, { jid: conversationJid(CUSTOMER_LID), id: 'c2', text: 'mau bikin kaos' });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();
    assert.deepEqual(sent, [], 'the bot stays quiet while CS handles the customer');
});

test('messages we sent never teach a mapping (their sender ids are ours)', async () => {
    const { setOwnIdentity, pnOfLid } = await import('../src/lid.js');
    run('DELETE FROM lid_map');
    setOwnIdentity({ lid: OWN_LID, id: OWN_PN });

    // CS types on the phone in a chat addressed by number: senderLid is OUR LID.
    learnFromKey({ remoteJid: CUSTOMER_PN, fromMe: true, senderLid: '28067997159547:0@lid' });
    // CS types in a chat addressed by LID: senderPn is OUR number.
    learnFromKey({ remoteJid: CUSTOMER_LID, fromMe: true, senderPn: '6281999911895:0@s.whatsapp.net' });

    assert.equal(pnOfLid(OWN_LID), '6281999911895', 'our own mapping is intact');
    assert.equal(pnOfLid(CUSTOMER_LID), null, 'the customer was not mapped to our number');
    assert.equal(conversationJid(CUSTOMER_LID), CUSTOMER_LID);
});

test("the bot's own LID and number are never tied to someone else", async () => {
    const { setOwnIdentity, pnOfLid } = await import('../src/lid.js');
    run('DELETE FROM lid_map');
    setOwnIdentity({ lid: OWN_LID, id: OWN_PN });

    assert.equal(rememberLid(OWN_LID, CUSTOMER_PN), false);
    assert.equal(rememberLid(CUSTOMER_LID, OWN_PN), false);
    assert.equal(pnOfLid(OWN_LID), '6281999911895');
    assert.equal(pnOfLid(CUSTOMER_LID), null);
});

test('a conversation kept under the LID moves to the number when the mapping is learnt (handover kept)', async () => {
    run('DELETE FROM lid_map');
    run('DELETE FROM conversations');
    run('DELETE FROM message_log');

    store.markHandover('utama', CUSTOMER_LID, 'CS membalas');
    store.logMessage({ sessionKey: 'utama', jid: CUSTOMER_LID, direction: 'in', text: 'halo' });

    learnFromKey({ remoteJid: CUSTOMER_LID, senderPn: CUSTOMER_PN, fromMe: false });

    assert.equal(store.loadConversation('utama', CUSTOMER_PN).step, 'handed_over', 'still with CS');
    assert.equal(store.messagesOf('utama', CUSTOMER_PN).filter((m) => m.direction === 'in').length, 1, 'the messages moved too');
    assert.equal(store.loadConversation('utama', CUSTOMER_LID).step, 'new', 'no second conversation left behind');
});

test('when the number session fails too, the original error is reported', async () => {
    run('DELETE FROM lid_map');
    rememberLid('55555:0@lid', '6280000000:0@s.whatsapp.net');

    const repository = {
        async decryptMessage({ jid }) {
            throw new Error(jid.endsWith('@lid') ? 'No matching sessions found for message' : 'Bad MAC');
        },
    };
    withLidFallback(repository);

    await assert.rejects(repository.decryptMessage({ jid: '55555:0@lid', type: 'msg' }), (error) => {
        assert.match(error.message, /^No matching sessions found for message/);
        assert.match(error.message, /Bad MAC/);

        return true;
    });
});

test('a failing catalog read never takes the bot down', async () => {
    const { Session } = await import('../src/session.js');
    const session = new Session({ id: 1, key: 'uji', label: 'Uji' }, null);

    session.state = 'connected';
    session.socket = { user: { id: '628:1@s.whatsapp.net' }, getCatalog: async () => { throw new Error('item-not-found'); } };

    // Resolves (no unhandled rejection) and reports the reason.
    await assert.doesNotReject(session.syncCatalogWithRetry());
    const { getSetting } = await import('../src/db.js');
    assert.match(String(getSetting('catalog:error')), /item-not-found/);
});
