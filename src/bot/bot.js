import path from 'node:path';

import { config } from '../config.js';
import { recordActivity } from '../activity.js';
import { logger } from '../logger.js';
import { db } from '../db.js';
import { withDeadline } from '../deadline.js';
import { beginIncoming, cancelIncoming, completeIncoming, deferIncoming, enqueueIncoming, inboxExpired, incomingRows } from '../inbox.js';
import { cancelDeliveries, completeDelivery, enqueueDelivery, pendingDeliveries } from '../delivery.js';
import { classify as defaultClassify } from './classify.js';
import { isAutoMessage, releaseAutoHandovers } from './auto-messages.js';
import { chatTurn } from './chat.js';
import { decide } from './engine.js';
import { productName } from './products.js';
import { replies } from './replies.js';
import { media as defaultMedia } from './media.js';
import { isBotActive } from './schedule.js';
import * as defaultStore from './store.js';

/**
 * Glue between WhatsApp sessions and the reply flow.
 *
 * - Outside the night window nothing is answered; CS handles those chats.
 * - Bubbles sent in quick succession are collected and answered together.
 * - Each customer is handled strictly one batch at a time.
 * - When CS types from the phone, the bot stops answering that customer.
 */
const REPEAT_LIMIT = 2;
const REPEAT_WINDOW_MINUTES = 10;

// Staff-facing, only ever sent in the bot number's own "Message yourself" chat.
const SELF_TEST_RESET = '🔄 Mode uji: percakapan dimulai ulang. Ketik pesan seperti pelanggan.';

export class Bot {
    constructor({
        classify = defaultClassify,
        chat = chatTurn,
        media = defaultMedia,
        store = defaultStore,
        isActive = () => isBotActive(),
        debounceMs = config.bot.debounceMs,
    } = {}) {
        this.classify = classify;
        this.chat = chat;
        this.media = media;
        this.store = store;
        this.isActive = isActive;
        this.debounceMs = debounceMs;

        this.buffers = new Map();
        this.queues = new Map();
        this.deliveries = new Map();
        this.claimedIncoming = new Set();
        // "session|jid" -> when the WhatsApp Business Salam went out to a new customer.
        this.autoGreeted = new Map();
        this.log = logger.child({ part: 'bot' });
    }

    /**
     * @param transport  { newMessageId() -> string, send(jid, action, messageId) -> Promise }
     *                   action is { type: 'text', text } or { type: 'file', file }
     */
    onIncoming(sessionKey, transport, { jid, id, text = '', hasImage = false, hasAudio = false, attachment = null, quoted = null, selfTest = false }) {
        if (this.store.hasReceived?.(sessionKey, jid, id)) return;
        const eligible = (selfTest || this.isActive()) && (selfTest || !config.recap.to.includes(this.store.phoneOf(jid)));
        const reset = selfTest && /^\s*#?reset\s*$/i.test(text);
        // A picture, location or file without words is logged by what it is, so CS sees it in Percakapan.
        db.transaction(() => {
            this.store.logMessage({ sessionKey, jid, direction: 'in', waMessageId: id, text: text || attachment?.note || '' });
            if (eligible && !reset) enqueueIncoming(sessionKey, jid, id, { text, hasImage, hasAudio, attachment, quoted, selfTest });
        })();

        // The self-chat test answers at any hour, so the team can try the bot by day.
        if (!selfTest && !this.isActive()) {
            return;
        }

        // The recap recipients are staff; never greet them as customers.
        if (!selfTest && config.recap.to.includes(this.store.phoneOf(jid))) {
            return;
        }

        // "reset" in the test chat starts the conversation over, handover included.
        if (selfTest && /^\s*#?reset\s*$/i.test(text)) {
            this.store.resetConversation(sessionKey, jid);
            this.#enqueue(`${sessionKey}|${jid}`, () => this.#sendNote(sessionKey, transport, jid, SELF_TEST_RESET));

            return;
        }

        const key = `${sessionKey}|${jid}`;
        const buffer = this.buffers.get(key) ?? { texts: [], hasImage: false, hasAudio: false, attachments: [], quoted: null, timer: null, selfTest, ids: [] };
        if (id) {
            buffer.ids.push(id);
            this.claimedIncoming.add(`${sessionKey}|${id}`);
        }

        if (text) buffer.texts.push(text);
        buffer.hasImage ||= hasImage;
        buffer.hasAudio ||= hasAudio;
        if (attachment) buffer.attachments.push(attachment);
        if (quoted) buffer.quoted = quoted;

        buffer.run = () => this.#runBatch(sessionKey, transport, jid, buffer);

        clearTimeout(buffer.timer);
        buffer.timer = setTimeout(() => {
            this.buffers.delete(key);
            this.#enqueue(key, buffer.run);
        }, this.debounceMs);

        this.buffers.set(key, buffer);
    }

    /** Rebuild the original message batch without logging the input twice. */
    #inputOf(rows) {
        return {
            ids: rows.map((r) => r.message_id),
            texts: rows.map((r) => r.payload.text).filter(Boolean),
            hasImage: rows.some((r) => r.payload.hasImage),
            hasAudio: rows.some((r) => r.payload.hasAudio),
            attachments: rows.map((r) => r.payload.attachment).filter(Boolean),
            quoted: [...rows].reverse().find((r) => r.payload.quoted)?.payload.quoted ?? null,
            selfTest: rows.every((r) => r.payload.selfTest),
        };
    }

    /** Late catch-up is recorded for CS instead of silently disappearing. */
    onMissedIncoming(sessionKey, { jid, id, text }) {
        if (this.store.hasReceived?.(sessionKey, jid, id)) return;
        db.transaction(() => {
            this.store.logMessage({ sessionKey, jid, direction: 'in', waMessageId: id, text, intent: 'tertunda_saat_offline' });
            if (this.store.loadConversation(sessionKey, jid).step !== 'handed_over') {
                this.store.markHandover(sessionKey, jid, 'pesan masuk saat offline; terlalu lama untuk dibalas otomatis');
            }
        })();
    }

    async #runBatch(sessionKey, transport, jid, input) {
        let batch = input;
        try {
            if (input.ids?.length) {
                const rows = incomingRows(sessionKey).filter((row) => row.jid === jid &&
                    (input.ids.includes(row.message_id) || !this.claimedIncoming.has(`${sessionKey}|${row.message_id}`)));
                if (!rows.length) return; // CS/reset cancelled this queued turn.
                if (rows.some((r) => inboxExpired(r) || r.corrupt)) {
                    this.#abandonIncoming(sessionKey, jid, 'pesan belum berhasil diproses setelah percobaan ulang');
                    return;
                }
                batch = this.#inputOf(rows);
                for (const id of batch.ids) this.claimedIncoming.add(`${sessionKey}|${id}`);
                db.transaction(() => beginIncoming(sessionKey, batch.ids))();
            }
            await this.handle(sessionKey, transport, jid, batch);
        } catch (error) {
            // If output has already been committed, the inbox is gone and the
            // durable outbox resumes sending. Otherwise retry the original input.
            deferIncoming(sessionKey, batch.ids ?? [], error.message);
            throw error;
        } finally {
            for (const id of [...(input.ids ?? []), ...(batch.ids ?? [])]) this.claimedIncoming.delete(`${sessionKey}|${id}`);
        }
    }

    #abandonIncoming(sessionKey, jid, reason) {
        const rows = incomingRows(sessionKey).filter((row) => row.jid === jid);
        if (!rows.length) return;
        db.transaction(() => {
            cancelIncoming(sessionKey, jid);
            cancelDeliveries(sessionKey, jid);
            if (this.store.loadConversation(sessionKey, jid).step !== 'handed_over') this.store.markHandover(sessionKey, jid, reason);
        })();
        this.log.warn({ jid, reason, messages: rows.length, lastError: rows.find((r) => r.last_error)?.last_error }, 'pesan tertunda perlu ditindaklanjuti CS');
    }

    /** Resume original input after restart/AI outage. Same per-chat queue as live input. */
    async recoverIncoming(sessionKey, transport) {
        const groups = new Map();
        for (const row of incomingRows(sessionKey)) {
            const rows = groups.get(row.jid) ?? [];
            rows.push(row);
            groups.set(row.jid, rows);
        }
        const jobs = [];
        for (const [jid, rows] of groups) {
            if (rows.some((r) => this.claimedIncoming.has(`${sessionKey}|${r.message_id}`))) continue;
            if (rows.some((r) => inboxExpired(r) || r.corrupt)) {
                this.#abandonIncoming(sessionKey, jid, 'pesan belum berhasil diproses setelah percobaan ulang');
                continue;
            }
            if (Date.parse(rows[0].next_attempt_at.replace(' ', 'T') + 'Z') > Date.now()) continue;
            const input = this.#inputOf(rows);
            for (const id of input.ids) this.claimedIncoming.add(`${sessionKey}|${id}`);
            jobs.push(this.#enqueue(`${sessionKey}|${jid}`, () => this.#runBatch(sessionKey, transport, jid, input)));
            if (jobs.length >= 3) break;
        }
        await Promise.all(jobs);
    }

    isBotMessage(id) {
        return Boolean(id) && this.store.isBotMessage(id);
    }

    /** A staff-facing line (not a customer reply), logged first so its echo is known. */
    async #sendNote(sessionKey, transport, jid, text) {
        const id = transport.newMessageId();
        this.store.logMessage({ sessionKey, jid, direction: 'out', waMessageId: id, text });
        await transport.send(jid, { type: 'text', text }, id);
    }

    onOwnMessage(sessionKey, { jid, id, text = '' }) {
        if (!id || this.store.isBotMessage(id)) {
            return;
        }
        if (this.store.hasReceived?.(sessionKey, jid, id)) return;

        // WhatsApp Business sent its own Salam / away message: not CS, the bot carries on.
        if (isAutoMessage(text)) {
            this.store.logMessage({ sessionKey, jid, direction: 'auto', waMessageId: id, text });
            this.log.info({ jid }, 'pesan otomatis WhatsApp Business, bot tetap menangani');
            // Handed to CS earlier only because this text was taken for CS: back to the bot.
            if (releaseAutoHandovers({ sessionKey, jid }).length) this.log.info({ jid }, 'dikembalikan ke bot: yang dikira CS ternyata pesan otomatis');

            // The Salam already greeted them and asked who and where from: the
            // reply to the message it answered does not greet a second time.
            // Remembered briefly, so a Salam sent by day does not mute the night.
            if (this.store.loadConversation(sessionKey, jid).step === 'new') {
                this.autoGreeted.set(`${sessionKey}|${jid}`, Date.now());
            }

            return;
        }

        const conversation = this.store.loadConversation(sessionKey, jid);

        if (conversation.step !== 'handed_over') {
            this.log.info({ jid }, 'CS membalas dari HP, bot berhenti di nomor ini');
        }

        // What CS typed, so the console shows the whole conversation.
        this.store.logMessage({ sessionKey, jid, direction: 'cs', waMessageId: id, text: text || null });

        // Refresh even when already handed over, so the silence lasts from CS's last reply.
        this.store.markHandover(sessionKey, jid, 'CS membalas');
        cancelDeliveries(sessionKey, jid);

        const key = `${sessionKey}|${jid}`;
        for (const id of this.buffers.get(key)?.ids ?? []) this.claimedIncoming.delete(`${sessionKey}|${id}`);
        clearTimeout(this.buffers.get(key)?.timer);
        this.buffers.delete(key);
    }

    #enqueue(key, task) {
        const previous = this.queues.get(key) ?? Promise.resolve();
        const next = previous
            .then(task)
            .catch((error) => {
                const quiet = error.code === 'RECOVERY_PENDING' || /connection closed|timed? ?out|econnreset|enotfound|sedang tidak tersambung/i.test(error.message);
                this.log.error({ quiet, err: error.message, key }, 'gagal memproses pesan');
            })
            .finally(() => {
                if (this.queues.get(key) === next) this.queues.delete(key);
            });

        this.queues.set(key, next);

        return next;
    }

    async handle(sessionKey, transport, jid, { texts, hasImage, hasAudio = false, attachments = [], quoted = null, selfTest = false, ids = [] }) {
        // The night may have ended while we were waiting.
        if (!selfTest && !this.isActive()) {
            if (ids.length) this.#abandonIncoming(sessionKey, jid, 'jam aktif berakhir sebelum pesan selesai diproses');
            return;
        }

        // Finish the previous turn before generating another reply.
        await this.flushPending(sessionKey, transport, jid).catch((error) => {
            // The new customer's text must still be processed and queued. The
            // previous turn's state was committed with its pending deliveries.
            this.log.info({ jid, err: error.message }, 'balasan sebelumnya masih dalam antrean');
        });

        const conversation = this.store.loadConversation(sessionKey, jid);

        if (conversation.step === 'handed_over') { completeIncoming(sessionKey, ids); return; }

        const joined = texts.join('\n');
        if (joined.length > 6000 && ids.length) {
            this.#abandonIncoming(sessionKey, jid, 'pesan terlalu panjang untuk diproses otomatis; perlu CS');
            return;
        }
        const text = joined.slice(0, 6000);

        // The WhatsApp Business Salam answered this new customer a moment ago (10 minutes at most).
        const key = `${sessionKey}|${jid}`;
        const salamAt = this.autoGreeted.get(key);
        this.autoGreeted.delete(key);
        const salamRecent = Boolean(salamAt && Date.now() - salamAt < 10 * 60 * 1000);
        const autoGreeted = conversation.step === 'new' && salamRecent;

        // AI chat mode (Pengaturan > Mode bot): the AI writes from the shop's data (chat.js).
        if (config.bot.mode === 'ai') {
            // A new (or started-over) conversation: the lines of the old one are not its context.
            const history = conversation.step === 'new' ? [] : this.store.recentHistory?.(sessionKey, jid, ids.length ? ids : texts.length, 12) ?? [];
            const turn = await withDeadline(
                () => this.chat(conversation, { text, hasImage, hasAudio, attachments, quoted, history, who: key, autoGreeted: salamRecent }, { media: this.media }),
                2 * config.ollama.timeoutMs + 15000, 'AI conversation turn',
            );
            const classified = { intent: turn.silent ? 'ai_diam' : 'ai', source: 'ai', selfTest };

            this.store.tagIncoming(sessionKey, jid, classified.intent);
            // CS may have replied while the AI was writing.
            if (this.store.loadConversation(sessionKey, jid).step === 'handed_over') { completeIncoming(sessionKey, ids); return; }
            if (ids.length && !incomingRows(sessionKey).some((row) => ids.includes(row.message_id))) return;

            return this.#deliver(sessionKey, transport, jid, conversation, text, classified, { ...turn, inboxIds: ids });
        }

        const classified = await this.classify({
            text,
            hasImage,
            hasAudio,
            attachments,
            quoted,
            // Who is asking: limits how often the AI is asked for one customer.
            who: `${sessionKey}|${jid}`,
            step: conversation.step,
            knownProduct: conversation.product,
            // The last few lines before this message, so the AI gets "yang tadi", "itu".
            history: this.store.recentHistory?.(sessionKey, jid, ids.length ? ids : texts.length) ?? [],
        });
        classified.selfTest = selfTest;

        // Team patterns show up by name in Statistik ("pola: Ukuran").
        this.store.tagIncoming(sessionKey, jid, classified.intent === 'custom' ? `pola: ${classified.pattern.name}` : classified.intent);

        // CS may have replied while the classifier was thinking.
        if (this.store.loadConversation(sessionKey, jid).step === 'handed_over') { completeIncoming(sessionKey, ids); return; }
        if (ids.length && !incomingRows(sessionKey).some((row) => ids.includes(row.message_id))) return;

        const turn = decide(autoGreeted ? { ...conversation, autoGreeted: true } : conversation, classified, this.media);

        return this.#deliver(sessionKey, transport, jid, conversation, text, classified, { ...turn, inboxIds: ids });
    }

    /** Sends a turn ({ actions, patch }, from the script or the AI) and stores where the conversation went. */
    async #deliver(sessionKey, transport, jid, conversation, text, classified, { actions, patch, inboxIds = [], retryable = false, retryAfterMs = 0, silent = '' }) {
        if (silent && !retryable && !actions.some((a) => a.type === 'handover')) {
            actions = [...actions, { type: 'handover', reason: 'AI tidak dapat menjawab: ' + String(silent).slice(0, 160) }];
        }
        this.log.info(
            { jid, step: conversation.step, intent: classified.intent, product: classified.product, via: classified.source, next: patch.step ?? conversation.step },
            'pesan dikenali',
        );

        // The Log page: what the bot made of this message and where the conversation went.
        const who = this.store.phoneOf(jid) ? `+${this.store.phoneOf(jid)}` : jid.split('@')[0];
        const label = classified.intent === 'custom' ? `pola ${classified.pattern?.name}` : classified.intent;
        recordActivity({
            source: 'bot',
            action: `Pesan dari ${who} dikenali sebagai ${label}${classified.product ? ` (${classified.product})` : ''}${classified.source && classified.source !== 'rules' ? ` lewat ${classified.source}` : ''}`,
            detail: `"${text.slice(0, 120)}" · ${conversation.step} → ${patch.step ?? conversation.step}`,
        });

        db.transaction(() => {
            this.#queueTurn(sessionKey, transport, jid, conversation, classified, actions, patch, who);
            if (retryable) deferIncoming(sessionKey, inboxIds, silent, retryAfterMs);
            else completeIncoming(sessionKey, inboxIds);
        })();
        await this.flushPending(sessionKey, transport, jid);
    }

    /** State and every outgoing bubble are committed together before sending. */
    #queueTurn(sessionKey, transport, jid, conversation, classified, actions, patch, who) {
        let handover = null;

        const outgoing = actions.flatMap((action) => {
            if (action.type !== 'media') return [action];

            // WhatsApp catalog links replace the pictures: the lead-in template
            // carries the first link, the rest follow one per bubble so each
            // shows as its own product card.
            const files = () => this.media.files(action.kind, action.product, action.variant).map((file) => ({ ...action, type: 'file', file }));
            const links = this.media.links?.(action.kind, action.product, action.variant) ?? [];

            if (!links.length) return files();

            const [first, ...rest] = links;
            // The shop-wide catalog sent for a product without its own is not
            // "katalog Jas Almamater": it is named as the shop's.
            const shopWide = action.kind === 'katalog' && action.product && first === this.media.link?.('katalog', null);
            const produk = action.product && !shopWide ? productName(action.product) : 'produk';

            // A catalog link replaces the pictures (WhatsApp shows the product cards).
            if (action.kind === 'katalog') {
                return [{ type: 'text', text: replies.catalogLink(first, produk) }, ...rest.map((link) => ({ type: 'text', text: link }))];
            }

            // Other slots (size chart, review, promo) may hold a link and pictures: the link first, then the pictures.
            const lead = action.kind === 'size-chart' ? replies.sizeChartLink(first, produk) : first;

            return [{ type: 'text', text: lead ?? first }, ...files()];
        });

        let sentCount = 0;
        let suppressed = 0;

        for (const action of outgoing) {
            if (action.type === 'handover') {
                handover = action.reason;
                continue;
            }

            const logText = action.type === 'text' ? action.text : `[file] ${path.basename(action.file)}`;

            // Anti-repeat: a bubble this customer already got twice in the last
            // 10 minutes is not sent again. Stops spam answers, and two bots
            // answering each other forever (a quick way to get a number banned).
            // "Belum paham, tanya ulang" may repeat on purpose; the miss count (Pengaturan) limits it.
            const clarifying = action.type === 'text' && replies.isClarify(action.text);
            if (!clarifying && this.store.recentlySent(sessionKey, jid, logText, REPEAT_WINDOW_MINUTES) >= REPEAT_LIMIT) {
                suppressed++;
                continue;
            }

            sentCount++;

            // Logged before sending: WhatsApp echoes our own message back, and
            // the echo must already be known as the bot's or it reads as CS.
            const id = transport.newMessageId();

            this.store.logMessage({
                sessionKey,
                jid,
                direction: 'out',
                waMessageId: id,
                text: logText,
                intent: classified.intent,
            });

            enqueueDelivery(sessionKey, jid, classified.selfTest ? { ...action, selfTest: true } : action, id, classified.intent, false);
        }

        // Everything was a repeat: the bot has nothing new to say, so a person should look.
        if (suppressed && !sentCount && !handover) {
            this.log.info({ jid }, 'pesan berulang, diserahkan ke CS');
            handover = 'pesan berulang';

            const notice = replies.handoverNotice();
            if (notice) {
                const id = transport.newMessageId();
                this.store.logMessage({ sessionKey, jid, direction: 'out', waMessageId: id, text: notice });
                enqueueDelivery(sessionKey, jid, { type: 'text', text: notice }, id, classified.intent);
            }
        }

        // A handover is stored by markHandover, which also stamps the time.
        const { step, ...rest } = patch;

        this.store.saveConversation(sessionKey, jid, handover ? rest : patch);

        // Where the customer got to, for the funnel in Statistik.
        if (!handover && step && step !== conversation.step) {
            this.store.logMessage({ sessionKey, jid, direction: 'step', text: step });
        }

        if (handover) {
            this.store.markHandover(sessionKey, jid, handover);
            recordActivity({ source: 'bot', action: `Diserahkan ke CS: ${who}`, detail: handover });
        }
    }

    /** Replayed on reconnect and periodically. Each chat has only one sender. */
    async flushPending(sessionKey, transport, onlyJid = null) {
        const jids = [...new Set(pendingDeliveries(sessionKey, onlyJid).map((row) => row.jid))];
        const results = await Promise.allSettled(jids.map((jid) => {
            const key = `${sessionKey}|${jid}`;
            if (this.deliveries.has(key)) return this.deliveries.get(key);
            const sending = this.#flushChat(sessionKey, transport, jid).finally(() => this.deliveries.delete(key));
            this.deliveries.set(key, sending);
            return sending;
        }));
        const failure = results.find((r) => r.status === 'rejected');
        if (failure) throw failure.reason;
    }

    async #flushChat(sessionKey, transport, jid) {
        while (true) {
            const row = pendingDeliveries(sessionKey, jid)[0];
            if (!row) return;
            // CS can take over while a previous bubble is awaiting the network.
            const conv = this.store.loadConversation(sessionKey, jid);
            if (!row.staff && ['CS membalas', 'diambil alih dari konsol'].includes(conv.handover_reason)) {
                cancelDeliveries(sessionKey, jid);
                return;
            }
            if (!row.staff && Date.now() - Date.parse(`${row.created_at.replace(' ', 'T')}Z`) > 15 * 60000) {
                cancelDeliveries(sessionKey, jid);
                this.store.markHandover(sessionKey, jid, 'balasan gagal terkirim lebih dari 15 menit');
                this.log.warn({ jid, messageId: row.id }, 'balasan tertunda terlalu lama; perlu ditindaklanjuti CS');
                return;
            }
            if (!row.staff && !this.isActive() && !row.action.selfTest) return;
            // Recheck the row: a reset / CS takeover may have removed it while sending.
            if (!pendingDeliveries(sessionKey, jid).some((r) => r.id === row.id)) continue;
            await transport.send(jid, row.action, row.id);
            completeDelivery(row.id);
        }
    }

    /** Internal message (the morning recap). Logged first, like every bot message. */
    async sendNotice(sessionKey, transport, jid, text, deliveryId = null) {
        const id = deliveryId ?? transport.newMessageId();

        db.transaction(() => {
            if (!this.store.isBotMessage(id)) {
                this.store.logMessage({ sessionKey, jid, direction: 'out', waMessageId: id, text, intent: 'rekap' });
                enqueueDelivery(sessionKey, jid, { type: 'text', text }, id, 'rekap', true);
            }
        })();
        await this.flushPending(sessionKey, transport, jid);
    }

    /** Answers every collected batch now instead of after the debounce; for shutdown and tests. */
    async drain() {
        for (const [key, buffer] of this.buffers) {
            clearTimeout(buffer.timer);
            this.buffers.delete(key);
            this.#enqueue(key, buffer.run);
        }

        await Promise.all(this.queues.values());
    }
}
