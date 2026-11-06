import QRCode from 'qrcode';
import qrTerminal from 'qrcode-terminal';
import path from 'node:path';

import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateMessageIDV2,
    getContentType,
    isJidBroadcast,
    isJidGroup,
    isJidNewsletter,
    makeCacheableSignalKeyStore,
    normalizeMessageContent,
    proto,
} from 'baileys';

import { useSqliteAuthState } from './auth-state.js';
import { recordSyncError, syncCatalog } from './bot/catalog.js';
import { markHandover, markSeen, wasSeen } from './bot/store.js';
import { fixMexNotifications, makePlaceholderCache, sessionHandledLog } from './baileys-fixes.js';
import { conversationJid, learnFromKey, setOwnIdentity, userOf, withLidFallback } from './lid.js';
import { MIME } from './bot/media.js';
import { config } from './config.js';
import { getSetting, now, run, setSetting } from './db.js';
import { logger } from './logger.js';
import { MessageHealing } from './message-healing.js';
import { incomingRows } from './inbox.js';
import { withDeadline } from './deadline.js';
import { pendingDeliveries, rememberRetryMessage, retryMessage } from './delivery.js';

const MAX_BACKOFF_MS = 60000;
const RECONNECTS_BEFORE_ALERT = 3;
const CATALOG_FIRST_DELAY_MS = 60000;
const CATALOG_RETRY_MS = [3 * 60000, 10 * 60000];

const IGNORED_TYPES = new Set([
    'protocolMessage',
    'reactionMessage',
    'senderKeyDistributionMessage',
    'pollUpdateMessage',
    'messageContextInfo',
    'keepInChatMessage',
    'pinInChatMessage',
    'editedMessage',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const ignoredJid = (jid) =>
    Boolean(isJidBroadcast(jid) || isJidNewsletter(jid) || (!config.allowGroups && isJidGroup(jid)));

const isRecent = (message) => Date.now() / 1000 - Number(message.messageTimestamp ?? 0) < 120;

const CATCH_UP_SECONDS = 15 * 60;
export const isRecentCatchUp = (message, now = Date.now()) => now / 1000 - Number(message?.messageTimestamp ?? 0) < CATCH_UP_SECONDS;

export class Session {
    constructor(row, bot, deps = {}) {
        this.makeSocket = deps.makeSocket ?? makeWASocket;
        this.fetchVersion = deps.fetchVersion ?? fetchLatestBaileysVersion;
        this.authState = deps.authState ?? useSqliteAuthState;
        this.bot = bot;
        this.id = row.id;
        this.key = row.key;
        this.label = row.label;

        this.socket = null;
        this.state = 'disconnected';
        this.qr = null;
        this.qrExpiresAt = null;
        this.me = null;
        this.phoneNumber = row.phone_number ?? null;
        this.lastError = null;

        this.attempts = 0;
        this.starting = null;
        this.stopping = false;
        this.reconnectTimer = null;
        this.generation = 0;
        this.retryCounterCache = makePlaceholderCache();
        this.decryptCache = makePlaceholderCache(15 * 60000);
        this.log = logger.child({ session: row.key });
        this.healing = new MessageHealing({
            onUnresolvedOwn: (key) => {
                if (!this.bot.isBotMessage(key.id)) markHandover(this.key, conversationJid(key.remoteJid), 'pesan perangkat toko belum terbaca');
            },
            socket: () => this.state === 'connected' ? this.socket : null,
            reconnect: (socket) => {
                if (socket === this.socket && !this.stopping) socket.end(new Error('Pemulihan enkripsi: menyambung ulang tanpa menghapus sesi'));
            },
            wasSeen: (id) => wasSeen(this.key, id),
            markSeen: (id) => markSeen(this.key, id),
            ownDevice: () => {
                const device = /:(\d+)@/.exec(this.socket?.user?.id ?? this.socket?.user?.lid ?? '')?.[1];

                return device === undefined ? null : Number(device);
            },
            log: this.log,
            read: () => {
                try { return JSON.parse(getSetting('healing:' + this.key) || 'null'); } catch { return null; }
            },
            write: (state) => setSetting('healing:' + this.key, JSON.stringify(state)),
        });
        this.baileysLog = sessionHandledLog(logger.child({ session: row.key }, { level: 'warn' }), this.log);
    }

    async start() {
        if (this.starting) {
            return this.starting;
        }

        if (this.state === 'connected') {
            return;
        }
        if (this.socket && ['connecting', 'qr'].includes(this.state)) return;

        this.stopping = false;
        this.healing.start();
        clearTimeout(this.reconnectTimer);
        const generation = ++this.generation;
        const starting = this.#connect(generation).catch(async (error) => {
            if (this.stopping || generation !== this.generation) return;
            this.lastError = error.message;
            this.socket?.end(error);
            this.socket = null;
            await this.#setState('disconnected', { last_error: error.message });
            this.#scheduleReconnect();
            throw error;
        }).finally(() => {
            if (this.starting === starting) this.starting = null;
        });
        this.starting = starting;

        return this.starting;
    }

    async #connect(generation) {
        await this.#setState('connecting');

        const { state, saveCreds, clear } = await this.authState(this.id);
        this.clearCredentials = clear;

        const { version } = await this.fetchVersion({ timeout: 10000 });
        if (this.stopping || generation !== this.generation) return;

        const connectionLog = sessionHandledLog(this.baileysLog, this.log, () => {
            if (this.socket === socket && !this.stopping) {
                socket.end(new Error('Koneksi WhatsApp tidak merespons; menyambung ulang'));
            }
            return true;
        }, (detail) => {
            if (this.stopping || generation !== this.generation || this.socket !== socket) return true;
            try { return this.healing.failed(detail); }
            catch (error) {
                this.log.error({ err: error.message }, 'gagal menyimpan status pemulihan pesan');
                return false;
            }
        });
        const socket = this.makeSocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, this.baileysLog),
            },
            logger: connectionLog,
            browser: ['ChatBot Prema', 'Chrome', '1.0.0'],
            markOnlineOnConnect: false,
            syncFullHistory: false,
            shouldSyncHistoryMessage: () => false,
            keepAliveIntervalMs: 25000,
            fireInitQueries: false,
            defaultQueryTimeoutMs: 120000,
            shouldIgnoreJid: (jid) => ignoredJid(jid),
            placeholderResendCache: makePlaceholderCache(),
            msgRetryCounterCache: this.retryCounterCache,
            getMessage: async (key) => retryMessage(this.key, key),
        });

        this.socket = socket;
        clearTimeout(this.connectionTimer);
        this.connectionTimer = setTimeout(() => {
            if (!this.stopping && this.socket === socket && generation === this.generation && this.state === 'connecting') {
                this.log.info('sambungan WhatsApp terlalu lama menunggu; mencoba koneksi baru');
                socket.end(new Error('Timed Out: WhatsApp handshake'));
            }
        }, 120000);
        this.connectionTimer.unref?.();

        withLidFallback(socket.signalRepository, undefined, this.decryptCache, async (jid) => {
            const address = socket.signalRepository.jidToSignalProtocolAddress(jid);
            const { [address]: record } = await state.keys.get('session', [address]);

            return record;
        });
        this.#learnOwnLid(state.creds.me);
        fixMexNotifications(socket);

        socket.ev.on('creds.update', () => {
            if (this.stopping || generation !== this.generation || this.socket !== socket) return;
            saveCreds().catch((error) => this.log.error({ err: error.message }, 'gagal menyimpan sesi WhatsApp'));
        });
        socket.ev.on('creds.update', (update) => {
            if (update?.me) this.#learnOwnLid({ ...state.creds.me, ...update.me });
        });
        socket.ev.on('connection.update', (update) => {
            if (this.stopping || generation !== this.generation || this.socket !== socket) return;
            this.#onConnectionUpdate(update, socket).catch((error) => {
                this.log.error({ err: error.message }, 'gagal memproses status WhatsApp');
                if (!this.stopping && generation === this.generation) this.#scheduleReconnect();
            });
        });
        socket.ev.on('messages.upsert', (event) => {
            if (this.stopping || generation !== this.generation || this.socket !== socket) return;
            this.#onMessages(event).catch((error) => this.log.error({ err: error.message }, 'gagal memproses pesan WhatsApp'));
        });
    }

    async #onConnectionUpdate({ connection, lastDisconnect, qr }, socket) {
        if (qr) {
            clearTimeout(this.connectionTimer);
            this.qr = await QRCode.toDataURL(qr, { margin: 1, width: 360 });
            this.qrExpiresAt = Date.now() + 20000;
            await this.#setState('qr');

            if (config.printQrInTerminal) {
                qrTerminal.generate(qr, { small: true });
                this.log.info('scan QR di atas dari HP: WhatsApp > Perangkat tertaut');
            }
        }

        if (connection === 'open') {
            clearTimeout(this.connectionTimer);
            this.qr = null;
            this.qrExpiresAt = null;
            this.attempts = 0;
            this.lastError = null;
            this.me = this.socket?.user ?? null;
            this.phoneNumber = this.me?.id ? this.me.id.split(':')[0].split('@')[0] : null;

            await this.#setState('connected', {
                phone_number: this.phoneNumber,
                push_name: this.me?.name ?? null,
                last_connected_at: now(),
                last_error: null,
            });
            if (this.stopping || this.socket !== socket) return;

            this.log.info({ number: this.phoneNumber }, 'tersambung');
            this.healing.tick();
            clearTimeout(this.reconnectTimer);
            clearInterval(this.deliveryTimer);
            const flush = () => Promise.resolve().then(() => this.bot.flushPending?.(this.key, this)).catch((error) => {
                const quiet = error.code === 'RECOVERY_PENDING' || /connection closed|timed? ?out|econnreset|enotfound|sedang tidak tersambung/i.test(error.message);
                this.log.warn({ quiet, err: error.message, pending: pendingDeliveries(this.key).length }, 'balasan tertunda, akan dikirim ulang otomatis');
            }).then(() => {
                if (this.state === 'connected' && this.socket === socket) return this.bot.recoverIncoming?.(this.key, this);
            }).catch((error) => this.log.error({ err: error.message }, 'gagal melanjutkan pesan masuk tertunda'));
            flush();
            this.deliveryTimer = setInterval(flush, 30000);
            this.deliveryTimer.unref?.();
            clearInterval(this.inboxTimer);
            this.inboxTimer = setInterval(() => {
                if (this.state === 'connected' && this.socket === socket) {
                    this.bot.recoverIncoming?.(this.key, this)?.catch((error) => this.log.error({ err: error.message }, 'gagal melanjutkan pesan masuk tertunda'));
                }
            }, 5000);
            this.inboxTimer.unref?.();
            this.#learnOwnLid(this.socket?.user);

            clearInterval(this.catalogTimer);
            clearTimeout(this.catalogRetry);
            this.catalogRetry = setTimeout(() => this.syncCatalogWithRetry(), CATALOG_FIRST_DELAY_MS);
            this.catalogTimer = setInterval(() => this.syncCatalogWithRetry(), 6 * 3600000);
        }

        if (connection === 'close') {
            clearTimeout(this.connectionTimer);
            clearTimeout(this.catalogRetry);
            clearInterval(this.catalogTimer);
            clearInterval(this.deliveryTimer);
            clearInterval(this.inboxTimer);

            const statusCode = lastDisconnect?.error?.output?.statusCode ?? null;
            const loggedOut = statusCode === DisconnectReason.loggedOut;

            this.socket = null;
            this.qr = null;
            this.lastError = lastDisconnect?.error?.message ?? null;

            if (loggedOut) {
                this.healing.stop();
                await this.clearCredentials?.();
                this.healing.reset();
                await this.#setState('logged_out', { last_error: 'Perangkat dilepas dari HP. Scan QR lagi.' });
                this.log.warn('sesi dilepas dari HP, kredensial dibersihkan');

                return;
            }

            if (statusCode === DisconnectReason.connectionReplaced) {
                this.healing.stop();
                await this.#setState('replaced', { last_error: this.lastError });
                this.log.error(
                    { statusCode, error: this.lastError },
                    'nomor ini diambil alih program lain yang memakai kunci WhatsApp yang sama; bot berhenti menyambung',
                );

                return;
            }

            await this.#setState('disconnected', { last_error: this.lastError });

            if (this.stopping) {
                return;
            }

            this.#scheduleReconnect(statusCode);
        }
    }

    #scheduleReconnect(statusCode = null) {
        if (this.stopping || ['logged_out', 'replaced'].includes(this.state)) return;
        clearTimeout(this.reconnectTimer);
        const delay = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.min(this.attempts++, 6));
        this.log.info({ delay, statusCode, error: this.lastError }, 'menyambung ulang');
        if (this.attempts === RECONNECTS_BEFORE_ALERT) {
            this.log.error(
                { statusCode, error: this.lastError, attempts: this.attempts },
                `WhatsApp belum tersambung lagi setelah ${this.attempts} kali mencoba; bot terus mencoba`,
            );
        }

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.start().catch((error) => this.log.error(error, 'gagal menyambung ulang'));
        }, delay);
        this.reconnectTimer.unref?.();
    }

    async #onMessages({ messages, type }) {
        for (const message of messages) {
            if (message.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT) continue;
            if (message.message) this.healing.received(message.key);
            if (message.key?.fromMe && this.bot.isBotMessage(message.key.id)) rememberRetryMessage(this.key, message);
            learnFromKey(message.key);
            const jid = conversationJid(message.key.remoteJid ?? '');

            if (!jid || jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) continue;
            if (!config.allowGroups && jid.endsWith('@g.us')) continue;

            const content = normalizeMessageContent(message.message);
            const contentType = getContentType(content);

            if (!contentType || IGNORED_TYPES.has(contentType)) continue;

            const text =
                content?.conversation ??
                content?.extendedTextMessage?.text ??
                content?.imageMessage?.caption ??
                content?.videoMessage?.caption ??
                content?.documentMessage?.caption ??
                '';

            const selfTest = Boolean(message.key.fromMe && this.#isSelfChat(jid));

            if (selfTest) {
                if (this.bot.isBotMessage(message.key.id) || !isRecent(message)) continue;
            } else if (message.key.fromMe) {
                this.bot.onOwnMessage(this.key, { jid, id: message.key.id, text });
                continue;
            } else if (type !== 'notify') {
                if (!isRecentCatchUp(message)) {
                    const timestamp = Number(message.messageTimestamp ?? 0) * 1000;
                    if (timestamp >= Date.now() - 24 * 3600000 && isBotActive(new Date(timestamp))) {
                        this.bot.onMissedIncoming?.(this.key, { jid, id: message.key.id, text: text || Session.attachmentOf(contentType, content)?.note || '[pesan tertunda]' });
                    }
                    this.log.info({ from: jid, type, id: message.key.id }, 'pesan lama dari sinkronisasi dilewati');
                    continue;
                }
                this.log.info({ from: jid, type }, 'pesan tertunda saat menyambung ulang, tetap dibalas');
            }

            const attachment = Session.attachmentOf(contentType, content);
            const hasImage = ['gambar', 'video', 'file'].includes(attachment?.kind);
            const hasAudio = attachment?.kind === 'suara';

            const quoted = Session.quotedText(content);

            this.log.info({ from: jid, type: contentType, text, selfTest }, selfTest ? 'pesan uji dari nomor sendiri' : 'pesan masuk');

            this.bot.onIncoming(this.key, this, { jid, id: message.key.id, text, hasImage, hasAudio, attachment, quoted, selfTest });
        }
    }

    #learnOwnLid(me) {
        setOwnIdentity(me ?? {});
    }

    #isSelfChat(jid) {
        const own = [this.socket?.user?.id, this.socket?.user?.lid].filter(Boolean).map(userOf);

        return own.includes(userOf(jid)) && !jid.endsWith('@g.us');
    }


    newMessageId() {
        return generateMessageIDV2(this.socket?.user?.id);
    }

    async send(jid, action, messageId, canSend = () => true) {
        if (this.healing.waitingForOwn(jid, conversationJid, (id) => this.bot.isBotMessage(id))) {
            throw Object.assign(new Error('Menunggu pemulihan pesan dari HP agar bot tidak menimpa balasan CS'), { code: 'RECOVERY_PENDING' });
        }
        if (this.state !== 'connected' || !this.socket) {
            throw new Error(`Nomor "${this.label}" sedang tidak tersambung`);
        }

        const socket = this.socket;
        try {
            await withDeadline(() => socket.sendPresenceUpdate('composing', jid), 2500, 'typing presence');
            await sleep(config.bot.typingMs);
            await withDeadline(() => socket.sendPresenceUpdate('paused', jid), 2500, 'paused presence');
        } catch {
        }

        if (this.socket !== socket || this.state !== 'connected') throw new Error('Connection Closed');
        if (this.healing.waitingForOwn(jid, conversationJid, (id) => this.bot.isBotMessage(id))) {
            throw Object.assign(new Error('Menunggu pemulihan pesan dari perangkat toko'), { code: 'RECOVERY_PENDING' });
        }
        try {
            const result = await withDeadline(() => canSend() ? socket.sendMessage(jid, Session.content(action), { messageId }) : undefined, 120000, 'WhatsApp send');
            rememberRetryMessage(this.key, result);
        } catch (error) {
            if (this.socket === socket && /connection closed|timed? ?out|econnreset|enotfound/i.test(error.message)) socket.end(error);
            throw error;
        }
    }

    static attachmentOf(contentType, content) {
        switch (contentType) {
            case 'imageMessage':
                return { kind: 'gambar', note: '[gambar dari pelanggan]' };
            case 'videoMessage':
                return { kind: 'video', note: '[video dari pelanggan]' };
            case 'documentMessage':
            case 'documentWithCaptionMessage':
                return { kind: 'file', note: `[file dari pelanggan: ${content?.documentMessage?.fileName ?? 'dokumen'}]` };
            case 'audioMessage':
                return { kind: 'suara', note: '[pesan suara]' };
            case 'stickerMessage':
                return { kind: 'stiker', note: null };
            case 'locationMessage':
            case 'liveLocationMessage': {
                const loc = content?.locationMessage ?? content?.liveLocationMessage ?? {};
                const at = loc.degreesLatitude != null ? ` https://maps.google.com/?q=${loc.degreesLatitude},${loc.degreesLongitude}` : '';

                return { kind: 'lokasi', note: `[lokasi pelanggan${loc.name ? `: ${loc.name}` : ''}]${at}` };
            }
            case 'contactMessage':
            case 'contactsArrayMessage':
                return { kind: 'kontak', note: `[kontak dikirim: ${content?.contactMessage?.displayName ?? 'beberapa kontak'}]` };
            default:
                return null;
        }
    }

    static quotedText(content) {
        const quoted = Object.values(content ?? {}).find((part) => part?.contextInfo?.quotedMessage)?.contextInfo?.quotedMessage;
        if (!quoted) return null;

        const text = quoted.conversation ?? quoted.extendedTextMessage?.text ?? quoted.imageMessage?.caption ?? quoted.videoMessage?.caption ?? '';

        return text ? String(text).slice(0, 300) : null;
    }

    static content(action) {
        if (action.type === 'text') {
            return { text: action.text };
        }

        const extension = path.extname(action.file).toLowerCase();
        const mimetype = MIME[extension];

        if (extension === '.pdf') {
            return { document: { url: action.file }, mimetype, fileName: path.basename(action.file) };
        }

        return { image: { url: action.file }, mimetype };
    }

    async syncCatalogWithRetry(attempt = 0) {
        const socket = this.socket;
        if (this.catalogSyncing === socket) return;
        this.catalogSyncing = socket;
        try {
            if (this.state !== 'connected' || !this.socket) return;

            await syncCatalog(socket, { isCurrent: () => this.socket === socket && this.state === 'connected' });
        } catch (error) {
            if (this.socket !== socket || this.state !== 'connected') return;
            const retry = CATALOG_RETRY_MS[attempt];

            if (retry != null && /timed? ?out/i.test(error.message)) {
                this.log.info({ err: error.message, retryInMinutes: retry / 60000 }, 'katalog WhatsApp belum terbaca, dicoba lagi');
                clearTimeout(this.catalogRetry);
                this.catalogRetry = setTimeout(() => this.syncCatalogWithRetry(attempt + 1), retry);

                return;
            }

            this.#catalogFailed(error, attempt + 1);
            if (/timed? ?out|connection closed|econnreset|enotfound/i.test(error.message)) {
                clearTimeout(this.catalogRetry);
                this.catalogRetry = setTimeout(() => this.syncCatalogWithRetry(), 30 * 60000);
                this.catalogRetry.unref?.();
            }
        } finally {
            if (this.catalogSyncing === socket) this.catalogSyncing = null;
        }
    }

    async syncCatalog() {
        if (this.state !== 'connected' || !this.socket) {
            throw Object.assign(new Error('WhatsApp belum tersambung'), { statusCode: 409 });
        }

        try {
            return await syncCatalog(this.socket);
        } catch (error) {
            this.#catalogFailed(error, 1);
            throw error;
        }
    }

    #catalogFailed(error, attempts) {
        try {
            recordSyncError(error);
        } catch (writeError) {
            this.log.error({ err: writeError.message }, 'gagal menyimpan error katalog');
        }
        this.log.warn({ err: error.message, attempts }, 'katalog WhatsApp gagal dibaca');
    }

    async stop() {
        clearInterval(this.inboxTimer);
        this.healing.stop();
        clearTimeout(this.connectionTimer);
        ++this.generation;
        this.starting = null;
        clearInterval(this.deliveryTimer);
        clearInterval(this.catalogTimer);
        clearTimeout(this.catalogRetry);
        this.stopping = true;
        clearTimeout(this.reconnectTimer);

        try {
            this.socket?.end(undefined);
        } catch {
        }

        this.socket = null;
        this.qr = null;
        await this.#setState('disconnected');
    }

    async logout() {
        clearInterval(this.inboxTimer);
        this.healing.stop();
        clearTimeout(this.connectionTimer);
        ++this.generation;
        this.starting = null;
        clearInterval(this.deliveryTimer);
        this.stopping = true;
        clearInterval(this.catalogTimer);
        clearTimeout(this.catalogRetry);
        clearTimeout(this.reconnectTimer);

        try {
            await this.socket?.logout();
        } catch (error) {
            this.log.warn({ err: error.message }, 'logout gagal, tetap membersihkan kredensial');
        }

        const { clear } = await useSqliteAuthState(this.id);
        await clear();
        this.healing.reset();

        this.socket = null;
        this.qr = null;
        this.me = null;
        this.phoneNumber = null;

        await this.#setState('logged_out', { phone_number: null, push_name: null });
    }

    status() {
        return {
            key: this.key,
            label: this.label,
            state: this.state,
            connected: this.state === 'connected',
            reconnecting: ['disconnected', 'connecting'].includes(this.state) && !this.stopping && Boolean(this.reconnectTimer || this.starting),
            phoneNumber: this.phoneNumber,
            pushName: this.me?.name ?? null,
            hasQr: Boolean(this.qr),
            lastError: this.lastError,
            pendingMessages: pendingDeliveries(this.key).length,
            pendingIncoming: incomingRows(this.key).length,
            healing: this.healing.status(),
        };
    }

    static toJid(recipient) {
        const value = String(recipient).trim();

        if (value.includes('@')) {
            return value;
        }

        const digits = value.replace(/\D/g, '');

        if (!digits) {
            throw Object.assign(new Error('Nomor tujuan tidak valid'), { statusCode: 422 });
        }

        return `${digits}@s.whatsapp.net`;
    }

    async sendText(to, text) {
        if (this.state !== 'connected' || !this.socket) {
            throw Object.assign(new Error(`Nomor "${this.label}" sedang tidak tersambung`), { statusCode: 409 });
        }

        const jid = Session.toJid(to);
        const result = await this.socket.sendMessage(jid, { text });

        return { id: result?.key?.id ?? null, to: jid, session: this.key };
    }

    async #setState(state, extra = {}) {
        this.state = state;

        const columns = { status: state, ...extra };
        const assignments = Object.keys(columns).map((column) => `"${column}" = ?`).join(', ');

        run(
            `UPDATE wa_sessions SET ${assignments}, updated_at = ? WHERE id = ?`,
            [...Object.values(columns), now(), this.id],
        );
    }
}
