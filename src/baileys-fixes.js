/**
 * Fixes for Baileys 6.7.24 (pinned: 7.0 is still a release candidate),
 * applied to each socket from our code, so a client's `npm install` never
 * loses them (patching node_modules would; the installer skips scripts).
 *
 * Each fix is as narrow as possible and leaves Baileys' own handling (its
 * processing order, its receipts to the server) as it is.
 */

/**
 * WhatsApp sends "mex" notifications for more than channels: a linked-profiles
 * update (<update op_name="NotificationLinkedProfilesUpdatesSideSub">) has no
 * <mex> child. Baileys 6.7.24 routes every type="mex" notification to its
 * channel handler, which rejects it ("Invalid mex newsletter notification").
 *
 * Fix: before Baileys sees it, such a notification is given its own type.
 * Baileys has no handler for that type, so it does nothing with it except the
 * receipt (ack) to the server, which it always sends. Channel notifications
 * (with <mex>) are untouched.
 */
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

/**
 * Baileys 6.7.24 calls placeholderResendCache.del(response.stanzaId) for a
 * peer-data response from our own phone, and stanzaId can be empty; its
 * default cache (@cacheable/node-cache) throws on an empty key ("Cannot read
 * properties of null (reading 'toString')", "error in handling message").
 *
 * Fix: Baileys takes the cache from its config; this one has the same get /
 * set / del, keeps entries for an hour like the default, and treats an empty
 * key as "not there".
 */
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
            // Old entries go when the map grows, so it never keeps more than an hour's worth.
            if (entries.size > 1000) for (const [k, e] of entries) if (e.until <= clock()) entries.delete(k);

            return true;
        },
        del(key) {
            return valid(key) ? Number(entries.delete(String(key))) : 0;
        },
    };
}

/**
 * Baileys logs "stream errored out" (e.g. code 515, "restart required", sent by
 * WhatsApp right after connecting or pairing), "error in validating
 * connection" (the network dropped mid-handshake), and "dropping spoofed
 * self-only protocolMessage from non-self origin" (companion peer sync messages
 * addressed by LID before the self-LID was mapped) at warn/error level. The
 * connection drops are handled by session reconnects, and the bot never uses
 * companion peer sync history. So these go to the log file at info instead of
 * popping up on the console. Everything else Baileys warns about is passed on
 * unchanged.
 */
export const HANDLED_BY_SESSION = /^(stream errored out|error in validating connection|dropping spoofed self-only protocolMessage)/;

export function sessionHandledLog(log, infoLog = log) {
    const pass = (level) => (first, second, ...rest) => {
        const message = typeof first === 'string' ? first : second;
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
        child: (bindings, options) => sessionHandledLog(log.child(bindings, options), infoLog.child(bindings)),
    };
}
