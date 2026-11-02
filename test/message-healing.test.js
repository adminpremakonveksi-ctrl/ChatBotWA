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

test('an unreadable phone message holds that customer only briefly, then the bot answers (91 stuck, 2026-11-02)', (t) => {
    const f = fixture(t);
    f.healing.failed(failure());
    assert.equal(f.healing.waitingForOwn(failure().key.remoteJid), true, 'held while a resend may still come');
    f.advance(3 * 60000);
    assert.equal(f.healing.waitingForOwn(failure().key.remoteJid), false, 'never held forever');
});

test('messages the phone never resends are released after 30 minutes and reported once an hour with the chats to check', async (t) => {
    const f = fixture(t);
    const customer = { key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'CUST1' }, err: new Error('No matching sessions found for message') };
    f.healing.failed(failure());
    f.healing.failed(customer);
    for (let i = 0; i < 40; i++) {
        f.advance(60000);
        await f.healing.tick();
    }
    assert.equal(f.healing.status().pending, 0, 'the "memulihkan N pesan" pill clears');
    assert.equal(f.healing.status().lost, 2);
    const reports = f.logs.filter((l) => l[0] === 'warn' && /dilepas dari pemulihan/.test(l[2]));
    assert.equal(reports.length, 1);
    assert.match(reports[0][2], /1 chat pelanggan perlu dicek langsung di HP/);
    assert.deepEqual(reports[0][1].customerChats, ['628111@s.whatsapp.net']);
    assert.match(reports[0][1].err.message, /Invalid PreKey ID/, 'raw error kept');

    // More released within the hour wait for the next report, together.
    f.healing.failed(failure('LATER'));
    f.advance(2 * 60 * 60000);
    await f.healing.tick();
    assert.equal(f.logs.filter((l) => l[0] === 'warn' && /dilepas dari pemulihan/.test(l[2])).length, 2);
    assert.equal(f.saved().lost, 3, 'kept across restarts');
});

test('every phone message unreadable: the bot renews its session with the phone by itself; a new QR only if that fails for 30 minutes', async (t) => {
    const f = fixture(t);
    f.socket.user = { id: '6281999911895:12@s.whatsapp.net', lid: '62702630207741:12@lid' };
    f.socket.assertSessions = async (jids, force) => f.calls.push(['sessions', jids, force]);
    for (let i = 0; i < 5; i++) f.healing.failed(failure(`OWN${i}`));
    f.advance(2 * 60000);
    await f.healing.tick();
    assert.deepEqual(f.calls.find((c) => c[0] === 'sessions'), ['sessions', ['6281999911895@s.whatsapp.net', '62702630207741@lid'], true], 'fresh session with the phone, device 0, forced');
    assert.ok(f.calls.findIndex((c) => c[0] === 'sessions') < f.calls.findIndex((c) => c[0] === 'resend'), 'the resend request carries the new session');

    f.advance(3 * 60000);
    await f.healing.tick();
    const said = () => f.logs.filter((l) => l[0] === 'warn' && !l[1].quiet);
    assert.equal(f.healing.status().selfHealing, true);
    assert.equal(f.healing.status().needsRelink, false);
    assert.equal(said().length, 0, 'no pop-up while it repairs itself');

    // Repaired: a readable message from the phone ends it, nothing for a person to do.
    f.healing.received({ id: 'OK', fromMe: true, remoteJid: 'x@lid' });
    assert.equal(f.healing.status().ownSessionBroken, false);

    // Never repaired: after 30 minutes and two renewals, one actionable alert, kept across restarts.
    f.advance(1000);
    for (let i = 0; i < 5; i++) f.healing.failed(failure(`AGAIN${i}`));
    for (let i = 0; i < 40; i++) { f.advance(60000); await f.healing.tick(); }
    assert.ok(f.calls.filter((c) => c[0] === 'sessions').length >= 3);
    assert.equal(f.healing.status().needsRelink, true);
    assert.equal(said().filter((l) => /tidak cocok/.test(l[2])).length, 1);
    assert.match(said().find((l) => /tidak cocok/.test(l[2]))[2], /perbaikan otomatis 30 menit belum berhasil[\s\S]*Scan ulang/);
    assert.equal(new MessageHealing(f.options).status().needsRelink, true);
});

test('a full recovery queue keeps tracking new messages quietly; the oldest goes to the hourly report (02:50 pop-ups, 2026-11-02)', (t) => {
    const f = fixture(t);
    for (let i = 0; i < 100; i++) f.healing.failed(failure(`M${i}`));
    assert.equal(f.healing.failed(failure('NEW')), true, 'still handled, so no pop-up');
    assert.equal(f.healing.status().pending, 100);
    assert.equal(f.healing.status().lost, 1);
    assert.equal(f.saved().pending.some((p) => p.key.id === 'M0'), false, 'the oldest was released');
    assert.equal(f.saved().unreported.count, 1, 'and is reported, not hidden');
});

test('the sender device is recorded: the shop phone (device 0) and another linked device are told apart (2026-11-02)', async (t) => {
    const { deviceOfJid } = await import('../src/message-healing.js');
    assert.equal(deviceOfJid('6281999911895@s.whatsapp.net'), 0);
    assert.equal(deviceOfJid('62702630207741:47@lid'), 47);
    assert.equal(deviceOfJid(undefined), 0);

    const f = fixture(t);
    const from = (id, sender) => ({ key: { remoteJid: 'cust@lid', fromMe: true, id }, err: Object.assign(new Error('No matching sessions found for message'), { senderJid: sender, e2eType: 'msg' }) });
    for (let i = 0; i < 5; i++) f.healing.failed(from(`DEV${i}`, '62702630207741:47@lid'));
    f.advance(6 * 60000);
    await f.healing.tick();

    assert.deepEqual(f.healing.status().otherDevices, { 47: 5 });
    assert.equal(f.healing.status().ownSessionBroken, false, 'not the shop phone: scanning again would not help');
    assert.equal(f.saved().pending[0].error.sender, '62702630207741:47@lid', 'kept for diagnosis');
    assert.equal(f.saved().pending[0].error.e2eType, 'msg');
    const alert = f.logs.find((l) => l[0] === 'warn' && !l[1].quiet);
    assert.match(alert[2], /perangkat tertaut lain \(nomor perangkat 47\)[\s\S]*dipakai CS, biarkan saja/);
    assert.doesNotMatch(alert[2], /lepas/i, 'the CS devices must not be unlinked');
    // Once a day, not every ten minutes: it is a note.
    f.advance(30 * 60000);
    await f.healing.tick();
    assert.equal(f.logs.filter((l) => l[0] === 'warn' && !l[1].quiet && /perangkat tertaut lain/.test(l[2])).length, 1);
    assert.deepEqual(alert[1].otherDevices, { 47: 5 });

    // The same errors from the phone itself (device 0) are the phone's problem, not another device's.
    const g = fixture(t);
    for (let i = 0; i < 5; i++) g.healing.failed(from(`PH${i}`, '62702630207741:0@lid'));
    assert.deepEqual(g.healing.status().otherDevices, {});
});

test('the decrypt wrapper tags the error with the sender address and encryption type', async () => {
    const repository = { decryptMessage: async () => { throw new Error('No session record'); } };
    withLidFallback(repository, () => null);
    await assert.rejects(
        repository.decryptMessage({ jid: '62702630207741:47@lid', type: 'pkmsg', ciphertext: Buffer.from('x') }),
        (error) => error.senderJid === '62702630207741:47@lid' && error.e2eType === 'pkmsg',
    );
});

test('a message sent as OUR OWN device number means a second copy shares this link, not "another device" (2026-11-02, device 66)', async (t) => {
    const { senderKind } = await import('../src/message-healing.js');
    const p = (sender) => ({ key: { fromMe: true, id: 'x' }, error: { sender } });
    assert.equal(senderKind(p('28067997159547:66@lid'), 66), 'self');
    assert.equal(senderKind(p('28067997159547:66@lid'), 59), 'other');
    assert.equal(senderKind(p('28067997159547:66@lid'), null), 'other', 'own device unknown: not claimed to be ours');
    assert.equal(senderKind(p('28067997159547@lid'), 66), 'phone');
    assert.equal(senderKind(p(undefined), 66), 'phone');
    assert.equal(senderKind({ key: { fromMe: false }, error: {} }, 66), null);

    const f = fixture(t, { ownDevice: () => 66 });
    const own = (id) => ({ key: { remoteJid: '44586827268336@lid', fromMe: true, id }, err: Object.assign(new Error('Key used already or never filled'), { senderJid: '28067997159547:66@lid', e2eType: 'pkmsg' }) });
    for (let i = 0; i < 9; i++) f.healing.failed(own(`SELF${i}`));
    f.advance(6 * 60000);
    await f.healing.tick();

    assert.equal(f.healing.status().selfCopies, 9);
    assert.deepEqual(f.healing.status().otherDevices, {}, 'not blamed on a device that is not there');
    assert.equal(f.healing.status().ownSessionBroken, false);
    const alert = f.logs.find((l) => l[0] === 'warn' && !l[1].quiet);
    assert.match(alert[2], /perangkat bot ini sendiri \(nomor perangkat 66\)[\s\S]*salinan bot lain[\s\S]*Scan ulang/);
    assert.equal(alert[1].ownDevice, 66);
    assert.equal(alert[1].err.sender, '28067997159547:66@lid', 'raw detail kept');
});

test('a message that already arrived readable and is delivered again is not a failure (replayed queue after reconnect)', (t) => {
    const f = fixture(t);
    f.healing.received({ id: 'READ1', fromMe: true, remoteJid: 'c@lid' });
    const dup = { key: { remoteJid: 'c@lid', fromMe: true, id: 'READ1' }, err: Object.assign(new Error('Key used already or never filled'), { senderJid: '1:66@lid' }) };

    assert.equal(f.healing.failed(dup), true, 'handled: no pop-up');
    assert.equal(f.healing.status().pending, 0, 'not queued, nothing to repair or release');
    assert.equal(f.logs.filter((l) => l[0] === 'warn').length, 0);

    // A message that never arrived readable is still tracked.
    assert.equal(f.healing.failed({ ...dup, key: { ...dup.key, id: 'NEVER' } }), true);
    assert.equal(f.healing.status().pending, 1);

    // The memory is bounded.
    for (let i = 0; i < 5200; i++) f.healing.received({ id: `M${i}` });
    assert.ok(f.healing.seen.size <= 5000);
});

test('a new connection is only forced for messages it can fix: not for another device or a second copy (pill said "terputus" every 10 min)', async (t) => {
    const unreadable = (id, sender) => ({ key: { remoteJid: 'c@lid', fromMe: true, id }, err: Object.assign(new Error('No matching sessions found for message'), { senderJid: sender }) });

    const other = fixture(t, { ownDevice: () => 59 });
    for (let i = 0; i < 21; i++) other.healing.failed(unreadable(`O${i}`, '1:66@lid'));
    for (let i = 0; i < 5; i++) { other.advance(3 * 60000); await other.healing.tick(); }
    assert.equal(other.reconnects(), 0, '21 messages from another device: reconnecting cannot help');

    const self = fixture(t, { ownDevice: () => 66 });
    for (let i = 0; i < 21; i++) self.healing.failed(unreadable(`S${i}`, '1:66@lid'));
    for (let i = 0; i < 5; i++) { self.advance(3 * 60000); await self.healing.tick(); }
    assert.equal(self.reconnects(), 0, 'nor for a second copy sharing our link');

    const phone = fixture(t);
    for (let i = 0; i < 5; i++) phone.healing.failed(unreadable(`P${i}`, '1:0@lid'));
    phone.advance(3 * 60000);
    await phone.healing.tick();
    assert.equal(phone.reconnects(), 1, 'the shop phone still gets its bounded reconnect');

    const consolePage = (await import('node:fs')).readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');
    assert.match(consolePage, /main\.reconnecting[\s\S]{0,120}Menyambung ulang/, 'a reconnect is not shown as a red "terputus"');
});

test('a failure says which address has a stored session: LID, number, or neither (the cause of "No session record")', async (t) => {
    const stored = { '628111': true }; // a session exists under the number's address only
    const repository = {
        decryptMessage: async () => { throw new Error('No session record'); },
        jidToSignalProtocolAddress: (jid) => jid.split('@')[0].split(':')[0],
    };
    withLidFallback(repository, (jid) => (jid.startsWith('100:') ? '628111:7@s.whatsapp.net' : null), null, async (jid) => stored[repository.jidToSignalProtocolAddress(jid)]);

    let caught;
    await assert.rejects(repository.decryptMessage({ jid: '100:7@lid', type: 'msg', ciphertext: Buffer.from('x') }), (error) => { caught = error; return true; });
    assert.deepEqual(caught.records, { lid: false, pn: true }, 'the session is under the number, not under the LID');
    assert.equal(caught.senderJid, '100:7@lid');

    const f = fixture(t);
    f.healing.failed({ key: { remoteJid: 'c@lid', fromMe: true, id: 'REC1' }, err: caught });
    assert.deepEqual(f.saved().pending[0].error.records, { lid: false, pn: true }, 'kept with the failure, for the developer');
});

test('the released-messages report names the real senders: not "all from the shop phone" when it was device 66 (client, 2026-11-02)', async (t) => {
    const f = fixture(t, { ownDevice: () => 12 });
    const from66 = (id) => ({ key: { remoteJid: '259850068086932@lid', fromMe: true, id }, err: Object.assign(new Error('Key used already or never filled'), { name: 'MessageCounterError', senderJid: '28067997159547:66@lid', e2eType: 'pkmsg' }) });
    for (let i = 0; i < 5; i++) f.healing.failed(from66(`R${i}`));
    f.healing.failed({ key: { remoteJid: 'c@lid', fromMe: true, id: 'R-PHONE' }, err: Object.assign(new Error('No matching sessions found for message'), { senderJid: '28067997159547@lid', e2eType: 'msg' }) });
    for (let i = 0; i < 40; i++) { f.advance(60000); await f.healing.tick(); }

    const report = f.logs.find((l) => l[0] === 'warn' && /dilepas dari pemulihan/.test(l[2]));
    assert.ok(report, 'reported');
    assert.equal(report[1].fromPhone, 1, 'only the device-0 message is "from the phone"');
    assert.deepEqual(report[1].devices, { 66: 5, 0: 1 });
    assert.deepEqual(report[1].e2e, { pkmsg: 5, msg: 1 });
    assert.equal(report[1].ownDevice, 12, 'our own device number, to compare with the senders');
    assert.match(report[2], /perangkat nomor 0, 66/);
    assert.doesNotMatch(report[2], /semuanya pesan dari HP toko/);
});

test('a message read before a restart and redelivered after it is a duplicate, not an unreadable message (client PC, 2026-11-02)', async (t) => {
    const { markSeen, wasSeen, prune } = await import('../src/bot/store.js');
    const { run } = await import('../src/db.js');

    // The database remembers; the first process "read" the message, a new process has an empty memory.
    const store = { wasSeen: (id) => wasSeen('utama', id), markSeen: (id) => markSeen('utama', id) };
    const before = fixture(t, store);
    before.healing.received({ id: 'READ-BEFORE-RESTART', fromMe: true, remoteJid: 'c@lid' });
    assert.equal(wasSeen('utama', 'READ-BEFORE-RESTART'), true);
    assert.equal(wasSeen('lain', 'READ-BEFORE-RESTART'), false, 'per number');

    const after = fixture(t, store);
    const dup = { key: { remoteJid: 'c@lid', fromMe: true, id: 'READ-BEFORE-RESTART' }, err: Object.assign(new Error('Key used already or never filled'), { senderJid: '1:66@lid', e2eType: 'pkmsg' }) };
    assert.equal(after.healing.failed(dup), true, 'handled, no pop-up');
    assert.equal(after.healing.status().pending, 0, 'not queued, not released, not reported');
    assert.equal(after.logs.filter((l) => l[0] === 'warn').length, 0);

    // One that never arrived readable is still tracked.
    after.healing.failed({ ...dup, key: { ...dup.key, id: 'NEVER-READ' } });
    assert.equal(after.healing.status().pending, 1);

    // A week later it is forgotten (the table does not grow forever).
    run(`UPDATE seen_messages SET seen_at = datetime('now', '-8 days') WHERE message_id = 'READ-BEFORE-RESTART'`);
    prune(90);
    assert.equal(wasSeen('utama', 'READ-BEFORE-RESTART'), false);

    // A database that cannot be read must not stop the bot from working.
    const broken = fixture(t, { wasSeen: () => { throw new Error('disk'); }, markSeen: () => { throw new Error('disk'); } });
    assert.doesNotThrow(() => broken.healing.received({ id: 'X' }));
    assert.equal(broken.healing.failed({ ...dup, key: { ...dup.key, id: 'Y' } }), true);
});
