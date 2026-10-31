import './setup.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Bot } from '../src/bot/bot.js';
import { chatTurn } from '../src/bot/chat.js';
import { config } from '../src/config.js';
import { get, now, openDatabase, run } from '../src/db.js';
import { enqueueIncoming, incomingRows } from '../src/inbox.js';
import { pendingDeliveries } from '../src/delivery.js';
import { Session } from '../src/session.js';
import { withDeadline } from '../src/deadline.js';
import * as store from '../src/bot/store.js';

const JID = '628333@s.whatsapp.net';
const KEY = 'unattended';
let serial = 0;
const turn = (text = 'Balasan berhasil') => ({ actions: [{ type: 'text', text }], patch: { step: 'chat', product: 'kaos' } });
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
function setup(t) {
    for (const table of ['incoming_queue', 'outgoing_queue', 'conversations', 'message_log']) run('DELETE FROM ' + table);
    const before = config.bot.mode;
    config.bot.mode = 'ai';
    t.after(() => { config.bot.mode = before; });
    const sent = [];
    const transport = { newMessageId: () => 'UNATTENDED-' + ++serial, send: async (jid, action, id) => sent.push({ jid, action, id }) };
    const make = (chat, extra = {}) => new Bot({ chat, isActive: () => true, debounceMs: 60000, ...extra });
    return { sent, transport, make };
}
function receive(id, text, extra = {}) {
    store.logMessage({ sessionKey: KEY, jid: JID, direction: 'in', waMessageId: id, text });
    enqueueIncoming(KEY, JID, id, { text, ...extra });
}
function due() { run("UPDATE incoming_queue SET next_attempt_at = datetime('now')"); }

test('restart during debounce retains the exact input, attachment and quoted context and logs it only once', async (t) => {
    const f = setup(t);
    const original = f.make(async () => assert.fail('original process never reaches AI'));
    original.onIncoming(KEY, f.transport, { jid: JID, id: 'restart-input', text: 'desain ini ya', hasImage: true, attachment: { kind: 'gambar', note: 'referensi' }, quoted: 'Pesan yang dibalas' });
    for (const buffer of original.buffers.values()) clearTimeout(buffer.timer); // Simulate abrupt process exit.
    assert.equal(incomingRows(KEY).length, 1);
    const restarted = f.make(async (conv, input) => {
        assert.equal(input.text, 'desain ini ya');
        assert.equal(input.attachments[0].note, 'referensi');
        assert.equal(input.quoted, 'Pesan yang dibalas');
        return turn();
    });
    await restarted.recoverIncoming(KEY, f.transport);
    assert.equal(f.sent.length, 1);
    assert.equal(incomingRows(KEY).length, 0);
    assert.equal(get("SELECT COUNT(*) AS n FROM message_log WHERE direction = 'in'").n, 1);
});

test('AI outage retries the original request after restart without repeating the greeting', async (t) => {
    const f = setup(t);
    const original = f.make(async () => ({ actions: [{ type: 'text', text: 'Sapaan awal' }], patch: { step: 'chat' }, silent: 'Ollama 503', retryable: true }));
    original.onIncoming(KEY, f.transport, { jid: JID, id: 'ai-outage', text: 'bahan kaosnya apa' });
    await original.drain();
    assert.equal(f.sent[0].action.text, 'Sapaan awal');
    assert.equal(incomingRows(KEY)[0].attempts, 1);
    due();
    const restarted = f.make(async (conv, input) => {
        assert.equal(conv.step, 'chat');
        assert.equal(input.text, 'bahan kaosnya apa');
        return turn('Bahan sudah bisa dijawab');
    });
    await restarted.recoverIncoming(KEY, f.transport);
    assert.deepEqual(f.sent.map((m) => m.action.text), ['Sapaan awal', 'Bahan sudah bisa dijawab']);
    assert.equal(incomingRows(KEY).length, 0);
});

test('an AI task that never resolves is released by the outer deadline; its late result cannot overwrite a recovered turn', async (t) => {
    const f = setup(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const previousTimeout = config.ollama.timeoutMs;
    config.ollama.timeoutMs = 100;
    let finish;
    const blocked = f.make(() => new Promise((resolve) => { finish = resolve; }));
    try {
        blocked.onIncoming(KEY, f.transport, { jid: JID, id: 'hung-ai-input', text: 'Pertanyaan yang harus dicoba lagi' });
        const job = blocked.drain();
        await settle();
        t.mock.timers.tick(15200);
        await job;
        assert.equal(incomingRows(KEY)[0].attempts, 1);
        due();
        await f.make(async () => turn('Jawaban setelah pulih')).recoverIncoming(KEY, f.transport);
        finish(turn('Jawaban lama yang terlambat'));
        await settle();
        assert.deepEqual(f.sent.map((m) => m.action.text), ['Jawaban setelah pulih']);
    } finally { config.ollama.timeoutMs = previousTimeout; t.mock.timers.reset(); }
});

test('output failure commits inbox completion and outbox together; recovery resends output without asking AI twice', async (t) => {
    const f = setup(t);
    const bot = f.make(async () => turn());
    const offline = { ...f.transport, send: async () => { throw new Error('Connection Closed'); } };
    bot.onIncoming(KEY, offline, { jid: JID, id: 'atomic-turn', text: 'mau kaos' });
    await bot.drain();
    assert.equal(incomingRows(KEY).length, 0);
    const pending = pendingDeliveries(KEY);
    assert.equal(pending.length, 1);
    const restarted = f.make(async () => assert.fail('turn is already computed'));
    await restarted.recoverIncoming(KEY, f.transport);
    await restarted.flushPending(KEY, f.transport);
    assert.equal(f.sent[0].id, pending[0].id);
    assert.equal(pendingDeliveries(KEY).length, 0);
});

test('network AI failures are retryable; rejected answers become visible CS follow-up without sending unsafe text', async (t) => {
    const f = setup(t);
    const before = config.ollama.apiKey;
    config.ollama.apiKey = 'test-key';
    t.after(() => { config.ollama.apiKey = before; });
    const media = { has: () => false };
    const retry = await chatTurn({ step: 'chat' }, { text: 'bahan kaos?', who: 'network-retry' }, { media, ask: async () => { throw new Error('Ollama 503'); } });
    assert.equal(retry.retryable, true);
    const refused = await chatTurn({ step: 'chat' }, { text: 'bahan kaos?', who: 'guard-no-retry' }, { media, ask: async () => { throw Object.assign(new Error('balasan AI ditolak'), { refused: true }); } });
    assert.equal(refused.retryable, false);
    const bot = f.make(async () => refused);
    bot.onIncoming(KEY, f.transport, { jid: JID, id: 'unsafe-refused', text: 'bahan kaos?' });
    await bot.drain();
    assert.equal(f.sent.length, 0);
    assert.equal(incomingRows(KEY).length, 0);
    assert.equal(store.loadConversation(KEY, JID).step, 'handed_over');
    assert.match(store.loadConversation(KEY, JID).handover_reason, /AI tidak dapat menjawab/);
});

test('concurrent recovery ticks and live buffering never run one inbox item twice', async (t) => {
    const f = setup(t);
    receive('concurrent', 'Halo');
    let finish, calls = 0;
    const bot = f.make(() => { calls++; return new Promise((resolve) => { finish = resolve; }); });
    const first = bot.recoverIncoming(KEY, f.transport);
    await settle();
    await bot.recoverIncoming(KEY, f.transport);
    assert.equal(calls, 1);
    finish(turn());
    await first;
    assert.equal(f.sent.length, 1);
});

test('AI history keeps prior bot replies but never misreads pending or future input as earlier conversation', (t) => {
    setup(t);
    receive('history-old-input', 'pertanyaan pertama');
    store.logMessage({ sessionKey: KEY, jid: JID, direction: 'out', waMessageId: 'history-greeting', text: 'Sapaan sudah dikirim' });
    receive('history-future-input', 'pesan susulan yang masih menunggu');
    assert.deepEqual(store.recentHistory(KEY, JID, ['history-old-input'], 12), [{ who: 'bot', text: 'Sapaan sudah dikirim' }]);
});

test('new follow-up combines with an unanswered original request instead of losing it during AI outage', async (t) => {
    const f = setup(t);
    let calls = 0;
    const bot = f.make(async (conv, input) => {
        if (++calls === 1) return { actions: [], patch: { step: 'chat' }, retryable: true, silent: 'fetch failed' };
        assert.equal(input.text, 'mau kaos\nwarna navy');
        return turn();
    });
    bot.onIncoming(KEY, f.transport, { jid: JID, id: 'follow-1', text: 'mau kaos' });
    await bot.drain();
    bot.onIncoming(KEY, f.transport, { jid: JID, id: 'follow-2', text: 'warna navy' });
    await bot.drain();
    assert.equal(incomingRows(KEY).length, 0);
    assert.equal(f.sent.length, 1);
});

test('CS takeover cancels retries; reset while AI is writing discards its stale result', async (t) => {
    const f = setup(t);
    receive('cancel-retry', 'kaos');
    store.markHandover(KEY, JID, 'diambil alih dari konsol');
    const bot = f.make(async () => assert.fail('CS owns this chat'));
    await bot.recoverIncoming(KEY, f.transport);
    assert.equal(incomingRows(KEY).length, 0);
    store.resetConversation(KEY, JID);
    let finish;
    const pendingBot = f.make(() => new Promise((resolve) => { finish = resolve; }));
    pendingBot.onIncoming(KEY, f.transport, { jid: JID, id: 'reset-writing', text: 'mau jersey' });
    const processing = pendingBot.drain();
    await settle();
    store.resetConversation(KEY, JID);
    finish(turn('Jawaban lama harus dibatalkan'));
    await processing;
    assert.equal(f.sent.length, 0);
    assert.equal(store.loadConversation(KEY, JID).step, 'new');
});

test('retry limit, corrupt inbox and expired input become CS follow-up, never delayed spam', async (t) => {
    const f = setup(t);
    for (const scenario of ['limit', 'expired', 'corrupt']) {
        store.resetConversation(KEY, JID);
        receive('bad-' + scenario, 'Pesan pelanggan untuk CS');
        if (scenario === 'limit') run('UPDATE incoming_queue SET attempts = 5');
        if (scenario === 'expired') run("UPDATE incoming_queue SET created_at = datetime('now', '-16 minutes')");
        if (scenario === 'corrupt') run("UPDATE incoming_queue SET payload = '{'");
        await f.make(async () => assert.fail('no stale response')).recoverIncoming(KEY, f.transport);
        assert.equal(incomingRows(KEY).length, 0);
        assert.equal(store.loadConversation(KEY, JID).step, 'handed_over');
    }
    assert.equal(f.sent.length, 0);
});

test('late offline messages are recorded once for CS and keep an existing CS takeover', (t) => {
    setup(t);
    const bot = new Bot();
    bot.onMissedIncoming(KEY, { jid: JID, id: 'late', text: 'Pertanyaan semalam' });
    bot.onMissedIncoming(KEY, { jid: JID, id: 'late', text: 'Pertanyaan semalam' });
    assert.equal(store.loadConversation(KEY, JID).step, 'handed_over');
    assert.equal(get("SELECT COUNT(*) AS n FROM message_log WHERE direction = 'in'").n, 1);
    store.markHandover(KEY, JID, 'CS membalas');
    bot.onMissedIncoming(KEY, { jid: JID, id: 'another-late', text: 'Pertanyaan lain' });
    assert.equal(store.loadConversation(KEY, JID).handover_reason, 'CS membalas');
});

test('a stuck network promise hits its deadline and a late rejection is safely consumed', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let fail;
    const work = withDeadline(() => new Promise((resolve, reject) => { fail = reject; }), 1000, 'test operation');
    const checked = assert.rejects(work, (error) => error.code === 'ETIMEDOUT');
    await settle();
    t.mock.timers.tick(1000);
    await checked;
    fail(new Error('old socket eventually closes'));
    await settle();
    t.mock.timers.reset();
});

test('handshake watchdog replaces a stuck socket; repeated start cannot create competing connections', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const stamp = now();
    const id = Number(run('INSERT INTO wa_sessions ("key", label, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', ['watchdog', 'Watchdog', 'disconnected', stamp, stamp]).lastInsertRowid);
    const sockets = [];
    const session = new Session({ id, key: 'watchdog', label: 'Watchdog' }, { isBotMessage: () => false }, {
        fetchVersion: async () => ({ version: [2, 3000, 1] }),
        makeSocket: () => {
            const ev = new EventEmitter();
            const socket = { ev, ws: new EventEmitter(), signalRepository: { decryptMessage: async () => Buffer.from('ok') }, end: (error) => ev.emit('connection.update', { connection: 'close', lastDisconnect: { error } }) };
            sockets.push(socket);
            return socket;
        },
    });
    try {
        await session.start();
        await session.start();
        assert.equal(sockets.length, 1);
        t.mock.timers.tick(120000);
        await settle();
        assert.equal(session.state, 'disconnected');
        t.mock.timers.tick(2000);
        await settle();
        assert.equal(sockets.length, 2);
    } finally { await session.stop(); t.mock.timers.reset(); }
});

test('fault soak: 100 inputs survive AI failures, network drops and repeated process replacement without duplicate output', async (t) => {
    const f = setup(t);
    const attempts = new Map(), failedSends = new Set();
    const model = async (conv, input) => {
        const request = input.text;
        const n = (attempts.get(request) ?? 0) + 1;
        attempts.set(request, n);
        const index = Number(request.replace('request-', ''));
        if (index % 3 === 0 && n === 1) return { actions: [], patch: { step: 'chat' }, retryable: true, silent: 'Ollama 503' };
        return turn('Jawaban ' + request);
    };
    const transport = { ...f.transport, send: async (jid, action, id) => {
        const index = Number(action.text.replace('Jawaban request-', ''));
        if (index % 5 === 0 && !failedSends.has(id)) {
            failedSends.add(id);
            throw new Error('Connection Closed');
        }
        await f.transport.send(jid, action, id);
    } };
    let bot = f.make(model);
    for (let i = 0; i < 100; i++) bot.onIncoming(KEY, transport, { jid: '628900' + i + '@s.whatsapp.net', id: 'soak-input-' + i, text: 'request-' + i });
    for (const b of bot.buffers.values()) clearTimeout(b.timer); // Initial process disappears before debounce.
    for (let sweep = 0; sweep < 100 && (incomingRows(KEY).length || pendingDeliveries(KEY).length); sweep++) {
        if (sweep % 4 === 0) bot = f.make(model);
        due();
        await bot.recoverIncoming(KEY, transport);
        await bot.flushPending(KEY, transport).catch(() => {});
    }
    assert.equal(incomingRows(KEY).length, 0);
    assert.equal(pendingDeliveries(KEY).length, 0);
    assert.equal(f.sent.length, 100);
    assert.equal(new Set(f.sent.map((m) => m.id)).size, 100);
    assert.equal(new Set(f.sent.map((m) => m.action.text)).size, 100);
    assert.ok([...attempts.values()].every((n) => n <= 2));
    assert.equal(get("SELECT COUNT(*) AS n FROM message_log WHERE direction = 'in'").n, 100);
    assert.equal(bot.claimedIncoming.size, 0);
});

test('a hung WhatsApp send times out and closes its socket so the outbox can recover on a new connection', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const typing = config.bot.typingMs;
    config.bot.typingMs = 0;
    const stamp = now();
    const id = Number(run('INSERT INTO wa_sessions ("key", label, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', ['send-watchdog', 'Send watchdog', 'disconnected', stamp, stamp]).lastInsertRowid);
    let socket, started = false, closed = false;
    const session = new Session({ id, key: 'send-watchdog', label: 'Send watchdog' }, { isBotMessage: () => false, flushPending: async () => {} }, {
        fetchVersion: async () => ({ version: [2, 3000, 1] }),
        makeSocket: () => {
            const ev = new EventEmitter();
            socket = {
                ev, ws: new EventEmitter(), user: { id: '628999:1@s.whatsapp.net' },
                signalRepository: { decryptMessage: async () => Buffer.from('ok') },
                sendPresenceUpdate: async () => {},
                getCatalog: async () => ({ products: [] }),
                sendMessage: () => { started = true; return new Promise(() => {}); },
                end: (error) => { closed = true; ev.emit('connection.update', { connection: 'close', lastDisconnect: { error } }); },
            };
            return socket;
        },
    });
    try {
        await session.start();
        socket.ev.emit('connection.update', { connection: 'open' });
        await settle();
        const send = session.send(JID, { type: 'text', text: 'Test deadline' }, 'send-deadline');
        const checked = assert.rejects(send, (error) => error.code === 'ETIMEDOUT');
        await settle();
        t.mock.timers.tick(0);
        await settle();
        assert.equal(started, true);
        t.mock.timers.tick(120000);
        await checked;
        await settle();
        assert.equal(closed, true);
        assert.equal(session.state, 'disconnected');
    } finally { await session.stop(); config.bot.typingMs = typing; t.mock.timers.reset(); }
});

test('committed inbox, outbox and conversation state recover from a real abruptly terminated Node process', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prema-crash-recovery-'));
    const file = path.join(dir, 'crash.sqlite');
    const code = [
        "const { openDatabase } = await import('./src/db.js');",
        "const database = openDatabase(process.argv[1]);",
        "database.transaction(() => {",
        "database.prepare(\"INSERT INTO incoming_queue (session_key, message_id, jid, payload, next_attempt_at, created_at) VALUES ('crash', 'in-1', 'customer@lid', '{}', '2026-01-01', '2026-01-01')\").run();",
        "database.prepare(\"INSERT INTO outgoing_queue (id, session_key, jid, action, created_at) VALUES ('out-1', 'crash', 'customer@lid', '{}', '2026-01-01')\").run();",
        "database.prepare(\"INSERT INTO conversations (session_key, jid, step, product) VALUES ('crash', 'customer@lid', 'chat', 'kaos')\").run();",
        "})();",
        "process.kill(process.pid, 'SIGKILL');", // No database.close(), simulates abrupt process termination.
    ].join('\n');
    let reopened;
    try {
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', code, file], {
            cwd: process.cwd(), env: { ...process.env, DB_PATH: ':memory:', LOG_LEVEL: 'silent' }, windowsHide: true, timeout: 15000, encoding: 'utf8',
        });
        assert.notEqual(result.status, 0, 'child must terminate abruptly');
        reopened = openDatabase(file);
        assert.equal(reopened.prepare("SELECT COUNT(*) AS n FROM incoming_queue WHERE message_id = 'in-1'").get().n, 1, result.stderr);
        assert.equal(reopened.prepare("SELECT COUNT(*) AS n FROM outgoing_queue WHERE id = 'out-1'").get().n, 1);
        assert.equal(reopened.prepare("SELECT product FROM conversations WHERE session_key = 'crash'").get().product, 'kaos');
        assert.equal(reopened.pragma('integrity_check', { simple: true }), 'ok');
    } finally {
        reopened?.close();
        assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('an input that crashes five successive real Node processes is quarantined for CS rather than causing an endless restart loop', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prema-poison-recovery-'));
    const file = path.join(dir, 'poison.sqlite');
    const code = [
        "const { Bot } = await import('./src/bot/bot.js');",
        "const { config } = await import('./src/config.js');",
        "config.bot.mode = 'ai';",
        "const bot = new Bot({ isActive: () => true, chat: async () => { process.kill(process.pid, 'SIGKILL'); } });",
        "const transport = { newMessageId: () => 'unused-output', send: async () => {} };",
        "bot.onIncoming('poison', transport, { jid: 'customer@lid', id: 'poison-input', text: 'Input that triggers a process crash' });",
        "await bot.drain();",
        "await bot.recoverIncoming('poison', transport);",
    ].join('\n');
    let reopened;
    try {
        for (let i = 0; i < 6; i++) {
            const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
                cwd: process.cwd(), env: { ...process.env, DB_PATH: file, LOG_LEVEL: 'silent' }, windowsHide: true, timeout: 15000, encoding: 'utf8',
            });
            if (i < 5) assert.notEqual(result.status, 0, 'first five attempts must actually crash');
            else assert.equal(result.status, 0, result.stderr);
        }
        reopened = openDatabase(file);
        assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM incoming_queue').get().n, 0);
        assert.equal(reopened.prepare("SELECT COUNT(*) AS n FROM message_log WHERE direction = 'in'").get().n, 1);
        assert.equal(reopened.prepare("SELECT step FROM conversations WHERE session_key = 'poison'").get().step, 'handed_over');
    } finally {
        reopened?.close();
        assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
