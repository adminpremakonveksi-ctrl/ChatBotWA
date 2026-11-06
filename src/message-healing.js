import { withDeadline } from './deadline.js';

export const recoverableDecrypt = (detail) => Boolean(detail?.key?.id && detail?.key?.remoteJid &&
    /invalid prekey id|missing signedprekey|no (matching )?sessions?|no session record|bad mac|key used already or never filled/i.test(String(detail.err?.message ?? detail.err ?? '')));

const MINUTE = 60000;

export const deviceOfJid = (jid) => {
    const match = /^(\d+)(?::(\d+))?@(lid|s\.whatsapp\.net)$/.exec(String(jid ?? ''));
    if (!match) return null;
    const device = Number(match[2] ?? 0);
    return Number.isSafeInteger(device) ? device : null;
};
export const senderKind = (p, ownDevice = null) => {
    if (!p.key.fromMe) return null;
    if (!p.error.sender) return 'unknown';
    const device = deviceOfJid(p.error.sender);
    if (device === null) return 'unknown';
    if (device === 0) return 'phone';

    return ownDevice != null && ownDevice !== 0 && device === ownDevice ? 'self' : 'other';
};
export const OWN_HOLD_MS = 3 * MINUTE;
export const GIVE_UP_MS = 30 * MINUTE;
const GIVE_UP_ANYWAY_MS = 2 * 60 * MINUTE;
export const OWN_BROKEN_COUNT = 5;
export const OWN_REFRESH_AFTER_MS = 2 * MINUTE;
export const RELINK_AFTER_MS = 30 * MINUTE;
export const RECOVERY_OPERATION_MS = 20000;

export const ownPhoneJids = (user) => [user?.id, user?.lid]
    .filter(Boolean)
    .map((jid) => { const [address, server] = String(jid).split('@'); return `${address.split(':')[0]}@${server}`; });
export class MessageHealing {
    constructor({ socket, reconnect, log, clock = Date.now, read = () => null, write = () => {}, ownDevice = () => null, wasSeen = () => false, markSeen = () => {}, onUnresolvedOwn = () => {} }) {
        this.socket = socket;
        this.wasSeenStored = wasSeen;
        this.markSeenStored = markSeen;
        this.ownDevice = ownDevice;
        this.onUnresolvedOwn = onUnresolvedOwn;
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
            version: 2,
            pending: (Array.isArray(stored?.pending) ? stored.pending : []).filter(valid).slice(0, 100)
                .map((p) => ({ ...p, since: Math.min(p.since, clock()), requests: Number.isInteger(p.requests) && p.requests >= 0 ? p.requests : 0, lastRequest: time(p.lastRequest) })),
            healed: Number.isInteger(stored?.healed) && stored.healed >= 0 ? stored.healed : 0,
            lastUpload: time(stored?.lastUpload), lastReconnect: time(stored?.lastReconnect), lastAlert: time(stored?.lastAlert),
            lost: Number.isInteger(stored?.lost) && stored.lost >= 0 ? stored.lost : 0,
            lastLostReport: time(stored?.lastLostReport),
            lastBrokenAlert: time(stored?.lastBrokenAlert),
            lastOtherAlert: time(stored?.lastOtherAlert),
            ownBrokenSince: stored?.version === 2 ? time(stored?.ownBrokenSince) : null,
            lastSessionRefresh: time(stored?.lastSessionRefresh),
            lastOwnSuccess: time(stored?.lastOwnSuccess),
            deviceRefreshes: Object.fromEntries(Object.entries(stored?.deviceRefreshes ?? {}).filter(([jid, at]) => /^[\d:]+@(lid|s\.whatsapp\.net)$/.test(jid) && time(at) !== null)),
            sessionRefreshes: stored?.version === 2 && Number.isInteger(stored?.sessionRefreshes) && stored.sessionRefreshes >= 0 ? stored.sessionRefreshes : 0,
            ownBroken: stored?.version === 2 && stored?.ownBroken === true,
            unreported: Number.isInteger(stored?.unreported?.count) && Array.isArray(stored.unreported.chats) ? stored.unreported : null,
        };
        this.lastOwnSuccess = this.state.lastOwnSuccess ?? undefined;
        if (stored && (!Array.isArray(stored.pending) || stored.pending.length !== this.state.pending.length)) {
            this.log.warn({}, 'status pemulihan lama tidak valid; entri rusak diabaikan');
        }
        this.running = false;
        this.working = null;
    }

    failed(detail) {
        if (!recoverableDecrypt(detail)) return false;
        const key = { ...detail.key };
        if (this.seen.has(key.id) || this.storedSeen(key.id)) {
            this.log.info({ messageId: key.id, err: detail.err?.message }, 'pesan yang sudah terbaca dikirim ulang WhatsApp; diabaikan');
            return true;
        }
        const existing = this.state.pending.find((p) => p.key.id === key.id);
        if (!existing) {
            if (this.state.pending.length >= 100) {
                this.release([this.state.pending[0]]);
            }
            this.state.pending.push({
                key, since: this.clock(), requests: 0, lastRequest: null,
                error: {
                    name: detail.err?.name, message: String(detail.err?.message ?? detail.err), stack: String(detail.err?.stack ?? '').slice(0, 5000),
                    sender: typeof detail.err?.senderJid === 'string' ? detail.err.senderJid : undefined,
                    e2eType: typeof detail.err?.e2eType === 'string' ? detail.err.e2eType : undefined,
                    records: detail.err?.records && typeof detail.err.records === 'object' ? { ...detail.err.records } : undefined,
                },
            });
            this.save();
        } else if (deviceOfJid(detail.err?.senderJid) !== null && existing.error.sender !== detail.err.senderJid) {
            existing.error.sender = detail.err.senderJid;
            existing.error.e2eType = detail.err.e2eType;
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
        if (key?.fromMe && this.state.pending.some((p) => p.key.id === key.id && this.kind(p) === 'phone')) {
            this.lastOwnSuccess = this.clock();
            this.state.lastOwnSuccess = this.lastOwnSuccess;
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
        this.state = { version: 2, deviceRefreshes: {}, pending: [], healed: 0, lastUpload: null, lastReconnect: null, lastAlert: null, lost: 0, lastLostReport: null, unreported: null, lastBrokenAlert: null, lastOtherAlert: null, ownBroken: false, ownBrokenSince: null, lastSessionRefresh: null, sessionRefreshes: 0 };
        this.save();
        this.lastOwnSuccess = undefined;
    }
    ownSessionBroken() {
        const own = this.state.pending.filter((p) => this.kind(p) === 'phone' && !/key used already or never filled/i.test(p.error.message) && p.since > (this.lastOwnSuccess ?? -Infinity));
        if (!own.length) {
            if (this.state.ownBroken) {
                this.state.ownBroken = false;
                this.state.ownBrokenSince = null;
                this.state.sessionRefreshes = 0;
                this.save();
            }
            return false;
        }
        if (this.state.ownBroken) return true;
        if (own.length < OWN_BROKEN_COUNT || this.clock() - Math.min(...own.map((p) => p.since)) < 5 * MINUTE) return false;
        this.state.ownBroken = true;
        this.state.ownBrokenSince ??= this.clock();
        this.save();
        return true;
    }
    needsRelink() {
        return this.ownSessionBroken() && (this.state.sessionRefreshes ?? 0) >= 2 && this.clock() - (this.state.ownBrokenSince ?? this.clock()) >= RELINK_AFTER_MS;
    }
    otherDevices() {
        const devices = {};
        for (const p of this.state.pending.filter((p) => this.kind(p) === 'other')) {
            const id = deviceOfJid(p.error.sender);
            devices[id] = (devices[id] ?? 0) + 1;
        }

        return devices;
    }
    selfCopies() {
        return this.state.pending.filter((p) => this.kind(p) === 'self').length;
    }
    status() {
        return { selfCopies: this.selfCopies(), otherDevices: this.otherDevices(), pending: this.state.pending.length, recovered: this.state.healed, lost: this.state.lost, ownSessionBroken: this.ownSessionBroken(), selfHealing: this.ownSessionBroken() && !this.needsRelink(), needsRelink: this.needsRelink(), needsAttention: this.state.pending.some((p) => this.clock() - p.since >= 5 * MINUTE) };
    }
    waitingForOwn(jid, canonical = (value) => value, isBotMessage = () => false) {
        this.handoverUnresolvedOwn(isBotMessage);
        return this.state.pending.some((p) => p.key.fromMe && this.clock() - p.since < OWN_HOLD_MS && canonical(p.key.remoteJid) === canonical(jid) && !isBotMessage(p.key.id));
    }
    handoverUnresolvedOwn(isBotMessage = (id) => this.storedSeen(id)) {
        let changed = false;
        for (const p of this.state.pending) {
            if (this.clock() - p.since >= OWN_HOLD_MS) changed = this.handoverOwn(p, isBotMessage) || changed;
        }
        if (changed) this.save();
    }
    handoverOwn(p, isBotMessage = (id) => this.storedSeen(id)) {
        if (!p.key.fromMe || p.handedOver || isBotMessage(p.key.id)) return false;
        this.onUnresolvedOwn(p.key);
        p.handedOver = true;
        return true;
    }
    deadlineAlert(pending) {
        const others = this.otherDevices();
        const ids = Object.keys(others);
        const first = pending.find((p) => this.kind(p) === 'other') ?? pending[0];
        const selfCopies = pending.filter((p) => this.kind(p) === 'self');
        if (selfCopies.length) {
            this.alert(
                `Pesan atas nama perangkat bot ini sendiri (nomor perangkat ${this.ownDevice()}) belum bisa dibuka. Pesan kiriman ulang atau konflik sesi perlu diperiksa; ini belum membuktikan ada salinan bot lain.`,
                { key: selfCopies[0].key, err: selfCopies[0].error, ownDevice: this.ownDevice(), selfCopies: selfCopies.length },
            );

            return;
        }
        if (ids.length) {
            if (this.state.lastOtherAlert != null && this.clock() - this.state.lastOtherAlert < 24 * 60 * MINUTE) return;
            this.state.lastOtherAlert = this.clock();
            this.save();
            this.log.warn(
                { key: first.key, err: first.error, otherDevices: others, pending: this.state.pending.length },
                `Pesan dari perangkat tertaut lain (nomor perangkat ${ids.join(', ')}) belum bisa dibuka bot. Kalau perangkat itu dipakai CS, biarkan saja: jangan dilepas. Chat terkait ditahan lalu diserahkan ke CS jika belum pulih; chat lain tetap berjalan.`,
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
    release(old) {
        if (!old.length) return;
        for (const p of old) this.handoverOwn(p);
        this.state.pending = this.state.pending.filter((p) => !old.includes(p));
        this.state.lost += old.length;
        const report = this.state.unreported ?? { count: 0, fromPhone: 0, chats: [], key: null, err: null };
        report.count += old.length;
        report.fromPhone += old.filter((p) => this.kind(p) === 'phone').length;
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
    giveUp() {
        const now = this.clock();
        this.release(this.state.pending.filter((p) => (now - p.since >= GIVE_UP_MS && p.requests >= 3) || now - p.since >= GIVE_UP_ANYWAY_MS));
        const report = this.state.unreported;
        if (!report?.count || (this.state.lastLostReport != null && now - this.state.lastLostReport < 60 * MINUTE)) return;
        this.state.lastLostReport = now;
        this.state.unreported = null;
        this.save();
        this.log.warn(
            {
                lost: report.count, fromPhone: report.fromPhone, customerChats: report.chats, key: report.key, err: report.err,
                devices: report.devices, e2e: report.e2e, errors: report.errors, ownDevice: this.ownDevice(),
            },
            `${report.count} pesan WhatsApp tetap tidak bisa dibuka setelah 30 menit dan dilepas dari pemulihan${report.chats.length ? `; ${report.chats.length} chat pelanggan perlu dicek langsung di HP` : report.devices ? `; pengirimnya perangkat nomor ${Object.keys(report.devices).join(', ')}` : ''}`,
        );
    }
    tick() {
        if (!this.running) return;
        this.handoverUnresolvedOwn();
        this.giveUp();
        const pending = this.state.pending;
        if (this.ownSessionBroken()) {
            if (this.needsRelink() && (this.state.lastBrokenAlert == null || this.clock() - this.state.lastBrokenAlert >= 60 * MINUTE)) {
                this.state.lastBrokenAlert = this.clock();
                this.save();
                const own = pending.filter((p) => this.kind(p) === 'phone');
                this.log.warn(
                    { unreadableFromPhone: own.length, key: own[0]?.key, err: own[0]?.error },
                    'Pemulihan sesi HP utama belum berhasil setelah 30 menit. Periksa koneksi HP dan log perangkat; Scan ulang menjadi pilihan terakhir. Ini belum membuktikan pairing rusak atau ada bot ganda.',
                );
            }
        } else if (pending.length && this.clock() - Math.min(...pending.map((p) => p.since)) >= 5 * MINUTE) {
            this.deadlineAlert(pending);
        }
        const socket = this.socket();
        if (this.working && this.workSocket !== socket) this.working = null;
        if (this.working) {
            if (socket && this.state.pending.some((p) => this.kind(p) === 'phone' || this.kind(p) === null) && this.clock() - this.workStarted >= 90000 &&
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
                await withDeadline(() => socket.uploadPreKeys(5), RECOVERY_OPERATION_MS, 'recovery prekeys');
                this.log.info('kunci sekali pakai baru diunggah untuk pemulihan pesan');
            }
        }
        if (!current()) return;
        const own = pending.filter((p) => this.kind(p) === 'phone' && p.since > (this.lastOwnSuccess ?? -Infinity));
        const ownJids = ownPhoneJids(socket.user);
        if (own.some((p) => !/key used already or never filled/i.test(p.error.message)) && socket.assertSessions && ownJids.length &&
            this.clock() - Math.min(...own.map((p) => p.since)) >= OWN_REFRESH_AFTER_MS &&
            (this.state.lastSessionRefresh == null || this.clock() - this.state.lastSessionRefresh >= 10 * MINUTE)) {
            this.state.lastSessionRefresh = this.clock();
            this.save();
            await withDeadline(() => socket.assertSessions(ownJids, true), RECOVERY_OPERATION_MS, 'phone session recovery');
            if (!current()) return;
            this.state.sessionRefreshes = (this.state.sessionRefreshes ?? 0) + 1;
            this.save();
            this.log.info({ jids: ownJids, attempt: this.state.sessionRefreshes }, 'sesi enkripsi dengan HP toko diperbarui otomatis (tanpa scan ulang)');
            for (const p of own) p.lastRequest = null;
            if (!current()) return;
        }
        this.state.deviceRefreshes ??= {};
        const devices = [...new Set(pending.filter((p) => this.kind(p) === 'other' && !/key used already or never filled/i.test(p.error.message) && this.clock() - p.since >= OWN_REFRESH_AFTER_MS).map((p) => p.error.sender))];
        for (const jid of devices) {
            if (!current()) return;
            const last = this.state.deviceRefreshes[jid];
            if (!socket.assertSessions || last != null && this.clock() - last < 10 * MINUTE) continue;
            this.state.deviceRefreshes[jid] = this.clock();
            this.save();
            await withDeadline(() => socket.assertSessions([jid], true), RECOVERY_OPERATION_MS, 'linked device session recovery');
            if (!current()) return;
            for (const p of this.state.pending.filter((p) => p.error.sender === jid)) p.lastRequest = null;
            this.save();
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
            await withDeadline(() => socket.requestPlaceholderResend(p.key), RECOVERY_OPERATION_MS, 'recovery resend');
            this.log.info({ messageId: p.key.id, attempt: p.requests }, 'meminta HP mengirim ulang pesan yang belum terbaca');
            if (++batch >= 3) break;
        }
        if (!current() || !this.state.pending.length) return;
        const fixable = this.state.pending.filter((p) => this.kind(p) === 'phone' || this.kind(p) === null);
        if (!fixable.length) return;
        const fixableOldest = Math.min(...fixable.map((p) => p.since));
        if (this.clock() - fixableOldest >= 2 * MINUTE &&
            !(this.state.sessionRefreshes > 0 && this.state.lastSessionRefresh != null && this.clock() - this.state.lastSessionRefresh < 2 * MINUTE) &&
            (fixable.length >= 3 || (this.lastSuccess ?? -Infinity) <= fixableOldest) &&
            (this.state.lastReconnect === null || this.clock() - this.state.lastReconnect >= 10 * MINUTE)) {
            this.state.lastReconnect = this.clock();
            this.save();
            this.reconnect(socket);
        }
    }
}
