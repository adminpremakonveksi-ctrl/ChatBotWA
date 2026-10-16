import path from 'node:path';

import { config } from '../config.js';
import { logger } from '../logger.js';
import { classify as defaultClassify } from './classify.js';
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
        media = defaultMedia,
        store = defaultStore,
        isActive = () => isBotActive(),
        debounceMs = config.bot.debounceMs,
    } = {}) {
        this.classify = classify;
        this.media = media;
        this.store = store;
        this.isActive = isActive;
        this.debounceMs = debounceMs;

        this.buffers = new Map();
        this.queues = new Map();
        this.log = logger.child({ part: 'bot' });
    }

    /**
     * @param transport  { newMessageId() -> string, send(jid, action, messageId) -> Promise }
     *                   action is { type: 'text', text } or { type: 'file', file }
     */
    onIncoming(sessionKey, transport, { jid, id, text = '', hasImage = false, selfTest = false }) {
        this.store.logMessage({ sessionKey, jid, direction: 'in', waMessageId: id, text });

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
        const buffer = this.buffers.get(key) ?? { texts: [], hasImage: false, timer: null, selfTest };

        if (text) buffer.texts.push(text);
        buffer.hasImage ||= hasImage;

        buffer.run = () => this.handle(sessionKey, transport, jid, buffer);

        clearTimeout(buffer.timer);
        buffer.timer = setTimeout(() => {
            this.buffers.delete(key);
            this.#enqueue(key, buffer.run);
        }, this.debounceMs);

        this.buffers.set(key, buffer);
    }

    /**
     * A message from our own number. If the bot did not send it, CS replied
     * from the phone: hand the customer over so the two do not talk at once.
     */
    isBotMessage(id) {
        return Boolean(id) && this.store.isBotMessage(id);
    }

    /** A staff-facing line (not a customer reply), logged first so its echo is known. */
    async #sendNote(sessionKey, transport, jid, text) {
        const id = transport.newMessageId();
        this.store.logMessage({ sessionKey, jid, direction: 'out', waMessageId: id, text });
        await transport.send(jid, { type: 'text', text }, id);
    }

    onOwnMessage(sessionKey, { jid, id }) {
        if (!id || this.store.isBotMessage(id)) {
            return;
        }

        const conversation = this.store.loadConversation(sessionKey, jid);

        if (conversation.step !== 'handed_over') {
            this.log.info({ jid }, 'CS membalas dari HP, bot berhenti di nomor ini');
        }

        // Refresh even when already handed over, so the silence lasts from CS's last reply.
        this.store.markHandover(sessionKey, jid, 'CS membalas');

        const key = `${sessionKey}|${jid}`;
        clearTimeout(this.buffers.get(key)?.timer);
        this.buffers.delete(key);
    }

    #enqueue(key, task) {
        const previous = this.queues.get(key) ?? Promise.resolve();
        const next = previous
            .then(task)
            .catch((error) => this.log.error({ err: error.message, key }, 'gagal memproses pesan'))
            .finally(() => {
                if (this.queues.get(key) === next) this.queues.delete(key);
            });

        this.queues.set(key, next);

        return next;
    }

    async handle(sessionKey, transport, jid, { texts, hasImage, selfTest = false }) {
        // The night may have ended while we were waiting.
        if (!selfTest && !this.isActive()) return;

        const conversation = this.store.loadConversation(sessionKey, jid);

        if (conversation.step === 'handed_over') return;

        const text = texts.join('\n');
        const classified = await this.classify({
            text,
            hasImage,
            step: conversation.step,
            knownProduct: conversation.product,
        });

        // Team patterns show up by name in Statistik ("pola: Ukuran").
        this.store.tagIncoming(sessionKey, jid, classified.intent === 'custom' ? `pola: ${classified.pattern.name}` : classified.intent);

        // CS may have replied while the classifier was thinking.
        if (this.store.loadConversation(sessionKey, jid).step === 'handed_over') return;

        const { actions, patch } = decide(conversation, classified, this.media);

        this.log.info(
            { jid, step: conversation.step, intent: classified.intent, product: classified.product, via: classified.source, next: patch.step ?? conversation.step },
            'pesan dikenali',
        );

        let handover = null;

        const outgoing = actions.flatMap((action) => {
            if (action.type !== 'media') return [action];

            // WhatsApp catalog links replace the pictures: the lead-in template
            // carries the first link, the rest follow one per bubble so each
            // shows as its own product card.
            const links = this.media.links?.(action.kind, action.product) ?? [];
            if (links.length) {
                const [first, ...rest] = links;

                return [
                    { type: 'text', text: replies.catalogLink(first, action.product ? productName(action.product) : 'produk') },
                    ...rest.map((link) => ({ type: 'text', text: link })),
                ];
            }

            return this.media.files(action.kind, action.product, action.variant).map((file) => ({ ...action, type: 'file', file }));
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
            if (this.store.recentlySent(sessionKey, jid, logText, REPEAT_WINDOW_MINUTES) >= REPEAT_LIMIT) {
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

            await transport.send(jid, action, id);
        }

        // Everything was a repeat: the bot has nothing new to say, so a person should look.
        if (suppressed && !sentCount && !handover) {
            this.log.info({ jid }, 'pesan berulang, diserahkan ke CS');
            handover = 'pesan berulang';
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
        }
    }

    /** Internal message (the morning recap). Logged first, like every bot message. */
    async sendNotice(sessionKey, transport, jid, text) {
        const id = transport.newMessageId();

        this.store.logMessage({ sessionKey, jid, direction: 'out', waMessageId: id, text, intent: 'rekap' });
        await transport.send(jid, { type: 'text', text }, id);
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
