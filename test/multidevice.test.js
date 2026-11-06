import './setup.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageHealing, RECOVERY_OPERATION_MS, senderKind } from '../src/message-healing.js';
import { Bot } from '../src/bot/bot.js';
import { Session } from '../src/session.js';
import { config } from '../src/config.js';
import { now, run } from '../src/db.js';
import { enqueueDelivery, pendingDeliveries } from '../src/delivery.js';
import { loadConversation } from '../src/bot/store.js';
import { BufferJSON, Curve, generateSignalPubKey, initAuthCreds } from 'baileys';
import { makeLibSignalRepository } from 'baileys/lib/Signal/libsignal.js';
import { makePlaceholderCache } from '../src/baileys-fixes.js';
import { withLidFallback } from '../src/lid.js';

const MINUTE = 60000;
const customer = '628111111111@s.whatsapp.net';
let sequence = 0;
const unreadable = (id, sender, message = 'No matching sessions found for message') => ({
    key: { id, remoteJid: customer, fromMe: true },
    err: Object.assign(new Error(message), { senderJid: sender }),
});

function signalDevice() {
    const values = new Map();
    const state = {
        creds: initAuthCreds(),
        keys: {
            get: async (category, ids) => Object.fromEntries(ids.filter((id) => values.has(`${category}:${id}`)).map((id) => [id, JSON.parse(values.get(`${category}:${id}`), BufferJSON.reviver)])),
            set: async (changes) => {
                for (const [category, entries] of Object.entries(changes)) {
                    for (const [id, value] of Object.entries(entries)) {
                        if (value) values.set(`${category}:${id}`, JSON.stringify(value, BufferJSON.replacer));
                        else values.delete(`${category}:${id}`);
                    }
                }
            },
        },
    };
    return { state, repository: makeLibSignalRepository(state) };
}

test('real Signal encryption keeps owner and two admins separate and cached replays do not consume keys again', async () => {
    const bot = signalDevice();
    const cache = makePlaceholderCache();
    withLidFallback(bot.repository, () => null, cache);
    for (const deviceNumber of [0, 59, 66]) {
        const sender = signalDevice();
        const preKey = Curve.generateKeyPair();
        const keyId = deviceNumber + 1;
        await bot.state.keys.set({ 'pre-key': { [keyId]: preKey } });
        await sender.repository.injectE2ESession({
            jid: '628999999999:12@s.whatsapp.net',
            session: {
                registrationId: bot.state.creds.registrationId,
                identityKey: generateSignalPubKey(bot.state.creds.signedIdentityKey.public),
                signedPreKey: {
                    keyId: bot.state.creds.signedPreKey.keyId,
                    publicKey: generateSignalPubKey(bot.state.creds.signedPreKey.keyPair.public),
                    signature: bot.state.creds.signedPreKey.signature,
                },
                preKey: { keyId, publicKey: generateSignalPubKey(preKey.public) },
            },
        });
        const data = Buffer.from(`device ${deviceNumber}: admin reply`);
        const encrypted = await sender.repository.encryptMessage({ jid: '628999999999:12@s.whatsapp.net', data });
        const args = { jid: `999:${deviceNumber}@lid`, ...encrypted };
        assert.deepEqual(await bot.repository.decryptMessage(args), data);
        assert.deepEqual(await bot.repository.decryptMessage(args), data);
        const next = Buffer.from(`device ${deviceNumber}: next message`);
        const followup = await sender.repository.encryptMessage({ jid: '628999999999:12@s.whatsapp.net', data: next });
        assert.deepEqual(await bot.repository.decryptMessage({ jid: args.jid, ...followup }), next);
    }
});

function recovery(t, overrides = {}) {
    let at = 0, saved;
    const sessions = [], resends = [], handovers = [];
    let reconnects = 0;
    const socket = {
        user: { id: '628999999999:12@s.whatsapp.net', lid: '999:12@lid' },
        assertSessions: async (jids) => sessions.push(jids),
        requestPlaceholderResend: async (key) => resends.push(key.id),
    };
    const options = {
        socket: () => socket, clock: () => at, ownDevice: () => 12,
        log: { info() {}, warn() {} },
        reconnect: () => reconnects++,
        onUnresolvedOwn: (key) => handovers.push(key.id),
        read: () => saved, write: (value) => { saved = structuredClone(value); },
        ...overrides,
    };
    const healing = new MessageHealing(options);
    healing.start();
    t.after(() => healing.stop());
    return { healing, socket, sessions, resends, handovers, options, advance: (ms) => { at += ms; }, reconnects: () => reconnects };
}

test('four-device simulation renews owner and two admins independently and preserves device numbers', async (t) => {
    const f = recovery(t);
    f.healing.failed(unreadable('owner', '999:0@lid'));
    f.healing.failed(unreadable('admin-a', '999:59@lid'));
    f.healing.failed(unreadable('admin-b', '999:66@lid'));
    f.advance(2 * MINUTE);
    await f.healing.tick();
    assert.deepEqual(f.sessions, [['628999999999@s.whatsapp.net', '999@lid'], ['999:59@lid'], ['999:66@lid']]);
    assert.deepEqual(f.resends, ['owner', 'admin-a', 'admin-b']);
    f.healing.received(unreadable('owner').key);
    f.healing.received(unreadable('admin-a').key);
    f.healing.received(unreadable('admin-b').key);
    assert.equal(f.healing.status().pending, 0);
    assert.equal(f.healing.status().recovered, 3);
    assert.equal(f.reconnects(), 0);
});

test('unknown sender never becomes the phone or triggers relink or reconnect', async (t) => {
    const f = recovery(t);
    for (let i = 0; i < 5; i++) f.healing.failed(unreadable(`unknown-${i}`));
    assert.equal(senderKind({ key: { fromMe: true }, error: {} }, 12), 'unknown');
    for (let i = 0; i < 40; i++) { f.advance(MINUTE); await f.healing.tick(); }
    assert.equal(f.healing.status().needsRelink, false);
    assert.equal(f.healing.status().ownSessionBroken, false);
    assert.equal(f.sessions.length, 0);
    assert.equal(f.reconnects(), 0);
    assert.equal(f.handovers.length, 5);
});

test('legacy unknown-sender alarms and unverified renewal counts cannot survive as a relink request', (t) => {
    const f = recovery(t, { read: () => ({ ownBroken: true, ownBrokenSince: 0, sessionRefreshes: 9, pending: [{ key: unreadable('legacy').key, since: 0, error: { message: 'No matching sessions found for message' } }] }) });
    f.advance(40 * MINUTE);
    assert.equal(f.healing.status().needsRelink, false);
    assert.equal(f.healing.state.sessionRefreshes, 0);
});

test('a redelivery enriches legacy unknown sender details without restarting its retry budget', async (t) => {
    const f = recovery(t);
    f.healing.failed(unreadable('legacy-admin'));
    f.healing.state.pending[0].requests = 2;
    f.advance(2 * MINUTE);
    f.healing.failed(unreadable('legacy-admin', '999:66@lid'));
    assert.deepEqual(f.healing.status().otherDevices, { 66: 1 });
    assert.equal(f.healing.state.pending[0].since, 0);
    assert.equal(f.healing.state.pending[0].requests, 2);
    await f.healing.tick();
    assert.deepEqual(f.sessions, [['999:66@lid']]);
    assert.equal(f.healing.needsRelink(), false);
});

test('saturated recovery queue hands unresolved shop messages to CS before releasing them', (t) => {
    const f = recovery(t);
    for (let i = 0; i < 101; i++) f.healing.failed(unreadable(`full-${i}`, '999:66@lid'));
    assert.deepEqual(f.handovers, ['full-0']);
    assert.equal(f.healing.status().pending, 100);
});

test('old failures cannot leave a permanent phone relink alarm after they leave recovery', async (t) => {
    const f = recovery(t);
    for (let i = 0; i < 5; i++) f.healing.failed(unreadable(`stale-${i}`, '999@lid'));
    f.advance(5 * MINUTE);
    assert.equal(f.healing.ownSessionBroken(), true);
    f.advance(2 * 60 * MINUTE);
    await f.healing.tick();
    assert.equal(f.healing.status().pending, 0);
    assert.equal(f.healing.status().needsRelink, false);
    assert.equal(f.handovers.length, 5);
});

test('failed phone session refreshes never count as successful repairs or request relink', async (t) => {
    const f = recovery(t);
    f.socket.assertSessions = async () => { throw new Error('Connection Closed'); };
    for (let i = 0; i < 5; i++) f.healing.failed(unreadable(`phone-${i}`, '999@lid'));
    for (let i = 0; i < 45; i++) { f.advance(MINUTE); await f.healing.tick(); }
    assert.equal(f.healing.state.sessionRefreshes, 0);
    assert.equal(f.healing.needsRelink(), false);
});

test('admin repair has a persistent cooldown and does not reconnect the account', async (t) => {
    const f = recovery(t);
    f.healing.failed(unreadable('admin', '999:66@lid'));
    f.advance(2 * MINUTE);
    await f.healing.tick();
    const restored = new MessageHealing(f.options);
    restored.start();
    t.after(() => restored.stop());
    f.advance(MINUTE);
    await restored.tick();
    assert.deepEqual(f.sessions, [['999:66@lid']]);
    assert.equal(f.reconnects(), 0);
    assert.deepEqual(f.handovers, ['admin']);
});

test('a hung admin renewal hits its deadline without disconnecting the other devices', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = recovery(t);
    f.socket.assertSessions = () => new Promise(() => {});
    f.healing.failed(unreadable('hung-admin', '999:66@lid'));
    f.advance(2 * MINUTE);
    const work = f.healing.tick();
    await Promise.resolve();
    t.mock.timers.tick(RECOVERY_OPERATION_MS);
    await work;
    assert.equal(f.healing.working, null);
    assert.equal(f.reconnects(), 0);
    await f.healing.tick();
    assert.deepEqual(f.resends, ['hung-admin']);
});

test('readable admin messages cannot declare the main phone session repaired', async (t) => {
    const f = recovery(t);
    for (let i = 0; i < 5; i++) f.healing.failed(unreadable(`phone-${i}`, '999@lid'));
    f.healing.failed(unreadable('admin', '999:66@lid'));
    f.advance(5 * MINUTE);
    assert.equal(f.healing.ownSessionBroken(), true);
    f.healing.received(unreadable('admin').key);
    assert.equal(f.healing.ownSessionBroken(), true);
    f.healing.received(unreadable('phone-0').key);
    assert.equal(f.healing.ownSessionBroken(), false);
});

test('confirmed phone recovery stays confirmed after restart despite older pending messages', (t) => {
    const f = recovery(t);
    for (let i = 0; i < 6; i++) f.healing.failed(unreadable(`phone-${i}`, '999@lid'));
    f.advance(5 * MINUTE);
    assert.equal(f.healing.ownSessionBroken(), true);
    f.healing.received(unreadable('phone-0').key);
    assert.equal(f.healing.ownSessionBroken(), false);
    const restored = new MessageHealing(f.options);
    assert.equal(restored.ownSessionBroken(), false);
    assert.equal(restored.status().pending, 5);
});

test('a known duplicate after restart never refreshes sessions, holds customers or requests QR', async (t) => {
    const seen = new Set();
    const f = recovery(t, { markSeen: (id) => seen.add(id), wasSeen: (id) => seen.has(id) });
    f.healing.received(unreadable('duplicate').key);
    const restored = new MessageHealing(f.options);
    const duplicate = unreadable('duplicate', '999:12@lid', 'Key used already or never filled');
    assert.equal(restored.failed(duplicate), true);
    assert.equal(restored.waitingForOwn(customer), false);
    assert.equal(restored.status().pending, 0);
    assert.equal(restored.status().needsRelink, false);
    f.healing.failed(unreadable('unproven', '999:66@lid', 'Key used already or never filled'));
    f.advance(2 * MINUTE);
    await f.healing.tick();
    assert.equal(f.sessions.length, 0);
    assert.equal(f.healing.status().pending, 1);
});

function sendingSession() {
    const key = `multi-${++sequence}`;
    const stamp = now();
    const id = Number(run('INSERT INTO wa_sessions ("key", label, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [key, key, 'connected', stamp, stamp]).lastInsertRowid);
    const bot = new Bot({ isActive: () => true });
    const session = new Session({ id, key, label: key }, bot);
    session.state = 'connected';
    let release, started, sent = 0;
    const gate = new Promise((resolve) => { release = resolve; });
    const composing = new Promise((resolve) => { started = resolve; });
    session.socket = {
        sendPresenceUpdate: async (state) => { if (state === 'composing') { started(); await gate; } },
        sendMessage: async () => { sent++; return {}; },
    };
    enqueueDelivery(key, customer, { type: 'text', text: 'simulated answer' }, key, 'ai');
    return { key, bot, session, release, composing, sent: () => sent };
}

test('admin takeover during typing prevents the queued bot message reaching WhatsApp', async (t) => {
    const original = config.bot.typingMs;
    config.bot.typingMs = 0;
    t.after(() => { config.bot.typingMs = original; });
    const f = sendingSession();
    const flushing = f.bot.flushPending(f.key, f.session, customer);
    await f.composing;
    f.bot.onOwnMessage(f.key, { jid: customer, id: 'admin-reply', text: 'Saya bantu ya' });
    f.release();
    await flushing;
    assert.equal(f.sent(), 0);
    assert.equal(pendingDeliveries(f.key).length, 0);
    assert.equal(loadConversation(f.key, customer).step, 'handed_over');
});

test('unreadable admin message arriving during typing blocks delivery then hands only that chat to CS', async (t) => {
    const original = config.bot.typingMs;
    config.bot.typingMs = 0;
    t.after(() => { config.bot.typingMs = original; });
    const f = sendingSession();
    const clock = Date.now();
    let at = clock;
    f.session.healing.clock = () => at;
    const flushing = f.bot.flushPending(f.key, f.session, customer);
    await f.composing;
    f.session.healing.failed(unreadable('admin-unreadable', '999:66@lid'));
    f.release();
    await assert.rejects(flushing, { code: 'RECOVERY_PENDING' });
    assert.equal(f.sent(), 0);
    at += 3 * MINUTE;
    f.session.healing.waitingForOwn(customer);
    assert.equal(pendingDeliveries(f.key).length, 0);
    assert.equal(loadConversation(f.key, customer).handover_reason, 'pesan perangkat toko belum terbaca');
    assert.equal(loadConversation(f.key, '628222222222@s.whatsapp.net').step, 'new');
});
