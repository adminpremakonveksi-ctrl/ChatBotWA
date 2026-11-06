
export const NON_CHANNEL_MEX = 'mex-update';

export const isNonChannelMex = (node) =>
    node?.attrs?.type === 'mex' && !(Array.isArray(node.content) && node.content.some((child) => child?.tag === 'mex'));

export function fixMexNotifications(socket) {
    const ws = socket?.ws;
    if (typeof ws?.prependListener !== 'function') return false;

    ws.prependListener('CB:notification', (node) => {
        if (isNonChannelMex(node)) node.attrs.type = NON_CHANNEL_MEX;
    });

    return true;
}

export function makePlaceholderCache(ttlMs = 60 * 60 * 1000, clock = () => Date.now()) {
    const entries = new Map();
    const valid = (key) => key !== null && key !== undefined && key !== '';

    return {
        get(key) {
            if (!valid(key)) return undefined;
            const entry = entries.get(String(key));
            if (!entry) return undefined;
            if (entry.until <= clock()) {
                entries.delete(String(key));

                return undefined;
            }

            return entry.value;
        },
        set(key, value) {
            if (!valid(key)) return false;
            entries.set(String(key), { value, until: clock() + ttlMs });
            if (entries.size > 1000) for (const [k, e] of entries) if (e.until <= clock()) entries.delete(k);
            while (entries.size > 1000) entries.delete(entries.keys().next().value);

            return true;
        },
        del(key) {
            return valid(key) ? Number(entries.delete(String(key))) : 0;
        },
    };
}

export const HANDLED_BY_SESSION = /^(stream errored out|error in validating connection|dropping spoofed self-only protocolMessage)/;

export function sessionHandledLog(log, infoLog = log, recover = () => {}, healMessage = () => false) {
    const pass = (level) => (first, second, ...rest) => {
        const message = typeof first === 'string' ? first : second;
        if (message === 'failed to decrypt message' && healMessage(first)) {
            return log[level]({ ...first, quiet: true, recovery: 'automatic' }, second, ...rest);
        }
        const detail = first?.err?.message ?? first?.err ?? first?.trace ?? '';
        if (message === 'error in sending keep alive' || (/unexpected error in 'processing message'/.test(String(message)) && /connection closed|timed? ?out/i.test(String(detail)))) {
            if (recover() === true) return log[level]({ ...first, quiet: true, recovery: 'reconnect' }, second, ...rest);
        }
        if (HANDLED_BY_SESSION.test(String(message ?? ''))) return infoLog.info(first, second, ...rest);

        return log[level](first, second, ...rest);
    };

    return {
        get level() { return log.level; },
        set level(value) { log.level = value; },
        trace: (...args) => log.trace(...args),
        debug: (...args) => log.debug(...args),
        info: (...args) => log.info(...args),
        warn: pass('warn'),
        error: pass('error'),
        fatal: (...args) => log.fatal(...args),
        child: (bindings, options) => sessionHandledLog(log.child(bindings, options), infoLog.child(bindings), recover, healMessage),
    };
}
