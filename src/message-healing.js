// Recover through Baileys' public APIs. Never restore consumed one-time keys,
// delete identity credentials, or silently trust a changed identity.
export const recoverableDecrypt = (detail) => Boolean(detail?.key?.id && detail?.key?.remoteJid &&
    /invalid prekey id|missing signedprekey|no (matching )?sessions?|no session record|bad mac|key used already or never filled/i.test(String(detail.err?.message ?? detail.err ?? '')));

const MINUTE = 60000;
export class MessageHealing {
    constructor({ socket, reconnect, log, clock = Date.now, read = () => null, write = () => {} }) {
        this.socket = socket;
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
        if (!this.state.pending.some((p) => p.key.id === key.id)) {
            if (this.state.pending.length >= 100) {
                this.alert('Terlalu banyak pesan belum terbaca; pemulihan otomatis masih berjalan', detail);
                return false; // Do not hide errors that cannot be tracked.
            }
            this.state.pending.push({
                key, since: this.clock(), requests: 0, lastRequest: null,
                error: { name: detail.err?.name, message: String(detail.err?.message ?? detail.err), stack: String(detail.err?.stack ?? '').slice(0, 5000) },
            });
            this.save();
        }
        return true;
    }

    received(key) {
        this.lastSuccess = this.clock();
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
        this.state = { pending: [], healed: 0, lastUpload: null, lastReconnect: null, lastAlert: null };
        this.save();
    }
    status() {
        return { pending: this.state.pending.length, recovered: this.state.healed, needsAttention: this.state.pending.some((p) => this.clock() - p.since >= 5 * MINUTE) };
    }
    waitingForOwn(jid, canonical = (value) => value, isBotMessage = () => false) {
        return this.state.pending.some((p) => p.key.fromMe && canonical(p.key.remoteJid) === canonical(jid) && !isBotMessage(p.key.id));
    }
    alert(message, detail) {
        if (this.state.lastAlert !== null && this.clock() - this.state.lastAlert < 10 * MINUTE) return;
        this.state.lastAlert = this.clock();
        this.save();
        this.log.warn({ ...detail, pending: this.state.pending.length }, message);
    }
    tick() {
        if (!this.running) return;
        // A slow/hung network operation must not block the escalation deadline.
        const pending = this.state.pending;
        if (pending.length && this.clock() - Math.min(...pending.map((p) => p.since)) >= 5 * MINUTE) {
            this.alert('Pesan WhatsApp belum bisa dipulihkan setelah 5 menit; perlu diperiksa', { key: pending[0].key, err: pending[0].error });
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
        if (this.clock() - oldest >= 5 * MINUTE) {
            this.alert('Pesan WhatsApp belum bisa dipulihkan setelah 5 menit; perlu diperiksa', { key: pending[0].key, err: pending[0].error });
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
        // A lone damaged message must not disrupt other, working conversations.
        if (this.clock() - oldest >= 2 * MINUTE &&
            (this.state.pending.length >= 3 || (this.lastSuccess ?? -Infinity) <= oldest) &&
            (this.state.lastReconnect === null || this.clock() - this.state.lastReconnect >= 10 * MINUTE)) {
            this.state.lastReconnect = this.clock();
            this.save();
            this.reconnect(socket);
        }
    }
}
