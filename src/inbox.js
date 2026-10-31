import { all, now, run } from './db.js';

export const enqueueIncoming = (sessionKey, jid, id, payload) => {
    if (!id) return;
    run('INSERT OR IGNORE INTO incoming_queue (session_key, message_id, jid, payload, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [sessionKey, id, jid, JSON.stringify(payload), now(), now()]);
};
export const incomingRows = (sessionKey) => all('SELECT rowid AS sequence, * FROM incoming_queue WHERE session_key = ? ORDER BY rowid', [sessionKey])
    .map((r) => {
        try {
            const payload = JSON.parse(r.payload);
            if (!payload || typeof payload !== 'object') throw new Error('invalid payload');
            return { ...r, payload };
        } catch { return { ...r, payload: {}, corrupt: true }; }
    });
export const completeIncoming = (sessionKey, ids = []) => {
    for (const id of ids) run('DELETE FROM incoming_queue WHERE session_key = ? AND message_id = ?', [sessionKey, id]);
};
export const cancelIncoming = (sessionKey, jid) => run('DELETE FROM incoming_queue WHERE session_key = ? AND jid = ?', [sessionKey, jid]);
export const inboxExpired = (row, at = Date.now()) => at - Date.parse(row.created_at.replace(' ', 'T') + 'Z') >= 15 * 60000 || row.attempts >= 5;
export const beginIncoming = (sessionKey, ids) => {
    // Count before work starts, so repeated hard crashes cannot replay a
    // poison input forever without ever reaching the retry limit.
    for (const id of ids) run('UPDATE incoming_queue SET attempts = attempts + 1 WHERE session_key = ? AND message_id = ?', [sessionKey, id]);
};
export function deferIncoming(sessionKey, ids, error, retryAfterMs = 0) {
    const rows = incomingRows(sessionKey).filter((row) => ids.includes(row.message_id));
    const delay = Math.max(retryAfterMs, Math.min(180000, 15000 * 2 ** Math.min(Math.max(0, (rows[0]?.attempts ?? 1) - 1), 4)));
    const next = new Date(Date.now() + delay).toISOString().slice(0, 19).replace('T', ' ');
    for (const row of rows) {
        run('UPDATE incoming_queue SET next_attempt_at = ?, last_error = ? WHERE session_key = ? AND message_id = ?',
            [next, String(error ?? 'proses tertunda').slice(0, 500), sessionKey, row.message_id]);
    }
}
