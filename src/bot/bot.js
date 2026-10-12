import path from 'node:path';

import { config } from '../config.js';
import { logger } from '../logger.js';
import { classify as defaultClassify } from './classify.js';
import { decide } from './engine.js';
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
    onIncoming(sessionKey, transport, { jid, id, text = '', hasImage = false }) {
        this.store.logMessage({ sessionKey, jid, direction: 'in', waMessageId: id, text });

        if (!this.isActive()) {
            return;
        }

        // The recap recipients are staff; never greet them as customers.
        if (config.recap.to.includes(this.store.phoneOf(jid))) {
            return;
        }

        const key = `${sessionKey}|${jid}`;
        const buffer = this.buffers.get(key) ?? { texts: [], hasImage: false, timer: null };

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

    async handle(sessionKey, transport, jid, { texts, hasImage }) {
        // The night may have ended while we were waiting.
        if (!this.isActive()) return;

        const conversation = this.store.loadConversation(sessionKey, jid);

        if (conversation.step === 'handed_over') return;

        const text = texts.join('\n');
        const classified = await this.classify({
            text,
            hasImage,
            step: conversation.step,
            knownProduct: conversation.product,
        });

        this.store.tagIncoming(sessionKey, jid, classified.intent);

        // CS may have replied while the classifier was thinking.
        if (this.store.loadConversation(sessionKey, jid).step === 'handed_over') return;

        const { actions, patch } = decide(conversation, classified, this.media);

        this.log.info(
            { jid, step: conversation.step, intent: classified.intent, product: classified.product, via: classified.source, next: patch.step ?? conversation.step },
            'pesan dikenali',
        );

        let handover = null;

        const outgoing = actions.flatMap((action) =>
            action.type === 'media'
                ? this.media.files(action.kind, action.product, action.variant).map((file) => ({ ...action, type: 'file', file }))
                : [action],
        );

        for (const action of outgoing) {
            if (action.type === 'handover') {
                handover = action.reason;
                continue;
            }

            // Logged before sending: WhatsApp echoes our own message back, and
            // the echo must already be known as the bot's or it reads as CS.
            const id = transport.newMessageId();

            this.store.logMessage({
                sessionKey,
                jid,
                direction: 'out',
                waMessageId: id,
                text: action.type === 'text' ? action.text : `[file] ${path.basename(action.file)}`,
                intent: classified.intent,
            });

            await transport.send(jid, action, id);
        }

        // A handover is stored by markHandover, which also stamps the time.
        const { step, ...rest } = patch;

        this.store.saveConversation(sessionKey, jid, handover ? rest : patch);

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
