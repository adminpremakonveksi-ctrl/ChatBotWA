import './setup.js';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { Session } from '../src/session.js';
import { config } from '../src/config.js';
import { get, now, run } from '../src/db.js';
import { completeDelivery, enqueueDelivery, pendingDeliveries, pruneRetryMessages, rememberRetryMessage, retryMessage } from '../src/delivery.js';
import { Bot } from '../src/bot/bot.js';
import { rememberLid } from '../src/lid.js';
import { OutgoingMessages } from '../src/outgoing-messages.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let serial = 0;
const customer = '628111111111@s.whatsapp.net';
const mediaMessage = (label) => ({ imageMessage: { url: 'https://example.com/catalog', directPath: '/catalog', mediaKey: Buffer.from([1, 2, 3]), fileSha256: Buffer.from([4, 5, 6]), caption: label } });

test('installed Baileys relay keeps the original chat and own-device wrapper on LID retry', () => {
    const result = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(new URL('./baileys-relay-fixture.js', import.meta.url))], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { payloads: 6, baselineMissingWrapper: true, fixedDestinationAndPayload: true });
});

async function connected(t, createSocket) {
    const key = `outgoing-sync-${++serial}`;
    const stamp = now();
    const row = { id: Number(run('INSERT INTO wa_sessions ("key", label, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [key, key, 'disconnected', stamp, stamp]).lastInsertRowid), key, label: key };
    let options, socket;
    const session = new Session(row, { isBotMessage: () => true, flushPending: async () => {}, recoverIncoming: async () => {} }, {
        fetchVersion: async () => ({ version: [2, 3000, 1] }),
        authState: async () => ({ state: { creds: { me: { id: '628999999999:12@s.whatsapp.net', lid: '999:12@lid' } }, keys: { get: async () => ({}), set: async () => {} } }, saveCreds: async () => {}, clear: async () => {} }),
        makeSocket: (value) => {
            options = value;
            socket = {
                ev: new EventEmitter(), ws: new EventEmitter(),
                user: { id: '628999999999:12@s.whatsapp.net', lid: '999:12@lid' },
                signalRepository: { decryptMessage: async () => Buffer.from('simulation') },
                sendPresenceUpdate: async () => {}, end() {},
                ...createSocket(value),
            };
            return socket;
        },
    });
    t.after(() => session.stop());
    await session.start();
    socket.ev.emit('connection.update', { connection: 'open' });
    await new Promise(setImmediate);
    const previous = config.bot.typingMs;
    config.bot.typingMs = 0;
    t.after(() => { config.bot.typingMs = previous; });
    return { key, session, options, socket };
}

test('catalog retry is available to owner and admins before sendMessage returns', async (t) => {
    const original = mediaMessage('Catalog');
    const seen = [];
    const f = await connected(t, (options) => ({
        sendMessage: async (jid, content, { messageId }) => {
            const ownCopy = { deviceSentMessage: { destinationJid: jid, message: original } };
            assert.equal(await options.patchMessageBeforeSending?.(ownCopy, ['628999999999@s.whatsapp.net', '628999999999:59@s.whatsapp.net', '628999999999:66@s.whatsapp.net']), ownCopy);
            for (const device of [0, 59, 66]) {
                const message = await options.getMessage({ remoteJid: jid, id: messageId, participant: `628999999999:${device}@s.whatsapp.net`, fromMe: true });
                assert.ok(message?.imageMessage, `device ${device} can recover the catalog while sending is still in progress`);
                assert.deepEqual(Buffer.from(message.imageMessage.mediaKey), original.imageMessage.mediaKey);
                assert.equal(message.deviceSentMessage, null);
                seen.push(device);
            }
            return { key: { id: messageId, remoteJid: jid }, message: original };
        },
    }));
    await f.session.send(customer, { type: 'file', file: 'catalog.jpg' }, 'early-catalog-retry');
    assert.deepEqual(seen, [0, 59, 66]);
});

test('a failed send retains prepared media and retries the same protobuf and message ID', async (t) => {
    const original = mediaMessage('Same media keys after retry');
    let generated = 0;
    const relayed = [];
    const f = await connected(t, (options) => ({
        sendMessage: async (jid, content, { messageId }) => {
            generated++;
            await options.patchMessageBeforeSending?.(original, [jid]);
            throw new Error('simulated delivery interruption');
        },
        relayMessage: async (jid, message, options) => relayed.push({ jid, message, options }),
    }));
    await assert.rejects(f.session.send(customer, { type: 'file', file: 'catalog.jpg' }, 'durable-catalog'), /simulated delivery interruption/);
    assert.ok(retryMessage(f.key, { id: 'durable-catalog' })?.imageMessage);
    await f.session.send(customer, { type: 'file', file: 'catalog.jpg' }, 'durable-catalog');
    assert.equal(generated, 1);
    assert.equal(relayed.length, 1);
    assert.equal(relayed[0].options.messageId, 'durable-catalog');
    assert.equal(relayed[0].options.useUserDevicesCache, false);
    assert.deepEqual(Buffer.from(relayed[0].message.imageMessage.mediaKey), original.imageMessage.mediaKey);
});

test('parallel customer sends never save each other\'s prepared catalogs', async (t) => {
    const original = { first: mediaMessage('First'), second: mediaMessage('Second') };
    const f = await connected(t, (options) => ({
        sendMessage: async (jid, content, { messageId }) => {
            await new Promise(setImmediate);
            await options.patchMessageBeforeSending?.(original[messageId], [jid]);
            await new Promise(setImmediate);
            const stored = await options.getMessage({ remoteJid: jid, id: messageId });
            assert.equal(stored?.imageMessage?.caption, original[messageId].imageMessage.caption);
            return { key: { id: messageId, remoteJid: jid }, message: original[messageId] };
        },
    }));
    await Promise.all([
        f.session.send(customer, { type: 'file', file: 'first.jpg' }, 'first'),
        f.session.send('628222222222@s.whatsapp.net', { type: 'file', file: 'second.jpg' }, 'second'),
    ]);
});

test('text and catalog links are recoverable while their first send is still running', async (t) => {
    const texts = ['Saya bantu ya, Kak.', 'https://wa.me/c/628999999999'];
    const f = await connected(t, (options) => ({
        sendMessage: async (jid, content, { messageId }) => {
            const message = { extendedTextMessage: { text: content.text } };
            assert.equal(await options.patchMessageBeforeSending(message, [jid]), message);
            assert.equal((await options.getMessage({ id: messageId, remoteJid: jid })).extendedTextMessage.text, content.text);
            return { key: { id: messageId, remoteJid: jid }, message };
        },
    }));
    for (const [index, text] of texts.entries()) await f.session.send(customer, { type: 'text', text }, `early-text-${index}`);
});

test('a new sender after restart reuses the stored PDF keys without uploading a new catalog', async (t) => {
    const document = { documentMessage: { url: 'https://example.com/catalog.pdf', mediaKey: Buffer.from([7, 8, 9]), fileSha256: Buffer.from([10, 11, 12]), fileName: 'Catalog.pdf', mimetype: 'application/pdf' } };
    let uploads = 0;
    const f = await connected(t, (options) => ({
        sendMessage: async (jid) => {
            uploads++;
            await options.patchMessageBeforeSending(document, [jid]);
            throw new Error('simulated process interruption after preparing PDF');
        },
    }));
    await assert.rejects(f.session.send(customer, { type: 'file', file: 'catalog.pdf' }, 'pdf-restart'), /process interruption/);
    const restarted = new OutgoingMessages(f.key);
    let sent;
    await restarted.send({ relayMessage: async (jid, message, options) => { sent = { jid, message, options }; } }, customer, { document: { url: 'catalog.pdf' } }, 'pdf-restart', () => true);
    assert.equal(uploads, 1);
    assert.equal(sent.options.messageId, 'pdf-restart');
    assert.equal(sent.message.documentMessage.fileName, 'Catalog.pdf');
    assert.deepEqual(Buffer.from(sent.message.documentMessage.mediaKey), document.documentMessage.mediaKey);
});

test('takeover during media preparation cancels before encryption and leaves no prepared message', async (t) => {
    let release, prepared;
    const waiting = new Promise((resolve) => { prepared = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    let allowed = true, submitted = 0;
    const f = await connected(t, (options) => ({
        sendMessage: async (jid, content, { messageId }) => {
            prepared();
            await gate;
            await options.patchMessageBeforeSending(mediaMessage('Cancelled'), [jid]);
            submitted++;
            return { key: { id: messageId, remoteJid: jid }, message: mediaMessage('Cancelled') };
        },
    }));
    const sending = f.session.send(customer, { type: 'file', file: 'catalog.jpg' }, 'cancel-upload', () => allowed);
    await waiting;
    allowed = false;
    release();
    await sending;
    assert.equal(submitted, 0);
    assert.equal(retryMessage(f.key, { id: 'cancel-upload' }), undefined);
});

test('echoes cannot replace original media keys and wrapped copies are stored as the original payload', () => {
    const message = mediaMessage('Original');
    const key = { id: 'immutable-original', remoteJid: customer };
    rememberRetryMessage('audit', { key, message: { deviceSentMessage: { destinationJid: customer, message } } });
    rememberRetryMessage('audit', { key, message: { imageMessage: { caption: 'Partial echo', mediaKey: Buffer.from([99]) } } });
    const restored = retryMessage('audit', key);
    assert.equal(restored.imageMessage.caption, 'Original');
    assert.deepEqual(Buffer.from(restored.imageMessage.mediaKey), message.imageMessage.mediaKey);
    assert.equal(restored.deviceSentMessage, null);
});

test('retry IDs are scoped to the original chat while learned LID aliases remain valid', () => {
    const key = { id: 'scoped-original', remoteJid: customer };
    rememberRetryMessage('audit', { key, message: mediaMessage('Scoped') });
    assert.equal(retryMessage('audit', { ...key, remoteJid: '628222222222@s.whatsapp.net' }), undefined);
    rememberLid('711111111111@lid', customer);
    assert.equal(retryMessage('audit', { ...key, remoteJid: '711111111111@lid' }).imageMessage.caption, 'Scoped');
});

test('retention preserves prepared payloads until their durable queue completes', () => {
    const key = { id: 'queued-old-original', remoteJid: customer };
    rememberRetryMessage('audit', { key, message: mediaMessage('Pending') });
    enqueueDelivery('audit', customer, { type: 'file', file: 'catalog.jpg' }, key.id, 'ai');
    run("UPDATE wa_retry_messages SET created_at = datetime('now', '-8 days') WHERE session_key = ? AND message_id = ?", ['audit', key.id]);
    pruneRetryMessages();
    assert.ok(retryMessage('audit', key));
    completeDelivery(key.id);
    pruneRetryMessages();
    assert.equal(retryMessage('audit', key), undefined);
});

test('sendText uses the durable sender and logs its ID before an own echo', async (t) => {
    const f = await connected(t, (options) => ({
        sendMessage: async (jid, content, { messageId }) => {
            assert.ok(get("SELECT 1 FROM message_log WHERE session_key = ? AND wa_message_id = ? AND direction = 'out'", [f.key, messageId]));
            assert.equal(pendingDeliveries(f.key, jid)[0].id, messageId);
            const message = { conversation: content.text };
            await options.patchMessageBeforeSending(message, [jid]);
            return { key: { id: messageId, remoteJid: jid }, message };
        },
    }));
    f.session.bot = new Bot({ isActive: () => true });
    const result = await f.session.sendText(customer, 'Manual answer');
    assert.equal(result.session, f.key);
    assert.equal(result.to, customer);
    assert.equal(pendingDeliveries(f.key).length, 0);
    assert.equal(retryMessage(f.key, { id: result.id, remoteJid: customer }).conversation, 'Manual answer');
});

test('Session handles an admin LID receipt using the saved catalog and acknowledges the original sender', async (t) => {
    const relayed = [], acknowledged = [], renewed = [];
    const original = mediaMessage('Visible to admin');
    const f = await connected(t, (options) => ({
        sendMessage: async (jid, content, { messageId }) => {
            await options.patchMessageBeforeSending(original, [jid]);
            return { key: { id: messageId, remoteJid: jid }, message: original };
        },
        assertSessions: async (jids) => renewed.push(jids),
        sendNode: async (node) => acknowledged.push(node),
        relayMessage: async (jid, message, relayOptions) => {
            const copy = { deviceSentMessage: { destinationJid: jid, message } };
            const patched = await options.patchMessageBeforeSending(copy, [relayOptions.participant.jid]);
            relayed.push({ jid, message: patched, options: relayOptions });
        },
    }));
    await f.session.send(customer, { type: 'file', file: 'catalog.jpg' }, 'admin-actual-retry');
    f.socket.ws.emit('CB:receipt', { tag: 'receipt', attrs: { id: 'admin-actual-retry', type: 'retry', from: '999:66@lid', recipient: customer }, content: [{ tag: 'retry', attrs: { count: '1' } }] });
    for (let i = 0; i < 24; i++) await new Promise(setImmediate);
    assert.deepEqual(renewed, [['628999999999:66@s.whatsapp.net']]);
    assert.equal(relayed.length, 1);
    assert.equal(relayed[0].options.messageId, 'admin-actual-retry');
    assert.equal(relayed[0].options.participant.jid, '628999999999:66@s.whatsapp.net');
    assert.equal(relayed[0].message.deviceSentMessage.destinationJid, customer);
    assert.deepEqual(Buffer.from(relayed[0].message.deviceSentMessage.message.imageMessage.mediaKey), original.imageMessage.mediaKey);
    assert.equal(acknowledged[0].attrs.to, '999:66@lid');
});
