import './setup.js';

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { Session } from '../src/session.js';
import { Bot } from '../src/bot/bot.js';
import { config } from '../src/config.js';
import { get, getSetting, now, run, setSetting } from '../src/db.js';
import { pendingDeliveries, rememberRetryMessage, retryMessage } from '../src/delivery.js';
import { classifyWithRules } from '../src/bot/classify-rules.js';
import { makePlaceholderCache } from '../src/baileys-fixes.js';
import { withLidFallback } from '../src/lid.js';
import { recap } from '../src/maintenance.js';
import * as store from '../src/bot/store.js';

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
let serial = 0;
const transport = (send) => ({ newMessageId: () => `RECOVERY-${++serial}`, send });
const reset = () => {
    for (const table of ['outgoing_queue', 'wa_retry_messages', 'conversations', 'message_log']) run(`DELETE FROM ${table}`);
};

function fakeSession(over = {}) {
    const key = `test-${++serial}`;
    const stamp = now();
    const row = { id: Number(run(`INSERT INTO wa_sessions ("key", label, status, created_at, updated_at) VALUES (?, ?, 'disconnected', ?, ?)`, [key, key, stamp, stamp]).lastInsertRowid), key, label: key };
    const sockets = [];
    const configs = [];
    let cleared = 0;
    const deps = {
        authState: async () => ({ state: { creds: { me: { id: '628999:1@s.whatsapp.net' } }, keys: { get: async () => ({}), set: async () => {} } }, saveCreds: async () => {}, clear: async () => cleared++ }),
        fetchVersion: async () => ({ version: [2, 3000, 1] }),
        makeSocket(options) {
            configs.push(options);
            const ev = new EventEmitter();
            const socket = { ev, ws: new EventEmitter(), user: { id: '628999:1@s.whatsapp.net' }, signalRepository: { decryptMessage: async () => Buffer.from('ok') }, end: (error) => ev.emit('connection.update', { connection: 'close', lastDisconnect: { error } }) };
            sockets.push(socket);
            return socket;
        },
        ...over,
    };
    const bot = { flushPending: async () => {}, isBotMessage: () => false };
    const session = new Session(row, bot, deps);
    return { session, sockets, configs, bot, cleared: () => cleared };
}

test('internet unavailable before socket creation: every failed attempt schedules the next; stop cancels recovery', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    let online = false;
    const { session, sockets, cleared } = fakeSession({ fetchVersion: async (options) => {
        assert.equal(options.timeout, 10000);
        if (!online) throw new Error('ENOTFOUND');
        return { version: [2, 3000, 1] };
    } });
    try {
        await assert.rejects(session.start(), /ENOTFOUND/);
        assert.equal(session.state, 'disconnected');
        t.mock.timers.tick(2000);
        await settle();
        assert.equal(session.attempts, 2, 'the failed reconnect did not end the loop');
        online = true;
        t.mock.timers.tick(4000);
        await settle();
        assert.equal(sockets.length, 1);
        sockets[0].ev.emit('connection.update', { connection: 'open' });
        await settle();
        assert.equal(session.state, 'connected');
        assert.equal(cleared(), 0, 'network failure never wipes pairing');
        await session.stop();
        sockets[0].ev.emit('connection.update', { connection: 'close' });
        t.mock.timers.tick(60000);
        await settle();
        assert.equal(sockets.length, 1);
    } finally {
        await session.stop();
        t.mock.timers.reset();
    }
});

test('keep-alive timeout closes the stuck socket, reconnects and resumes delivery; old socket events are ignored', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const { session, sockets, configs, bot } = fakeSession();
    let flushes = 0;
    bot.flushPending = async () => flushes++;
    try {
        await session.start();
        sockets[0].ev.emit('connection.update', { connection: 'open' });
        await settle();
        assert.equal(flushes, 1);
        configs[0].logger.error({ trace: 'Timed Out' }, 'error in sending keep alive');
        await settle();
        assert.equal(session.state, 'disconnected');
        t.mock.timers.tick(2000);
        await settle();
        assert.equal(sockets.length, 2);
        sockets[1].ev.emit('connection.update', { connection: 'open' });
        await settle();
        sockets[0].ev.emit('connection.update', { connection: 'close' });
        await settle();
        assert.equal(session.state, 'connected');
        assert.equal(session.socket, sockets[1]);
        t.mock.timers.tick(30000);
        await settle();
        assert.equal(flushes, 3, 'periodic recovery stays active after opening');
    } finally {
        await session.stop();
        t.mock.timers.reset();
    }
});

test('stop while HTTP version lookup is waiting cannot create a ghost socket', async () => {
    let finish;
    const { session, sockets } = fakeSession({ fetchVersion: () => new Promise((resolve) => { finish = resolve; }) });
    const starting = session.start();
    await settle();
    await session.stop();
    finish({ version: [2, 3000, 1] });
    await starting;
    assert.equal(sockets.length, 0);
    assert.equal(session.state, 'disconnected');
});

test('logout and competing-device conflict remain terminal; only a real logout clears credentials', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
        for (const code of [401, 440]) {
            const { session, sockets, cleared } = fakeSession();
            await session.start();
            sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { message: 'terminal', output: { statusCode: code } } } });
            await settle();
            assert.equal(session.state, code === 401 ? 'logged_out' : 'replaced');
            assert.equal(cleared(), code === 401 ? 1 : 0);
            t.mock.timers.tick(120000);
            await settle();
            assert.equal(sockets.length, 1);
            await session.stop();
        }
    } finally { t.mock.timers.reset(); }
});

test('catalog timeout keeps the last good catalog and retries after the initial three attempts', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const session = new Session({ id: 999, key: 'catalog-recovery', label: 'Catalog' }, null);
    let online = false;
    let calls = 0;
    session.state = 'connected';
    session.socket = { user: { id: '628999:1@s.whatsapp.net' }, getCatalog: async () => {
        calls++;
        if (!online) throw new Error('Timed Out');
        return { products: [{ id: 'cached-jersey', name: 'Jersey', description: '' }] };
    } };
    run(`INSERT OR REPLACE INTO catalog_items (id, name, position) VALUES ('last-good', 'Jersey lama', 0)`);
    try {
        await session.syncCatalogWithRetry(2);
        assert.ok(get(`SELECT 1 FROM catalog_items WHERE id = 'last-good'`));
        online = true;
        t.mock.timers.tick(30 * 60000);
        await settle();
        assert.equal(calls, 2);
        assert.ok(get(`SELECT 1 FROM catalog_items WHERE id = 'cached-jersey'`));
        assert.equal(getSetting('catalog:error'), '');
    } finally {
        await session.stop();
        run('DELETE FROM catalog_items');
        t.mock.timers.reset();
    }
});

test('a failed bubble is durable, resumes after creating a new Bot, keeps its ID and does not repeat successful bubbles', async () => {
    reset();
    const jid = '628111@s.whatsapp.net';
    const sent = [];
    let online = false;
    const wa = transport(async (to, action, id) => {
        if (sent.length === 1 && !online) throw new Error('Connection Closed');
        sent.push({ to, action, id });
    });
    const bot = new Bot({ isActive: () => true, classify: async () => ({ intent: 'product', product: 'jersey', name: 'Budi', origin: 'Jogja', extras: [], source: 'rules' }) });
    await assert.rejects(bot.handle('utama', wa, jid, { texts: ['mau jersey'], hasImage: false }), /Connection Closed/);
    assert.equal(sent.length, 1);
    const pending = pendingDeliveries('utama');
    assert.ok(pending.length >= 2, 'the catalog and follow-up are not lost');
    assert.equal(store.loadConversation('utama', jid).step, 'awaiting_quantity');
    online = true;
    const restarted = new Bot({ isActive: () => true });
    await Promise.all([restarted.flushPending('utama', wa), restarted.flushPending('utama', wa)]);
    assert.equal(pendingDeliveries('utama').length, 0);
    assert.deepEqual(sent.slice(1).map((m) => m.id), pending.map((m) => m.id));
    assert.equal(new Set(sent.map((m) => m.id)).size, sent.length, 'concurrent recovery sends each row once');
});

test('CS takeover cancels queued customer replies; customer retry outside active hours waits', async () => {
    reset();
    const jid = '628112@s.whatsapp.net';
    const wa = transport(async () => { throw new Error('Connection Closed'); });
    const bot = new Bot({ isActive: () => true, classify: async () => ({ intent: 'greeting', extras: [], source: 'rules' }) });
    await assert.rejects(bot.handle('utama', wa, jid, { texts: ['halo'] }));
    assert.ok(pendingDeliveries('utama').length);
    let sent = 0;
    const daytime = new Bot({ isActive: () => false });
    await daytime.flushPending('utama', transport(async () => sent++));
    assert.equal(sent, 0);
    bot.onOwnMessage('utama', { jid, id: 'CS-reply', text: 'Halo, saya bantu ya' });
    await bot.flushPending('utama', transport(async () => sent++));
    assert.equal(sent, 0);
    assert.equal(pendingDeliveries('utama').length, 0);
});

test('a new customer message is still recorded in the order while the previous reply cannot be sent', async () => {
    reset();
    const bot = new Bot({ isActive: () => true, classify: async (input) => classifyWithRules(input) });
    const wa = transport(async () => { throw new Error('Connection Closed'); });
    const jid = '628114@s.whatsapp.net';
    await assert.rejects(bot.handle('utama', wa, jid, { texts: ['halo'] }));
    await assert.rejects(bot.handle('utama', wa, jid, { texts: ['saya Budi dari Jogja mau bikin jersey'] }));
    assert.equal(store.loadConversation('utama', jid).product, 'jersey');
    assert.ok(pendingDeliveries('utama').some((row) => row.action.type === 'file'));
});

test('stale customer replies are escalated to CS rather than sent on the following day', async () => {
    reset();
    const bot = new Bot({ isActive: () => true, classify: async (input) => classifyWithRules(input) });
    const jid = '628115@s.whatsapp.net';
    await assert.rejects(bot.handle('utama', transport(async () => { throw new Error('Connection Closed'); }), jid, { texts: ['halo'] }));
    run(`UPDATE outgoing_queue SET created_at = datetime('now', '-16 minutes')`);
    await bot.flushPending('utama', transport(async () => assert.fail('stale message should not be sent')));
    assert.equal(pendingDeliveries('utama').length, 0);
    assert.match(store.loadConversation('utama', jid).handover_reason, /15 menit/);
});

test('a redelivered incoming message is processed once, and duplicate CS echoes do not extend takeover', async () => {
    reset();
    const bot = new Bot({ isActive: () => true, debounceMs: 5, classify: async () => ({ intent: 'greeting', extras: [], source: 'rules' }) });
    let sent = 0;
    const wa = transport(async () => sent++);
    const event = { jid: '628113@s.whatsapp.net', id: 'IN-duplicate', text: 'halo' };
    bot.onIncoming('utama', wa, event);
    bot.onIncoming('utama', wa, event);
    await bot.drain();
    assert.equal(sent, 1);
    bot.onOwnMessage('utama', { ...event, id: 'CS-duplicate' });
    bot.onOwnMessage('utama', { ...event, id: 'CS-duplicate' });
    assert.equal(get(`SELECT count(*) AS n FROM message_log WHERE wa_message_id = 'CS-duplicate'`).n, 1);
});

test('morning recap retries only the failed recipient, including after a restart', async () => {
    reset();
    const before = config.recap.to;
    config.recap.to = ['628201', '628202'];
    setSetting('recap:last_sent', '2000-01-01 00:00:00');
    setSetting('recap:pending', '');
    store.saveConversation('utama', '628111@s.whatsapp.net', { step: 'awaiting_design', product: 'kaos' });
    const sent = [];
    let online = false;
    const wa = { ...transport(async (jid, action, id) => {
        if (jid.startsWith('628202') && !online) throw new Error('Connection Closed');
        sent.push({ jid, id, text: action.text });
    }), key: 'utama' };
    const manager = { defaultSession: async () => wa };
    try {
        await assert.rejects(recap({ manager, bot: new Bot({ isActive: () => false }) }), /Connection Closed/);
        assert.equal(sent.length, 1);
        assert.ok(getSetting('recap:pending'));
        const id = pendingDeliveries('utama')[0].id;
        online = true;
        await recap({ manager, bot: new Bot({ isActive: () => false }) });
        assert.equal(sent.length, 2);
        assert.equal(sent[1].id, id);
        assert.equal(sent[0].text, sent[1].text);
        assert.equal(getSetting('recap:pending'), '');
        assert.notEqual(getSetting('recap:last_sent'), '2000-01-01 00:00:00');
    } finally { config.recap.to = before; }
});

test('WhatsApp retry gets the actual stored media protobuf; old recap text is also recoverable', () => {
    reset();
    const message = { key: { id: 'media-id', remoteJid: '6281@s.whatsapp.net' }, message: { imageMessage: { url: 'https://example.com/image', mediaKey: Buffer.from([1, 2, 3]), fileSha256: Buffer.from([4, 5, 6]), caption: 'Size chart' } } };
    rememberRetryMessage('utama', message);
    const retried = retryMessage('utama', message.key);
    assert.deepEqual(Buffer.from(retried.imageMessage.mediaKey), Buffer.from([1, 2, 3]));
    assert.equal(retried.imageMessage.caption, 'Size chart');
    assert.equal(retryMessage('other', message.key), undefined, 'session stores are isolated');
    store.logMessage({ sessionKey: 'utama', jid: '6281@s.whatsapp.net', direction: 'out', waMessageId: 'old-recap', text: 'Rekap semalam' });
    assert.equal(retryMessage('utama', { id: 'old-recap' }).conversation, 'Rekap semalam');
});

test('duplicate ciphertext across reconnects reuses the successful decrypt instead of consuming the Signal key again', async () => {
    const cache = makePlaceholderCache();
    let calls = 0;
    const make = () => withLidFallback({ decryptMessage: async () => { calls++; if (calls > 1) throw new Error('Key used already or never filled'); return Buffer.from('decrypted'); } }, () => null, cache);
    const args = { jid: '123@lid', type: 'msg', ciphertext: Buffer.from('ciphertext') };
    const first = make();
    const results = await Promise.all([first.decryptMessage(args), first.decryptMessage(args)]);
    assert.equal(results[0].toString(), 'decrypted');
    results[0].fill(0);
    assert.equal((await make().decryptMessage(args)).toString(), 'decrypted', 'callers cannot mutate the cached plaintext');
    assert.equal(calls, 1);
    await assert.rejects(first.decryptMessage({ ...args, ciphertext: Buffer.from('other') }), /Key used/);
    await assert.rejects(first.decryptMessage({ ...args, ciphertext: Buffer.from('other') }), /Key used/);
    assert.equal(calls, 3, 'failures are never cached, allowing WhatsApp to recover with a fresh session');
});
