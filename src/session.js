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
} from 'baileys';

import { useSqliteAuthState } from './auth-state.js';
import { recordSyncError, syncCatalog } from './bot/catalog.js';
import { fixMexNotifications, makePlaceholderCache, sessionHandledLog } from './baileys-fixes.js';
import { conversationJid, learnFromKey, setOwnIdentity, userOf, withLidFallback } from './lid.js';
import { MIME } from './bot/media.js';
import { config } from './config.js';
import { now, run } from './db.js';
import { logger } from './logger.js';
import { pendingDeliveries, rememberRetryMessage, retryMessage } from './delivery.js';

const MAX_BACKOFF_MS = 60000;
const RECONNECTS_BEFORE_ALERT = 3;
// The catalog is read a minute after connecting, then retried on a time-out.
const CATALOG_FIRST_DELAY_MS = 60000;
const CATALOG_RETRY_MS = [3 * 60000, 10 * 60000];

// Message types that carry nothing for the bot to answer.
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

/** Chats the bot never reads, so Baileys does not decrypt them: statuses, broadcasts, channels, groups unless allowed. */
export const ignoredJid = (jid) =>
    Boolean(isJidBroadcast(jid) || isJidNewsletter(jid) || (!config.allowGroups && isJidGroup(jid)));

// Sent within the last two minutes (messageTimestamp is seconds, maybe a Long).
const isRecent = (message) => Date.now() / 1000 - Number(message.messageTimestamp ?? 0) < 120;

// A customer message delivered late (the bot was reconnecting or restarting): still answered within this window.
const CATCH_UP_SECONDS = 15 * 60;
export const isRecentCatchUp = (message, now = Date.now()) => now / 1000 - Number(message?.messageTimestamp ?? 0) < CATCH_UP_SECONDS;

/** One WhatsApp number: its socket, its pairing state and its reconnect loop. */
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
        // Baileys is chatty at info (pairing blobs, handshakes); keep its warnings only.
        // Its connection errors that this session handles go to the log file, not the pop-up (baileys-fixes.js).
        this.baileysLog = sessionHandledLog(logger.child({ session: row.key }, { level: 'warn' }), this.log);
    }

    async start() {
        if (this.starting) {
            return this.starting;
        }

        if (this.state === 'connected') {
            return;
        }

        this.stopping = false;
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

        // This HTTP request used to wait indefinitely when internet disappeared.
        // Baileys falls back to its bundled version on failure.
        const { version } = await this.fetchVersion({ timeout: 10000 });
        if (this.stopping || generation !== this.generation) return;

        const connectionLog = sessionHandledLog(this.baileysLog, this.log, () => {
            if (this.socket === socket && !this.stopping) {
                // A ping query can fail without Baileys closing its websocket.
                // Closing explicitly drives the same reconnect path as a drop.
                socket.end(new Error('Koneksi WhatsApp tidak merespons; menyambung ulang'));
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
            // No history sync at all. Baileys holds every event back (messages
            // included) while it syncs history, until the phone's app-state key
            // arrives; when that key's message could not be decrypted, the hold
            // never ended and no customer message reached the bot for a week
            // (2026-10-20..27), with no error. The bot never uses chat history.
            shouldSyncHistoryMessage: () => false,
            // Without this the socket dies silently behind some NATs.
            keepAliveIntervalMs: 25000,
            // The start-up queries (account props, block list, privacy settings)
            // timed out on a client PC ("unexpected error in 'init queries'"),
            // and the bot uses none of them: Baileys fetches privacy settings on
            // demand itself when sending read receipts, which the bot never does.
            // Not asking is the fix.
            fireInitQueries: false,
            // A slow line answers slowly; 60 s (the default) ran out there.
            defaultQueryTimeoutMs: 120000,
            // Statuses, channels (and groups unless allowed) are never read by the
            // bot. Baileys still decrypted them, and a contact's Status without
            // its sender key failed ("No session found to decrypt message",
            // status@broadcast). Ignored, Baileys only acknowledges them.
            shouldIgnoreJid: (jid) => ignoredJid(jid),
            // Baileys' own cache throws on an empty key from our phone (baileys-fixes.js).
            placeholderResendCache: makePlaceholderCache(),
            msgRetryCounterCache: this.retryCounterCache,
            getMessage: async (key) => retryMessage(this.key, key),
        });

        this.socket = socket;

        // Our phone sends by LID while its encryption session was made under the
        // number: read those messages with that session (see lid.js). Without it
        // a reply CS typed on the phone could not be decrypted and went unseen.
        withLidFallback(socket.signalRepository, undefined, this.decryptCache);
        this.#learnOwnLid(state.creds.me);
        // Linked-profile "mex" notifications are not channel ones (baileys-fixes.js).
        fixMexNotifications(socket);

        socket.ev.on('creds.update', () => {
            if (this.stopping || generation !== this.generation || this.socket !== socket) return;
            saveCreds().catch((error) => this.log.error({ err: error.message }, 'gagal menyimpan sesi WhatsApp'));
        });
        // WhatsApp sends our own LID after the connection opens (creds.me has
        // only the number until then), so the pair is learnt when it arrives.
        // Without it, our phone's messages by LID were never retried with the
        // number's session: "Bad MAC" / "No matching sessions" on every one.
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
            this.qr = await QRCode.toDataURL(qr, { margin: 1, width: 360 });
            // WhatsApp rotates the pairing code roughly every 20 seconds.
            this.qrExpiresAt = Date.now() + 20000;
            await this.#setState('qr');

            if (config.printQrInTerminal) {
                qrTerminal.generate(qr, { small: true });
                this.log.info('scan QR di atas dari HP: WhatsApp > Perangkat tertaut');
            }
        }

        if (connection === 'open') {
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
            clearTimeout(this.reconnectTimer);
            clearInterval(this.deliveryTimer);
            const flush = () => this.bot.flushPending?.(this.key, this)?.catch((error) => {
                this.log.warn({ err: error.message, pending: pendingDeliveries(this.key).length }, 'balasan tertunda, akan dikirim ulang otomatis');
            });
            flush();
            this.deliveryTimer = setInterval(flush, 30000);
            this.deliveryTimer.unref?.();
            this.#learnOwnLid(this.socket?.user);

            // Read the WhatsApp Business catalog once the connection has settled
            // (right after connecting WhatsApp is busy with its own start-up
            // queries and a catalog query times out), then every 6 hours.
            clearInterval(this.catalogTimer);
            clearTimeout(this.catalogRetry);
            this.catalogRetry = setTimeout(() => this.syncCatalogWithRetry(), CATALOG_FIRST_DELAY_MS);
            this.catalogTimer = setInterval(() => this.syncCatalogWithRetry(), 6 * 3600000);
        }

        if (connection === 'close') {
            // A catalog read waiting for its retry belongs to this connection; the next one schedules its own.
            clearTimeout(this.catalogRetry);
            clearInterval(this.catalogTimer);
            clearInterval(this.deliveryTimer);

            const statusCode = lastDisconnect?.error?.output?.statusCode ?? null;
            const loggedOut = statusCode === DisconnectReason.loggedOut;

            this.socket = null;
            this.qr = null;
            this.lastError = lastDisconnect?.error?.message ?? null;

            if (loggedOut) {
                // The stored credentials are dead; drop them so the next
                // connect produces a fresh QR instead of failing forever.
                await this.clearCredentials?.();
                await this.#setState('logged_out', { last_error: 'Perangkat dilepas dari HP. Scan QR lagi.' });
                this.log.warn('sesi dilepas dari HP, kredensial dibersihkan');

                return;
            }

            // "Stream Errored (conflict)": another program connected with these
            // same keys (a copied data folder, a second bot) took the connection.
            // Reconnecting would take it back, the other would retake it, and the
            // two would fight forever, wrecking the encryption sessions ("Bad MAC").
            // Stop here and say so; the team chooses in the console.
            if (statusCode === DisconnectReason.connectionReplaced) {
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
        // One drop is normal (WhatsApp's 515 after connecting, a network blip) and is
        // retried quietly; still down after a few tries needs a person: said once, raw.
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
            if (message.key?.fromMe && this.bot.isBotMessage(message.key.id)) rememberRetryMessage(this.key, message);
            // Which LID is which number (WhatsApp sends both); then one customer
            // is one conversation, whether a message came by number or by LID.
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

            // "Message yourself" on the bot's own number is a test chat: what the
            // team types there is answered as if a customer wrote it.
            const selfTest = Boolean(message.key.fromMe && this.#isSelfChat(jid));

            if (selfTest) {
                // The bot's own replies echo back here too; and an old self-chat
                // message from a history sync is not a new test.
                if (this.bot.isBotMessage(message.key.id) || !isRecent(message)) continue;
            } else if (message.key.fromMe) {
                // Typed by CS on the phone, the echo of a bot reply, or a WhatsApp
                // Business automatic message (Salam, Pesan tidak di tempat).
                this.bot.onOwnMessage(this.key, { jid, id: message.key.id, text });
                continue;
            } else if (type !== 'notify') {
                // A message that came while the bot was reconnecting arrives as a
                // catch-up ("append"); a recent one is a customer waiting, not
                // history. These were dropped without a trace (2026-10-27: no chat
                // reached the bot for a week while the line kept timing out).
                if (!isRecentCatchUp(message)) {
                    this.log.info({ from: jid, type, id: message.key.id }, 'pesan lama dari sinkronisasi dilewati');
                    continue;
                }
                this.log.info({ from: jid, type }, 'pesan tertunda saat menyambung ulang, tetap dibalas');
            }

            // What came with (or instead of) words. A sticker is a reaction, not a design.
            const attachment = Session.attachmentOf(contentType, content);
            const hasImage = ['gambar', 'video', 'file'].includes(attachment?.kind);
            // A voice note: the bot cannot listen, it asks them to type.
            const hasAudio = attachment?.kind === 'suara';

            // The message they replied to (WhatsApp "reply"), so the AI knows what "yang ini" means.
            const quoted = Session.quotedText(content);

            this.log.info({ from: jid, type: contentType, text, selfTest }, selfTest ? 'pesan uji dari nomor sendiri' : 'pesan masuk');

            this.bot.onIncoming(this.key, this, { jid, id: message.key.id, text, hasImage, hasAudio, attachment, quoted, selfTest });
        }
    }

    /** The bot's own LID is its own number (creds.me / socket.user carry both). */
    #learnOwnLid(me) {
        setOwnIdentity(me ?? {});
    }

    /** The chat with the bot's own number, by phone jid or by LID. */
    #isSelfChat(jid) {
        const own = [this.socket?.user?.id, this.socket?.user?.lid].filter(Boolean).map(userOf);

        return own.includes(userOf(jid)) && !jid.endsWith('@g.us');
    }

    /* ---------------------------------------------- transport for the bot --- */

    newMessageId() {
        return generateMessageIDV2(this.socket?.user?.id);
    }

    /** Sends one bot bubble, showing "typing..." first so replies do not land in a burst. */
    async send(jid, action, messageId) {
        if (this.state !== 'connected' || !this.socket) {
            throw new Error(`Nomor "${this.label}" sedang tidak tersambung`);
        }

        const socket = this.socket;
        try {
            await socket.sendPresenceUpdate('composing', jid);
            await sleep(config.bot.typingMs);
            await socket.sendPresenceUpdate('paused', jid);
        } catch {
            /* presence is cosmetic */
        }

        if (this.socket !== socket || this.state !== 'connected') throw new Error('Connection Closed');
        try {
            const result = await socket.sendMessage(jid, Session.content(action), { messageId });
            rememberRetryMessage(this.key, result);
        } catch (error) {
            if (this.socket === socket && /connection closed|timed? ?out|econnreset|enotfound/i.test(error.message)) socket.end(error);
            throw error;
        }
    }

    /**
     * What a message carries besides text, in the words the console and the
     * reply use: { kind: 'gambar' | 'video' | 'file' | 'suara' | 'stiker' | 'lokasi' | 'kontak', note }.
     * `note` is what CS needs to see (a maps link for a shared location).
     */
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

    /** Text of the message they replied to, if any (first 300 characters). */
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

    /**
     * The scheduled catalog read: a time-out is tried again later (3, then 10
     * minutes); only when every try failed is it a warning (the console
     * pop-up). Meanwhile the bot keeps sending the shop's catalog link.
     */
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
                // Keep the last good catalog and uploaded files usable while
                // WhatsApp's catalog service is unavailable. Do not give up for 6h.
                clearTimeout(this.catalogRetry);
                this.catalogRetry = setTimeout(() => this.syncCatalogWithRetry(), 30 * 60000);
                this.catalogRetry.unref?.();
            }
        } finally {
            if (this.catalogSyncing === socket) this.catalogSyncing = null;
        }
    }

    /** Copies this number's WhatsApp Business catalog into the bot ("Sinkronkan sekarang"). */
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

    /**
     * Remembers why the catalog could not be read (a personal number has none)
     * and says so: the console pop-up and Media > Katalog show it. Never throws,
     * so a failing database write here cannot take the bot down.
     */
    #catalogFailed(error, attempts) {
        try {
            recordSyncError(error);
        } catch (writeError) {
            this.log.error({ err: writeError.message }, 'gagal menyimpan error katalog');
        }
        this.log.warn({ err: error.message, attempts }, 'katalog WhatsApp gagal dibaca');
    }

    async stop() {
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
            /* already gone */
        }

        this.socket = null;
        this.qr = null;
        await this.#setState('disconnected');
    }

    /** Unlinks the device on the phone and clears the stored pairing. */
    async logout() {
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
            phoneNumber: this.phoneNumber,
            pushName: this.me?.name ?? null,
            hasQr: Boolean(this.qr),
            lastError: this.lastError,
            pendingMessages: pendingDeliveries(this.key).length,
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
