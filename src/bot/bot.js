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
import { recordUnanswered } from './unanswered.js';
import { decide } from './engine.js';
import { productName } from './products.js';
import { replies } from './replies.js';
import { media as defaultMedia } from './media.js';
import { isBotActive } from './schedule.js';
import * as defaultStore from './store.js';

const REPEAT_LIMIT = 2;
const REPEAT_WINDOW_MINUTES = 10;

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
        this.autoGreeted = new Map();
        this.log = logger.child({ part: 'bot' });
    }

    onIncoming(sessionKey, transport, { jid, id, text = '', hasImage = false, hasAudio = false, attachment = null, quoted = null, selfTest = false }) {
        if (this.store.hasReceived?.(sessionKey, jid, id)) return;
        const eligible = (selfTest || this.isActive()) && (selfTest || !config.recap.to.includes(this.store.phoneOf(jid)));
        const reset = selfTest && /^\s*#?reset\s*$/i.test(text);
        db.transaction(() => {
            this.store.logMessage({ sessionKey, jid, direction: 'in', waMessageId: id, text: text || attachment?.note || '' });
            if (eligible && !reset) enqueueIncoming(sessionKey, jid, id, { text, hasImage, hasAudio, attachment, quoted, selfTest });
        })();

        if (!selfTest && !this.isActive()) {
            return;
        }

        if (!selfTest && config.recap.to.includes(this.store.phoneOf(jid))) {
            return;
        }

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
                if (!rows.length) return;
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

        if (isAutoMessage(text)) {
            this.store.logMessage({ sessionKey, jid, direction: 'auto', waMessageId: id, text });
            this.log.info({ jid }, 'pesan otomatis WhatsApp Business, bot tetap menangani');
            if (releaseAutoHandovers({ sessionKey, jid }).length) this.log.info({ jid }, 'dikembalikan ke bot: yang dikira CS ternyata pesan otomatis');

            if (this.store.loadConversation(sessionKey, jid).step === 'new') {
                this.autoGreeted.set(`${sessionKey}|${jid}`, Date.now());
            }

            return;
        }

        const conversation = this.store.loadConversation(sessionKey, jid);

        if (conversation.step !== 'handed_over') {
            this.log.info({ jid }, 'CS membalas dari HP, bot berhenti di nomor ini');
        }

        this.store.logMessage({ sessionKey, jid, direction: 'cs', waMessageId: id, text: text || null });

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
        if (!selfTest && !this.isActive()) {
            if (ids.length) this.#abandonIncoming(sessionKey, jid, 'jam aktif berakhir sebelum pesan selesai diproses');
            return;
        }

        await this.flushPending(sessionKey, transport, jid).catch((error) => {
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

        const key = `${sessionKey}|${jid}`;
        const salamAt = this.autoGreeted.get(key);
        this.autoGreeted.delete(key);
        const salamRecent = Boolean(salamAt && Date.now() - salamAt < 10 * 60 * 1000);
        const autoGreeted = conversation.step === 'new' && salamRecent;

        if (config.bot.mode === 'ai') {
            const history = conversation.step === 'new' ? [] : this.store.recentHistory?.(sessionKey, jid, ids.length ? ids : texts.length, 12) ?? [];
            const turn = await withDeadline(
                () => this.chat(conversation, { text, hasImage, hasAudio, attachments, quoted, history, who: key, autoGreeted: salamRecent }, { media: this.media }),
                2 * config.ollama.timeoutMs + 15000, 'AI conversation turn',
            );
            const classified = { intent: turn.silent ? 'ai_diam' : 'ai', source: 'ai', selfTest };

            this.store.tagIncoming(sessionKey, jid, classified.intent);
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
            who: `${sessionKey}|${jid}`,
            step: conversation.step,
            knownProduct: conversation.product,
            history: this.store.recentHistory?.(sessionKey, jid, ids.length ? ids : texts.length) ?? [],
        });
        classified.selfTest = selfTest;

        this.store.tagIncoming(sessionKey, jid, classified.intent === 'custom' ? `pola: ${classified.pattern.name}` : classified.intent);

        if (this.store.loadConversation(sessionKey, jid).step === 'handed_over') { completeIncoming(sessionKey, ids); return; }
        if (ids.length && !incomingRows(sessionKey).some((row) => ids.includes(row.message_id))) return;

        const turn = decide(autoGreeted ? { ...conversation, autoGreeted: true } : conversation, classified, this.media);

        return this.#deliver(sessionKey, transport, jid, conversation, text, classified, { ...turn, inboxIds: ids });
    }

    async #deliver(sessionKey, transport, jid, conversation, text, classified, { actions, patch, inboxIds = [], retryable = false, retryAfterMs = 0, silent = '', unanswered = null }) {
        if (silent && !retryable && !actions.some((a) => a.type === 'handover')) {
            actions = [...actions, { type: 'handover', reason: 'AI tidak dapat menjawab: ' + String(silent).slice(0, 160) }];
        }
        this.log.info(
            { jid, step: conversation.step, intent: classified.intent, product: classified.product, via: classified.source, next: patch.step ?? conversation.step },
            'pesan dikenali',
        );

        const who = this.store.phoneOf(jid) ? `+${this.store.phoneOf(jid)}` : jid.split('@')[0];
        const label = classified.intent === 'custom' ? `pola ${classified.pattern?.name}` : classified.intent;
        recordActivity({
            source: 'bot',
            action: `Pesan dari ${who} dikenali sebagai ${label}${classified.product ? ` (${classified.product})` : ''}${classified.source && classified.source !== 'rules' ? ` lewat ${classified.source}` : ''}`,
            detail: `"${text.slice(0, 120)}" · ${conversation.step} → ${patch.step ?? conversation.step}`,
        });

        db.transaction(() => {
            this.#queueTurn(sessionKey, transport, jid, conversation, classified, actions, patch, who);
            if (unanswered && !classified.selfTest && !retryable) recordUnanswered(unanswered);
            if (retryable) deferIncoming(sessionKey, inboxIds, silent, retryAfterMs);
            else completeIncoming(sessionKey, inboxIds);
        })();
        await this.flushPending(sessionKey, transport, jid);
    }

    #queueTurn(sessionKey, transport, jid, conversation, classified, actions, patch, who) {
        let handover = null;

        const outgoing = actions.flatMap((action) => {
            if (action.type !== 'media') return [action];

            const files = () => this.media.files(action.kind, action.product, action.variant).map((file) => ({ ...action, type: 'file', file }));
            const links = this.media.links?.(action.kind, action.product, action.variant) ?? [];

            if (!links.length) return files();

            const [first, ...rest] = links;
            const shopWide = action.kind === 'katalog' && action.product && first === this.media.link?.('katalog', null);
            const produk = action.product && !shopWide ? productName(action.product) : 'produk';

            if (action.kind === 'katalog') {
                return [{ type: 'text', text: replies.catalogLink(first, produk) }, ...rest.map((link) => ({ type: 'text', text: link }))];
            }

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

            const clarifying = action.type === 'text' && replies.isClarify(action.text);
            if (!clarifying && this.store.recentlySent(sessionKey, jid, logText, REPEAT_WINDOW_MINUTES) >= REPEAT_LIMIT) {
                suppressed++;
                continue;
            }

            sentCount++;

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

        const { step, ...rest } = patch;

        this.store.saveConversation(sessionKey, jid, handover ? rest : patch);

        if (!handover && step && step !== conversation.step) {
            this.store.logMessage({ sessionKey, jid, direction: 'step', text: step });
        }

        if (handover) {
            this.store.markHandover(sessionKey, jid, handover);
            recordActivity({ source: 'bot', action: `Diserahkan ke CS: ${who}`, detail: handover });
        }
    }

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
            if (!pendingDeliveries(sessionKey, jid).some((r) => r.id === row.id)) continue;
            await transport.send(jid, row.action, row.id, () => pendingDeliveries(sessionKey, jid).some((pending) => pending.id === row.id));
            completeDelivery(row.id);
        }
    }

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

    async drain() {
        for (const [key, buffer] of this.buffers) {
            clearTimeout(buffer.timer);
            this.buffers.delete(key);
            this.#enqueue(key, buffer.run);
        }

        await Promise.all(this.queues.values());
    }
}
