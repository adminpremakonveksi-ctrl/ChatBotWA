import QRCode from 'qrcode';
import qrTerminal from 'qrcode-terminal';
import path from 'node:path';

import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateMessageIDV2,
    getContentType,
    makeCacheableSignalKeyStore,
    normalizeMessageContent,
} from 'baileys';

import { useSqliteAuthState } from './auth-state.js';
import { recordSyncError, syncCatalog } from './bot/catalog.js';
import { MIME } from './bot/media.js';
import { config } from './config.js';
import { now, run } from './db.js';
import { logger } from './logger.js';

const MAX_BACKOFF_MS = 60000;

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

/** One WhatsApp number: its socket, its pairing state and its reconnect loop. */
export class Session {
    constructor(row, bot) {
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
        this.log = logger.child({ session: row.key });
        // Baileys is chatty at info (pairing blobs, handshakes); keep its warnings only.
        this.baileysLog = logger.child({ session: row.key }, { level: 'warn' });
    }

    async start() {
        if (this.starting) {
            return this.starting;
        }

        if (this.state === 'connected') {
            return;
        }

        this.stopping = false;
        this.starting = this.#connect().finally(() => {
            this.starting = null;
        });

        return this.starting;
    }

    async #connect() {
        await this.#setState('connecting');

        const { state, saveCreds, clear } = await useSqliteAuthState(this.id);
        this.clearCredentials = clear;

        const { version } = await fetchLatestBaileysVersion();

        const socket = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, this.baileysLog),
            },
            logger: this.baileysLog,
            browser: ['ChatBot Prema', 'Chrome', '1.0.0'],
            markOnlineOnConnect: false,
            syncFullHistory: false,
            // Without this the socket dies silently behind some NATs.
            keepAliveIntervalMs: 25000,
        });

        this.socket = socket;

        socket.ev.on('creds.update', saveCreds);
        socket.ev.on('connection.update', (update) => this.#onConnectionUpdate(update));
        socket.ev.on('messages.upsert', (event) => this.#onMessages(event));
    }

    async #onConnectionUpdate({ connection, lastDisconnect, qr }) {
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

            this.log.info({ number: this.phoneNumber }, 'tersambung');

            // Read the WhatsApp Business catalog now and every 6 hours after.
            clearInterval(this.catalogTimer);
            setTimeout(() => this.syncCatalog().catch(() => {}), 5000);
            this.catalogTimer = setInterval(() => this.syncCatalog().catch(() => {}), 6 * 3600000);
        }

        if (connection === 'close') {
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

            await this.#setState('disconnected', { last_error: this.lastError });

            if (this.stopping) {
                return;
            }

            const delay = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** this.attempts++);
            this.log.info({ delay, statusCode }, 'menyambung ulang');

            this.reconnectTimer = setTimeout(() => {
                this.start().catch((error) => this.log.error(error, 'gagal menyambung ulang'));
            }, delay);
        }
    }

    async #onMessages({ messages, type }) {
        for (const message of messages) {
            const jid = message.key.remoteJid ?? '';

            if (!jid || jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) continue;
            if (!config.allowGroups && jid.endsWith('@g.us')) continue;

            const content = normalizeMessageContent(message.message);
            const contentType = getContentType(content);

            if (!contentType || IGNORED_TYPES.has(contentType)) continue;

            if (message.key.fromMe) {
                // Typed by CS on the phone, or the echo of a bot reply.
                this.bot.onOwnMessage(this.key, { jid, id: message.key.id });
                continue;
            }

            // History sync and other catch-up batches are not new chats.
            if (type !== 'notify') continue;

            const text =
                content?.conversation ??
                content?.extendedTextMessage?.text ??
                content?.imageMessage?.caption ??
                content?.videoMessage?.caption ??
                content?.documentMessage?.caption ??
                '';

            const hasImage = ['imageMessage', 'documentMessage', 'videoMessage', 'stickerMessage'].includes(contentType);

            this.log.info({ from: jid, type: contentType, text }, 'pesan masuk');

            this.bot.onIncoming(this.key, this, { jid, id: message.key.id, text, hasImage });
        }
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

        try {
            await this.socket.sendPresenceUpdate('composing', jid);
            await sleep(config.bot.typingMs);
            await this.socket.sendPresenceUpdate('paused', jid);
        } catch {
            /* presence is cosmetic */
        }

        await this.socket.sendMessage(jid, Session.content(action), { messageId });
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

    /** Stops the socket without touching the stored pairing. */
    /** Copies this number's WhatsApp Business catalog into the bot. */
    async syncCatalog() {
        if (this.state !== 'connected' || !this.socket) {
            throw Object.assign(new Error('WhatsApp belum tersambung'), { statusCode: 409 });
        }

        try {
            return await syncCatalog(this.socket);
        } catch (error) {
            // A personal (non-Business) number has no catalog: remember why, keep running.
            recordSyncError(error);
            this.log.warn({ err: error.message }, 'katalog WhatsApp gagal dibaca');
            throw error;
        }
    }

    async stop() {
        clearInterval(this.catalogTimer);
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
        this.stopping = true;
        clearInterval(this.catalogTimer);
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
