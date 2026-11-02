// Recover through Baileys' public APIs. Never restore consumed one-time keys,
// delete identity credentials, or silently trust a changed identity.
export const recoverableDecrypt = (detail) => Boolean(detail?.key?.id && detail?.key?.remoteJid &&
    /invalid prekey id|missing signedprekey|no (matching )?sessions?|no session record|bad mac|key used already or never filled/i.test(String(detail.err?.message ?? detail.err ?? '')));

const MINUTE = 60000;

/** Device number in a sender address: "628:47@lid" -> 47; no suffix is the main phone (0). */
export const deviceOfJid = (jid) => {
    const head = String(jid ?? '').split('@')[0];
    const device = head.includes(':') ? Number(head.split(':')[1]) : 0;

    return Number.isInteger(device) && device >= 0 ? device : 0;
};
// From our own account's phone (or the sender is unknown), as opposed to another linked
// device (a second bot, WhatsApp Web): those need a different fix, so they are told apart.
//   phone = device 0 (or unknown);
//   self  = OUR OWN device number: another running copy of the bot with the same link keys
//           (a copied data folder) is sending as this very device;
//   other = another linked device (WhatsApp Web, a second bot with its own link).
export const senderKind = (p, ownDevice = null) => {
    if (!p.key.fromMe) return null;
    if (!p.error.sender) return 'phone';
    const device = deviceOfJid(p.error.sender);
    if (device === 0) return 'phone';

    return ownDevice != null && ownDevice !== 0 && device === ownDevice ? 'self' : 'other';
};
// An unreadable message "from our phone" may be CS typing, so the bot holds that
// customer's replies, but only briefly: the bot works outside office hours, when such
// messages are nearly always WhatsApp Business automatic ones, and a resend that never
// comes held the customer forever (91 stuck on a client PC, 2026-11-02).
export const OWN_HOLD_MS = 3 * MINUTE;
// No resend after this (asked 3 times), or this old in any case: released and reported once.
export const GIVE_UP_MS = 30 * MINUTE;
const GIVE_UP_ANYWAY_MS = 2 * 60 * MINUTE;
// This many messages from our own phone unreadable, none readable since, for 5 minutes:
// the encryption with the shop's phone is out of step (data used by two copies of the
// bot, or an old backup restored). No resend fixes that; a fresh link (new QR) does.
export const OWN_BROKEN_COUNT = 5;
// Self-healing first: the bot fetches the phone's current keys from WhatsApp and starts a
// fresh session with it (Baileys assertSessions, force). Its next message to the phone (a
// resend request, any reply's copy) carries the new session and the phone switches to it.
// Pairing keys are untouched, so no new QR. Only if that has not worked for this long is a
// person asked to scan again.
export const OWN_REFRESH_AFTER_MS = 2 * MINUTE;
export const RELINK_AFTER_MS = 30 * MINUTE;

/** The shop phone's own addresses (device 0) for the bot's socket: by number and by LID. */
export const ownPhoneJids = (user) => [user?.id, user?.lid]
    .filter(Boolean)
    .map((jid) => { const [address, server] = String(jid).split('@'); return `${address.split(':')[0]}@${server}`; });
export class MessageHealing {
    constructor({ socket, reconnect, log, clock = Date.now, read = () => null, write = () => {}, ownDevice = () => null, wasSeen = () => false, markSeen = () => {} }) {
        this.socket = socket;
        // Kept in the database (not only here): the copy WhatsApp redelivers after a restart is still known.
        this.wasSeenStored = wasSeen;
        this.markSeenStored = markSeen;
        this.ownDevice = ownDevice;
        // Ids of messages that arrived readable (bounded): a later failure for one of them is a re-delivery.
        this.seen = new Map();
        this.reconnect = reconnect;
        this.log = log;
        this.clock = clock;
        this.write = write;
        let stored;
        try { stored = read(); } catch (error) { this.log.warn({ err: error.message }, 'status pemulihan lama tidak bisa dibaca'); }
        const time = (value) => Number.isFinite(value) && value >= 0 && value <= clock() ? value : null;
        const valid = (p) => p && typeof p.key?.id === 'string' && typeof p.key?.remoteJid === 'string' && Number.isFinite(p.since) && typeof p.error?.message === 'string';
        this.state = {
            pending: (Array.isArray(stored?.pending) ? stored.pending : []).filter(valid).slice(0, 100)
                .map((p) => ({ ...p, since: Math.min(p.since, clock()), requests: Number.isInteger(p.requests) && p.requests >= 0 ? p.requests : 0, lastRequest: time(p.lastRequest) })),
            healed: Number.isInteger(stored?.healed) && stored.healed >= 0 ? stored.healed : 0,
            lastUpload: time(stored?.lastUpload), lastReconnect: time(stored?.lastReconnect), lastAlert: time(stored?.lastAlert),
            lost: Number.isInteger(stored?.lost) && stored.lost >= 0 ? stored.lost : 0,
            lastLostReport: time(stored?.lastLostReport),
            lastBrokenAlert: time(stored?.lastBrokenAlert),
            lastOtherAlert: time(stored?.lastOtherAlert),
            ownBrokenSince: time(stored?.ownBrokenSince),
            lastSessionRefresh: time(stored?.lastSessionRefresh),
            sessionRefreshes: Number.isInteger(stored?.sessionRefreshes) && stored.sessionRefreshes >= 0 ? stored.sessionRefreshes : 0,
            ownBroken: stored?.ownBroken === true,
            unreported: Number.isInteger(stored?.unreported?.count) && Array.isArray(stored.unreported.chats) ? stored.unreported : null,
        };
        if (stored && (!Array.isArray(stored.pending) || stored.pending.length !== this.state.pending.length)) {
            this.log.warn({}, 'status pemulihan lama tidak valid; entri rusak diabaikan');
        }
        this.running = false;
        this.working = null;
    }

    failed(detail) {
        if (!recoverableDecrypt(detail)) return false;
        const key = { ...detail.key };
        // Already read once: this is WhatsApp delivering it again (its unacknowledged queue after a
        // reconnect) and the keys are consumed, so there is nothing to repair and nothing to alarm about.
        if (this.seen.has(key.id) || this.storedSeen(key.id)) {
            this.log.info({ messageId: key.id, err: detail.err?.message }, 'pesan yang sudah terbaca dikirim ulang WhatsApp; diabaikan');
            return true;
        }
        if (!this.state.pending.some((p) => p.key.id === key.id)) {
            if (this.state.pending.length >= 100) {
                // Full: the oldest goes to the hourly "dilepas" report (still reported, raw),
                // so new ones stay tracked instead of a pop-up each (02:50 on a client PC, 2026-11-02).
                this.release([this.state.pending[0]]);
            }
            this.state.pending.push({
                key, since: this.clock(), requests: 0, lastRequest: null,
                error: {
                    name: detail.err?.name, message: String(detail.err?.message ?? detail.err), stack: String(detail.err?.stack ?? '').slice(0, 5000),
                    // Who sent it and how it was encrypted (lid.js): the log alone cannot tell the phone from another device.
                    sender: typeof detail.err?.senderJid === 'string' ? detail.err.senderJid : undefined,
                    e2eType: typeof detail.err?.e2eType === 'string' ? detail.err.e2eType : undefined,
                    // Stored session under the sender's LID / number address: why it could not be opened.
                    records: detail.err?.records && typeof detail.err.records === 'object' ? { ...detail.err.records } : undefined,
                },
            });
            this.save();
        }
        return true;
    }

    kind(p) {
        return senderKind(p, this.ownDevice());
    }

    storedSeen(id) {
        try { return Boolean(this.wasSeenStored(id)); } catch { return false; }
    }

    received(key) {
        this.lastSuccess = this.clock();
        if (key?.id) {
            try { this.markSeenStored(key.id); } catch (error) { this.log.info({ err: error.message }, 'pesan terbaca tidak tersimpan; hanya diingat selama bot jalan'); }
            this.seen.set(key.id, this.clock());
            if (this.seen.size > 5000) {
                for (const id of this.seen.keys()) {
                    this.seen.delete(id);
                    if (this.seen.size <= 4000) break;
                }
            }
        }
        if (key?.fromMe) {
            this.lastOwnSuccess = this.clock();
            if (this.state.ownBroken) {
                this.state.ownBroken = false;
                this.state.ownBrokenSince = null;
                this.state.sessionRefreshes = 0;
                this.save();
                this.log.info('pesan dari HP toko terbaca lagi: kunci enkripsi sudah cocok');
            }
        }
        const before = this.state.pending.length;
        this.state.pending = this.state.pending.filter((p) => p.key.id !== key?.id);
        if (before !== this.state.pending.length) {
            this.state.healed += before - this.state.pending.length;
            this.save();
            this.log.info({ messageId: key.id }, 'pesan berhasil dipulihkan otomatis');
        }
    }

    save() {
        try { this.write(this.state); this.storageAlerted = false; }
        catch (error) {
            if (!this.storageAlerted) this.log.warn({ err: error.message }, 'gagal menyimpan status pemulihan pesan');
            this.storageAlerted = true;
        }
    }
    start() {
        if (this.running) return;
        this.running = true;
        this.timer = setInterval(() => this.tick(), 15000);
        this.timer.unref?.();
    }
    stop() {
        this.running = false;
        clearInterval(this.timer);
    }
    reset() {
        this.state = { pending: [], healed: 0, lastUpload: null, lastReconnect: null, lastAlert: null, lost: 0, lastLostReport: null, unreported: null, lastBrokenAlert: null, lastOtherAlert: null, ownBroken: false, ownBrokenSince: null, lastSessionRefresh: null, sessionRefreshes: 0 };
        this.save();
    }
    /** True when the bot can no longer read the shop's own phone (see OWN_BROKEN_COUNT). */
    ownSessionBroken() {
        // Remembered (also across restarts) until a message from the phone is readable again.
        if (this.state.ownBroken) return true;
        const own = this.state.pending.filter((p) => this.kind(p) === 'phone' && p.since > (this.lastOwnSuccess ?? -Infinity));
        if (own.length < OWN_BROKEN_COUNT || this.clock() - Math.min(...own.map((p) => p.since)) < 5 * MINUTE) return false;
        this.state.ownBroken = true;
        this.state.ownBrokenSince ??= this.clock();
        this.save();
        return true;
    }
    /** Self-healing has not fixed it: a person must link the bot again. */
    needsRelink() {
        return this.ownSessionBroken() && (this.state.sessionRefreshes ?? 0) >= 2 && this.clock() - (this.state.ownBrokenSince ?? this.clock()) >= RELINK_AFTER_MS;
    }
    /** Other linked devices of this number whose messages cannot be read: { 47: 3, 45: 1 }. */
    otherDevices() {
        const devices = {};
        for (const p of this.state.pending.filter((p) => this.kind(p) === 'other')) {
            const id = deviceOfJid(p.error.sender);
            devices[id] = (devices[id] ?? 0) + 1;
        }

        return devices;
    }
    /** Unreadable messages sent as OUR OWN device number: a second copy of the bot shares this link. */
    selfCopies() {
        return this.state.pending.filter((p) => this.kind(p) === 'self').length;
    }
    status() {
        return { selfCopies: this.selfCopies(), otherDevices: this.otherDevices(), pending: this.state.pending.length, recovered: this.state.healed, lost: this.state.lost, ownSessionBroken: this.ownSessionBroken(), selfHealing: this.ownSessionBroken() && !this.needsRelink(), needsRelink: this.needsRelink(), needsAttention: this.state.pending.some((p) => this.clock() - p.since >= 5 * MINUTE) };
    }
    waitingForOwn(jid, canonical = (value) => value, isBotMessage = () => false) {
        return this.state.pending.some((p) => p.key.fromMe && this.clock() - p.since < OWN_HOLD_MS && canonical(p.key.remoteJid) === canonical(jid) && !isBotMessage(p.key.id));
    }
    /** The 5-minute alert: names the other linked devices when those are the senders, since only the person at the phone can fix that. */
    deadlineAlert(pending) {
        const others = this.otherDevices();
        const ids = Object.keys(others);
        const first = pending.find((p) => this.kind(p) === 'other') ?? pending[0];
        const selfCopies = pending.filter((p) => this.kind(p) === 'self');
        if (selfCopies.length) {
            this.alert(
                `Pesan dari perangkat bot ini sendiri (nomor perangkat ${this.ownDevice()}) tidak bisa dibuka setelah 5 menit: ada salinan bot lain yang memakai kunci tautan yang sama (folder bot yang disalin). Tutup semua salinan lain (Mulai ChatBot Prema mematikannya otomatis), lalu klik "Scan ulang (kunci baru)" di kartu WhatsApp.`,
                { key: selfCopies[0].key, err: selfCopies[0].error, ownDevice: this.ownDevice(), selfCopies: selfCopies.length },
            );

            return;
        }
        if (ids.length) {
            // The shop's own CS devices (WhatsApp Web, Desktop) are legitimate and cannot be removed
            // (client, 2026-11-02: "3 devices in use + the bot = 4"), so this is a note, once a day,
            // never an alarm that asks anyone to unlink them. The dashboard card keeps showing it.
            if (this.state.lastOtherAlert != null && this.clock() - this.state.lastOtherAlert < 24 * 60 * MINUTE) return;
            this.state.lastOtherAlert = this.clock();
            this.save();
            this.log.warn(
                { key: first.key, err: first.error, otherDevices: others, pending: this.state.pending.length },
                `Pesan dari perangkat tertaut lain (nomor perangkat ${ids.join(', ')}) belum bisa dibuka bot. Kalau perangkat itu dipakai CS, biarkan saja: bot tetap melayani pelanggan, hanya balasan CS dari perangkat itu yang tidak terbaca.`,
            );

            return;
        }
        this.alert('Pesan WhatsApp belum bisa dipulihkan setelah 5 menit; perlu diperiksa', { key: first.key, err: first.error, otherDevices: others });
    }
    alert(message, detail) {
        if (this.state.lastAlert !== null && this.clock() - this.state.lastAlert < 10 * MINUTE) return;
        this.state.lastAlert = this.clock();
        this.save();
        this.log.warn({ ...detail, pending: this.state.pending.length }, message);
    }
    /** Out of the queue, into the next hourly report. */
    release(old) {
        if (!old.length) return;
        this.state.pending = this.state.pending.filter((p) => !old.includes(p));
        this.state.lost += old.length;
        const report = this.state.unreported ?? { count: 0, fromPhone: 0, chats: [], key: null, err: null };
        report.count += old.length;
        report.fromPhone += old.filter((p) => this.kind(p) === 'phone').length;
        // Who sent them, how they were encrypted and what failed: the report used to call every
        // message from the shop's account "from the phone" (it was device 66, 2026-11-02).
        const tally = (name, value) => { if (value != null) { report[name] ??= {}; report[name][value] = (report[name][value] ?? 0) + 1; } };
        for (const p of old) {
            tally('devices', p.error.sender ? deviceOfJid(p.error.sender) : null);
            tally('e2e', p.error.e2eType);
            tally('errors', String(p.error.message ?? '').replace(/\s*\(juga dicoba.*$/s, '').slice(0, 60));
        }
        report.chats = [...new Set([...report.chats, ...old.filter((p) => !p.key.fromMe).map((p) => p.key.remoteJid)])].slice(0, 50);
        report.key ??= old[0].key;
        report.err ??= old[0].error;
        this.state.unreported = report;
        this.save();
    }
    /** Messages the phone never resent: out of the queue, reported once with the chats to check on the phone. */
    giveUp() {
        const now = this.clock();
        this.release(this.state.pending.filter((p) => (now - p.since >= GIVE_UP_MS && p.requests >= 3) || now - p.since >= GIVE_UP_ANYWAY_MS));
        // Reported at most once an hour, everything released since the last report together.
        const report = this.state.unreported;
        if (!report?.count || (this.state.lastLostReport != null && now - this.state.lastLostReport < 60 * MINUTE)) return;
        this.state.lastLostReport = now;
        this.state.unreported = null;
        this.save();
        this.log.warn(
            {
                lost: report.count, fromPhone: report.fromPhone, customerChats: report.chats, key: report.key, err: report.err,
                // Senders by device number, encryption type and error; our own device number to compare with.
                devices: report.devices, e2e: report.e2e, errors: report.errors, ownDevice: this.ownDevice(),
            },
            `${report.count} pesan WhatsApp tetap tidak bisa dibuka setelah 30 menit dan dilepas dari pemulihan${report.chats.length ? `; ${report.chats.length} chat pelanggan perlu dicek langsung di HP` : report.devices ? `; pengirimnya perangkat nomor ${Object.keys(report.devices).join(', ')}` : ''}`,
        );
    }
    tick() {
        if (!this.running) return;
        this.giveUp();
        // A slow/hung network operation must not block the escalation deadline.
        const pending = this.state.pending;
        if (this.ownSessionBroken()) {
            // Repaired automatically first (repair below); a person is asked only once that failed,
            // once an hour. The generic 5-minute alert would only repeat it.
            if (this.needsRelink() && (this.state.lastBrokenAlert == null || this.clock() - this.state.lastBrokenAlert >= 60 * MINUTE)) {
                this.state.lastBrokenAlert = this.clock();
                this.save();
                const own = pending.filter((p) => this.kind(p) === 'phone');
                this.log.warn(
                    { unreadableFromPhone: own.length, key: own[0]?.key, err: own[0]?.error },
                    'Pesan dari HP toko tidak bisa dibuka bot, dan perbaikan otomatis 30 menit belum berhasil: kunci enkripsi bot dan HP sudah tidak cocok. Pastikan hanya SATU bot yang jalan (hapus/tutup folder bot lain), lalu klik "Scan ulang (kunci baru)" di kartu WhatsApp dan scan dari HP toko.',
                );
            }
        } else if (pending.length && this.clock() - Math.min(...pending.map((p) => p.since)) >= 5 * MINUTE) {
            this.deadlineAlert(pending);
        }
        const socket = this.socket();
        if (this.working && this.workSocket !== socket) this.working = null;
        if (this.working) {
            if (socket && this.clock() - this.workStarted >= 90000 &&
                (this.state.lastReconnect === null || this.clock() - this.state.lastReconnect >= 10 * MINUTE)) {
                this.state.lastReconnect = this.clock();
                this.save();
                this.log.info('pemulihan pesan macet; mengganti koneksi tanpa menghapus sesi');
                this.reconnect(socket);
            }
            return this.working;
        }
        this.workSocket = socket;
        this.workStarted = this.clock();
        const working = this.repair().catch((error) => {
            // A failed repair is still retried by the next tick. The deadline
            // below, rather than every network exception, notifies the user.
            this.log.warn({ quiet: true, err: error.message }, 'pemulihan pesan tertunda, dicoba lagi otomatis');
        }).finally(() => { if (this.working === working) this.working = null; });
        this.working = working;
        return this.working;
    }
    async repair() {
        const pending = this.state.pending;
        if (!pending.length) return;
        const oldest = Math.min(...pending.map((p) => p.since));
        if (this.clock() - oldest >= 5 * MINUTE && !this.ownSessionBroken()) {
            this.deadlineAlert(pending);
        }
        const socket = this.socket();
        if (!socket || this.clock() - oldest < 30000) return;
        const current = () => this.running && this.socket() === socket;
        if (pending.some((p) => /prekey/i.test(p.error.message)) &&
            (this.state.lastUpload === null || this.clock() - this.state.lastUpload >= 10 * MINUTE)) {
            this.state.lastUpload = this.clock();
            this.save();
            if (socket.uploadPreKeys) {
                await socket.uploadPreKeys(5);
                this.log.info('kunci sekali pakai baru diunggah untuk pemulihan pesan');
            }
        }
        if (!current()) return;
        // Messages from our own phone unreadable and none readable since: a fresh session with
        // the phone (at most every 10 minutes), then ask the resends again right away.
        const own = pending.filter((p) => this.kind(p) === 'phone' && p.since > (this.lastOwnSuccess ?? -Infinity));
        const ownJids = ownPhoneJids(socket.user);
        if (own.length && socket.assertSessions && ownJids.length &&
            this.clock() - Math.min(...own.map((p) => p.since)) >= OWN_REFRESH_AFTER_MS &&
            (this.state.lastSessionRefresh == null || this.clock() - this.state.lastSessionRefresh >= 10 * MINUTE)) {
            this.state.lastSessionRefresh = this.clock();
            this.state.sessionRefreshes = (this.state.sessionRefreshes ?? 0) + 1;
            this.save();
            await socket.assertSessions(ownJids, true);
            this.log.info({ jids: ownJids, attempt: this.state.sessionRefreshes }, 'sesi enkripsi dengan HP toko diperbarui otomatis (tanpa scan ulang)');
            for (const p of own) p.lastRequest = null;
            if (!current()) return;
        }
        let batch = 0;
        for (const p of [...pending]) {
            if (!current()) return;
            if (!this.state.pending.includes(p) || this.clock() - p.since < 30000) continue;
            const delay = p.requests < 3 ? MINUTE : 10 * MINUTE;
            if (p.lastRequest !== null && this.clock() - p.lastRequest < delay) continue;
            if (!socket.requestPlaceholderResend) continue;
            p.lastRequest = this.clock();
            p.requests++;
            this.save();
            // Baileys also retries immediately itself. This second stage waits
            // until its initial placeholder request has expired; no cache reset.
            await socket.requestPlaceholderResend(p.key);
            this.log.info({ messageId: p.key.id, attempt: p.requests }, 'meminta HP mengirim ulang pesan yang belum terbaca');
            if (++batch >= 3) break;
        }
        if (!current() || !this.state.pending.length) return;
        // A new connection only helps messages from the shop phone (keys are exchanged again). For a
        // second copy of the bot or another linked device it fixes nothing, and it drops the
        // connection: the dashboard said "terputus" every 10 minutes with 21 such messages (2026-11-02).
        const fixable = this.state.pending.filter((p) => this.kind(p) === 'phone' || this.kind(p) === null);
        if (!fixable.length) return;
        const fixableOldest = Math.min(...fixable.map((p) => p.since));
        // A lone damaged message must not disrupt other, working conversations.
        if (this.clock() - fixableOldest >= 2 * MINUTE &&
            (fixable.length >= 3 || (this.lastSuccess ?? -Infinity) <= fixableOldest) &&
            (this.state.lastReconnect === null || this.clock() - this.state.lastReconnect >= 10 * MINUTE)) {
            this.state.lastReconnect = this.clock();
            this.save();
            this.reconnect(socket);
        }
    }
}
