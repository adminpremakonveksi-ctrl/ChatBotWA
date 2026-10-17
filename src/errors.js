/**
 * Recent errors and warnings, raw, for the console's error pop-up: the client
 * photographs it and the developer reads exactly what failed. Filled by the
 * logger (every warn/error line) and by the HTTP error handler.
 *
 * In memory only (the full history is in logs/bot.log). No imports, so the
 * logger can use it without a cycle.
 */

const MAX = 100;
const feed = [];
let lastId = 0;

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** Plain-JSON copy of whatever was logged, Error objects included (message + stack). */
function plain(value, depth = 0) {
    if (value instanceof Error) return { name: value.name, message: value.message, code: value.code, stack: value.stack };
    if (!value || typeof value !== 'object' || depth > 3) return value;
    if (Array.isArray(value)) return value.slice(0, 20).map((v) => plain(v, depth + 1));

    return Object.fromEntries(Object.entries(value).slice(0, 30).map(([k, v]) => [k, plain(v, depth + 1)]));
}

export function recordError({ level = 'error', source = 'bot', message, detail = {} }) {
    feed.push({ id: ++lastId, time: stamp(), level, source, message: String(message ?? '').slice(0, 1000), detail: plain(detail) });
    if (feed.length > MAX) feed.shift();
}

/** Entries after a given id (the console keeps the last one it showed). */
export const errorsSince = (id = 0) => feed.filter((e) => e.id > Number(id || 0));

export const latestErrorId = () => lastId;
