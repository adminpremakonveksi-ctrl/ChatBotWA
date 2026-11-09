import { jidDecode, jidEncode } from 'baileys';
import { withDeadline } from './deadline.js';

const installed = new WeakSet();

export function ownDeviceRetry(node, user) {
    if (node?.tag !== 'receipt' || node.attrs?.type !== 'retry' || typeof node.attrs.id !== 'string' || !node.attrs.id || node.attrs.id.length > 200 || !node.attrs.recipient) return null;
    const own = jidDecode(user?.id);
    const ownLid = jidDecode(user?.lid);
    const from = jidDecode(node.attrs.from);
    const sender = jidDecode(node.attrs.participant || node.attrs.from);
    const destination = jidDecode(node.attrs.recipient);
    if (own?.server !== 's.whatsapp.net' || ownLid?.server !== 'lid' || from?.server !== 'lid' || from.user !== ownLid.user || sender?.server !== 'lid' || sender.user !== ownLid.user) return null;
    if (!['lid', 's.whatsapp.net'].includes(destination?.server)) return null;
    const retry = node.content?.find?.((child) => child.tag === 'retry');
    const count = Number(retry?.attrs?.count);
    if (!Number.isInteger(count) || count < 0 || !Number.isSafeInteger(sender.device ?? 0) || (sender.device ?? 0) < 0) return null;
    const list = node.content?.find?.((child) => child.tag === 'list');
    const ids = [...new Set([node.attrs.id, ...(list?.content?.filter?.((child) => child.tag === 'item').map((child) => child.attrs?.id) ?? [])].filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 200))].slice(0, 32);
    const participant = jidEncode(own.user, 's.whatsapp.net', sender.device);
    const sessionJid = destination.server === 'lid' ? jidEncode(ownLid.user, 'lid', sender.device) : participant;
    return { node, ids, count, participant, sessionJid };
}

export function fixOwnDeviceRetries(socket, { getMessage, retry, cache, log, isCurrent }) {
    const ws = socket?.ws;
    if (!ws?.emit || !socket.assertSessions || !socket.relayMessage || !socket.sendNode || installed.has(ws)) return false;
    installed.add(ws);
    const emit = ws.emit;
    const inFlight = new Map();
    const queues = new Map();

    const acknowledge = async ({ node }) => {
        if (!isCurrent()) return;
        const { attrs } = node;
        const ack = { id: attrs.id, to: attrs.from, class: 'receipt', type: 'retry', recipient: attrs.recipient };
        if (attrs.participant) ack.participant = attrs.participant;
        await withDeadline(() => socket.sendNode({ tag: 'ack', attrs: ack }), 2500, 'own-device retry acknowledgement');
    };

    const recover = async (request) => {
        try {
            if (!isCurrent()) return;
            const { ids, participant, node, count } = request;
            const available = [];
            for (const id of ids) {
                const budget = `${id}:${participant}`;
                const attempts = cache.get(budget) ?? 0;
                if (attempts >= 5 || count > 5) continue;
                cache.set(budget, attempts + 1);
                const key = { id, remoteJid: node.attrs.recipient, fromMe: true, participant: node.attrs.participant || node.attrs.from };
                const message = await getMessage(key);
                if (message) available.push({ key, message });
            }
            if (!available.length || !isCurrent()) return;
            await withDeadline(() => socket.assertSessions([request.sessionJid], true), 20000, 'own-device retry session');
            for (const { key, message } of available) {
                if (!isCurrent()) return;
                await withDeadline(() => retry(key, participant, count, message), 20000, 'own-device message retry');
            }
            log.info({ device: participant, messages: available.length }, 'salinan pesan dikirim ulang ke perangkat toko');
        } finally {
            await acknowledge(request);
        }
    };

    ws.emit = function (event, node, ...args) {
        const request = event === 'CB:receipt' ? ownDeviceRetry(node, socket.user) : null;
        if (!request) return emit.call(this, event, node, ...args);
        const identity = `${request.participant}|${node.attrs.recipient}|${request.ids.join(',')}`;
        if (inFlight.has(identity)) return true;
        const previous = queues.get(request.participant) ?? Promise.resolve();
        const work = previous.then(() => inFlight.size > 100 ? acknowledge(request) : recover(request))
            .catch((error) => log.warn({ quiet: true, err: error.message, messageId: node.attrs.id }, 'pemulihan salinan pesan perangkat toko tertunda'))
            .finally(() => {
                inFlight.delete(identity);
                if (queues.get(request.participant) === work) queues.delete(request.participant);
            });
        inFlight.set(identity, work);
        queues.set(request.participant, work);
        return true;
    };
    return true;
}
