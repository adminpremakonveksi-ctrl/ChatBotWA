import { AsyncLocalStorage } from 'node:async_hooks';
import { preparedRetryMessage, rememberRetryMessage } from './delivery.js';

export class OutgoingMessages {
    constructor(sessionKey) {
        this.sessionKey = sessionKey;
        this.context = new AsyncLocalStorage();
    }

    prepare(message) {
        const sending = this.context.getStore();
        if (!sending) return message;
        if (!sending.canSend()) {
            throw Object.assign(new Error('Pesan dibatalkan sebelum enkripsi'), { code: 'DELIVERY_CANCELLED' });
        }
        if (!sending.prepared) {
            const original = message.deviceSentMessage?.message ?? message;
            rememberRetryMessage(this.sessionKey, { key: sending.key, message: original });
            sending.prepared = true;
        }
        return message;
    }

    async retryOwnDevice(socket, key, participant, count, message, isCurrent) {
        const canSend = () => {
            if (!isCurrent()) throw new Error('Connection Closed');
            return true;
        };
        return this.context.run({ key, canSend, prepared: true }, async () => {
            canSend();
            await socket.relayMessage(key.remoteJid, message, {
                messageId: key.id,
                participant: { jid: participant, count },
                additionalAttributes: { recipient: key.remoteJid },
            });
        });
    }

    async send(socket, jid, content, messageId, canSend) {
        const key = { id: messageId, remoteJid: jid, fromMe: true };
        const prepared = preparedRetryMessage(this.sessionKey, key);
        return this.context.run({ key, canSend, prepared: Boolean(prepared) }, async () => {
            if (!canSend()) return;
            try {
                if (prepared && typeof socket.relayMessage === 'function') {
                    await socket.relayMessage(jid, prepared, { messageId, useUserDevicesCache: false });
                    return { key, message: prepared };
                }
                return await socket.sendMessage(jid, content, { messageId });
            } catch (error) {
                if (error.code !== 'DELIVERY_CANCELLED') throw error;
            }
        });
    }
}
