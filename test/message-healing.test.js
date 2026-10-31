import './setup.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageHealing } from '../src/message-healing.js';
import { sessionHandledLog } from '../src/baileys-fixes.js';
import { withLidFallback } from '../src/lid.js';
import { db, get, now, run } from '../src/db.js';
import { useSqliteAuthState } from '../src/auth-state.js';
import { Session } from '../src/session.js';
import { EventEmitter } from 'node:events';
import { latestErrorId } from '../src/errors.js';
import { proto } from 'baileys';

const failure = (id = 'A523784B5DB48CEEF1B02E0B05F82AFC') => ({
    key: { remoteJid: '255086848700630@lid', fromMe: true, id },
    err: Object.assign(new Error('Invalid PreKey ID'), { name: 'PreKeyError' }),
});
function fixture(t, over = {}) {
    let time = 0, saved = null, reconnects = 0;
    const calls = [], logs = [];
    const socket = {
        uploadPreKeys: async (n) => calls.push(['keys', n]),
        requestPlaceholderResend: async (key) => calls.push(['resend', key.id]),
    };
    const options = {
        socket: () => socket, clock: () => time,
        reconnect: () => reconnects++,
        log: { info: (...args) => logs.push(['info', ...args]), warn: (...args) => logs.push(['warn', ...args]) },
        read: () => saved, write: (state) => { saved = structuredClone(state); }, ...over,
    };
    const healing = new MessageHealing(options);
    healing.start();
    t.after(() => healing.stop());
    return { healing, options, socket, calls, logs, advance: (ms) => { time += ms; }, saved: () => saved, reconnects: () => reconnects };
}

test('Invalid PreKey ID under LID retries the matching phone session without changing keys', async () => {
    const calls = [];
    const repo = { decryptMessage: async (args) => {
        calls.push(args);
        if (args.jid.endsWith('@lid')) throw failure().err;
        return Buffer.from('CS membalas');
    } };
    withLidFallback(repo, () => '6281999911895:0@s.whatsapp.net');
    const ciphertext = Buffer.from('original ciphertext');
    assert.equal((await repo.decryptMessage({ jid: '28067997159547:0@lid', type: 'pkmsg', ciphertext })).toString(), 'CS membalas');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].ciphertext, ciphertext);
    const unknown = { decryptMessage: async () => { throw failure().err; } };
    withLidFallback(unknown, () => null);
    await assert.rejects(unknown.decryptMessage({ jid: 'unknown@lid' }), /Invalid PreKey ID/);
});

test('temporary failures wait for built-in retry, refresh prekeys, request resend and resolve without alarming the user', async (t) => {
    const f = fixture(t);
    assert.equal(f.healing.failed(failure()), true);
    await f.healing.tick();
    assert.deepEqual(f.calls, []);
    f.advance(30000);
    await f.healing.tick();
    assert.deepEqual(f.calls, [['keys', 5], ['resend', failure().key.id]]);
    f.healing.received(failure().key);
    f.advance(6 * 60000);
    await f.healing.tick();
    assert.equal(f.healing.status().pending, 0);
    assert.equal(f.healing.status().recovered, 1);
    assert.equal(f.logs.filter((l) => l[0] === 'warn').length, 0);
    assert.equal(f.reconnects(), 0);
});

test('persistent failure gets a bounded reconnect, one actionable alert, and retains raw diagnostics across restart', async (t) => {
    const f = fixture(t);
    f.healing.failed(failure());
    f.advance(120000);
    await f.healing.tick();
    assert.equal(f.reconnects(), 1);
    f.advance(180000);
    await f.healing.tick();
    assert.equal(f.healing.status().needsAttention, true);
    assert.equal(f.logs.filter((l) => l[0] === 'warn' && !l[1].quiet).length, 1);
    const restored = new MessageHealing(f.options);
    restored.start();
    t.after(() => restored.stop());
    await restored.tick();
    assert.equal(restored.status().pending, 1);
    assert.equal(f.logs.filter((l) => l[0] === 'warn' && !l[1].quiet).length, 1, 'restart cannot repeat the alert');
    assert.equal(f.reconnects(), 1, 'restart respects the reconnect cooldown');
    assert.equal(f.saved().pending[0].error.name, 'PreKeyError');
    assert.match(f.saved().pending[0].error.stack, /Invalid PreKey ID/);
});

test('one unreadable message does not reconnect an otherwise working socket; unrelated success is not false recovery', async (t) => {
    const f = fixture(t);
    f.healing.failed(failure());
    f.advance(1000);
    f.healing.received({ id: 'different-message' });
    f.advance(120000);
    await f.healing.tick();
    assert.equal(f.healing.status().pending, 1);
    assert.equal(f.reconnects(), 0);
    assert.equal(f.calls.filter((c) => c[0] === 'resend').length, 1);
});

test('network failure during key refresh is retried, without parallel jobs or key regeneration loops', async (t) => {
    const f = fixture(t);
    f.socket.uploadPreKeys = async () => { f.calls.push(['failed-upload']); throw new Error('Connection Closed'); };
    f.healing.failed(failure());
    f.advance(30000);
    await Promise.all([f.healing.tick(), f.healing.tick()]);
    assert.equal(f.calls.length, 1);
    f.advance(15000);
    await f.healing.tick();
    assert.equal(f.calls.filter((c) => c[0] === 'failed-upload').length, 1);
    assert.equal(f.calls.filter((c) => c[0] === 'resend').length, 1);
    assert.equal(f.logs.filter((l) => l[0] === 'warn' && !l[1].quiet).length, 0);
});

test('stop while key refresh is in progress prevents resend or reconnect afterwards', async (t) => {
    const f = fixture(t);
    let finish;
    f.socket.uploadPreKeys = () => new Promise((resolve) => { finish = resolve; });
    f.healing.failed(failure());
    f.advance(120000);
    const work = f.healing.tick();
    f.healing.stop();
    finish();
    await work;
    assert.deepEqual(f.calls, []);
    assert.equal(f.reconnects(), 0);
});

test('the five-minute alert still fires while a repair network request is stalled', async (t) => {
    const f = fixture(t);
    let finish;
    f.socket.uploadPreKeys = () => new Promise((resolve) => { finish = resolve; });
    f.healing.failed(failure());
    f.advance(30000);
    const work = f.healing.tick();
    f.advance(5 * 60000);
    f.healing.tick(); // Deliberately not awaited: the first network request is stalled.
    assert.equal(f.logs.filter((l) => l[0] === 'warn').length, 1);
    f.healing.stop();
    finish();
    await work;
});

test('unreadable phone replies hold only that customer; known bot echoes never block delivery', (t) => {
    const f = fixture(t);
    f.healing.failed(failure());
    assert.equal(f.healing.waitingForOwn(failure().key.remoteJid), true);
    assert.equal(f.healing.waitingForOwn('another@lid'), false);
    assert.equal(f.healing.waitingForOwn(failure().key.remoteJid, (j) => j, () => true), false);
    f.healing.received(failure().key);
    assert.equal(f.healing.waitingForOwn(failure().key.remoteJid), false);
});

test('stalled repair is replaced on a fresh connection and an old promise cannot clear the new worker', async (t) => {
    let current;
    const f = fixture(t, { socket: () => current });
    current = f.socket;
    let finishOld, finishNew;
    f.socket.uploadPreKeys = () => new Promise((resolve) => { finishOld = resolve; });
    f.healing.failed(failure());
    f.advance(30000);
    const first = f.healing.tick();
    f.advance(90000);
    f.healing.tick();
    assert.equal(f.reconnects(), 1);
    current = { requestPlaceholderResend: () => new Promise((resolve) => { finishNew = resolve; }) };
    const second = f.healing.tick();
    finishOld();
    await first;
    assert.equal(f.healing.working, second);
    finishNew();
    await second;
    assert.equal(f.healing.working, null);
});

test('corrupt saved recovery state cannot crash startup or permanently disable recovery', (t) => {
    const f = fixture(t, { read: () => ({ pending: [null, { key: {} }], healed: 'bad' }) });
    assert.equal(f.healing.status().pending, 0);
    assert.equal(f.healing.failed(failure()), true);
    assert.equal(f.healing.status().pending, 1);
});

test('the actual Session logger starts healing; ciphertext stubs do not claim success, real phone messages do', async () => {
    const stamp = now();
    const id = Number(run('INSERT INTO wa_sessions ("key", label, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', ['healing-session', 'Healing', 'disconnected', stamp, stamp]).lastInsertRowid);
    let options, socket;
    const own = [];
    const bot = { isBotMessage: () => false, onOwnMessage: (...a) => own.push(a), flushPending: async () => {} };
    const session = new Session({ id, key: 'healing-session', label: 'Healing' }, bot, {
        fetchVersion: async () => ({ version: [2, 3000, 1] }),
        makeSocket: (config) => {
            options = config;
            const ev = new EventEmitter();
            socket = { ev, ws: new EventEmitter(), user: { id: '6281999911895:1@s.whatsapp.net' }, signalRepository: { decryptMessage: async () => Buffer.from('ok') }, end: () => {} };
            return socket;
        },
    });
    try {
        await session.start();
        socket.ev.emit('connection.update', { connection: 'open' });
        await new Promise(setImmediate);
        const before = latestErrorId();
        options.logger.error(failure(), 'failed to decrypt message');
        assert.equal(latestErrorId(), before, 'no immediate popup for recoverable error');
        assert.equal(session.status().healing.pending, 1);
        await assert.rejects(session.send(failure().key.remoteJid, { type: 'text', text: 'Tunggu' }, 'new-id'), (error) => error.code === 'RECOVERY_PENDING');
        socket.ev.emit('messages.upsert', { type: 'notify', messages: [{ key: failure().key, messageStubType: proto.WebMessageInfo.StubType.CIPHERTEXT, message: { conversation: 'Partial content must not count as recovery' } }] });
        await new Promise(setImmediate);
        assert.equal(session.status().healing.pending, 1);
        socket.ev.emit('messages.upsert', { type: 'notify', messages: [{ key: failure().key, message: { conversation: 'Balasan dari HP' } }] });
        await new Promise(setImmediate);
        assert.equal(session.status().healing.pending, 0);
        assert.equal(own.length, 1);
    } finally { await session.stop(); }
});

test('only tracked recoverable errors defer the popup; raw log detail and untrusted identity errors remain visible', (t) => {
    const f = fixture(t);
    const seen = [];
    const log = { error: (...a) => seen.push(a), warn: (...a) => seen.push(a), info() {}, child() { return this; } };
    const wrapped = sessionHandledLog(log, log, () => true, (d) => f.healing.failed(d));
    const raw = failure();
    wrapped.child({ part: 'decrypt' }).error(raw, 'failed to decrypt message');
    assert.equal(seen[0][0].quiet, true);
    assert.equal(seen[0][0].err, raw.err, 'original Error and stack are retained');
    wrapped.error({ key: raw.key, err: new Error('Untrusted identity key') }, 'failed to decrypt message');
    assert.equal(seen[1][0].quiet, undefined);
    wrapped.error({ trace: 'Timed Out' }, 'error in sending keep alive');
    assert.equal(seen[2][0].quiet, true);
});

test('SQLite key writes roll back the whole batch on failure, preserving prekeys and avoiding half-written sessions', async () => {
    const stamp = now();
    const id = Number(run('INSERT INTO wa_sessions ("key", label, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', ['atomic-healing', 'Atomic', 'disconnected', stamp, stamp]).lastInsertRowid);
    const { state } = await useSqliteAuthState(id);
    await state.keys.set({ 'pre-key': { 'keep-key': { private: Buffer.from('original') } } });
    db.exec("CREATE TEMP TRIGGER fail_auth_write BEFORE INSERT ON wa_auth_keys WHEN NEW.key_id = 'fail-key' BEGIN SELECT RAISE(ABORT, 'simulated disk error'); END;");
    try {
        await assert.rejects(state.keys.set({ session: { 'new-session': Buffer.from('new') }, 'pre-key': { 'keep-key': null, 'fail-key': { private: Buffer.from('bad') } } }), /simulated disk error/);
        assert.equal(get('SELECT 1 FROM wa_auth_keys WHERE wa_session_id = ? AND key_id = ?', [id, 'new-session']), undefined);
        assert.ok((await state.keys.get('pre-key', ['keep-key']))['keep-key']);
    } finally { db.exec('DROP TRIGGER fail_auth_write'); }
});
