import { BufferJSON, proto } from 'baileys';

import { all, get, now, run } from './db.js';

// A durable outbox: IDs are allocated and logged before any network operation.
// A retry uses the same ID, including after restarting the PC.
export function enqueueDelivery(sessionKey, jid, action, id, intent, staff = false) {
    run(`INSERT OR IGNORE INTO outgoing_queue (id, session_key, jid, action, intent, staff, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, sessionKey, jid, JSON.stringify(action), intent ?? null, Number(staff), now()]);
}

export const pendingDeliveries = (sessionKey, jid = null) => all(
    `SELECT rowid AS sequence, * FROM outgoing_queue WHERE session_key = ? ${jid ? 'AND jid = ?' : ''} ORDER BY rowid`,
    jid ? [sessionKey, jid] : [sessionKey],
).map((row) => ({ ...row, action: JSON.parse(row.action) }));

export const completeDelivery = (id) => run('DELETE FROM outgoing_queue WHERE id = ?', [id]);
export const cancelDeliveries = (sessionKey, jid) => run('DELETE FROM outgoing_queue WHERE session_key = ? AND jid = ? AND staff = 0', [sessionKey, jid]);

// Keep the actual protobuf, not just its text. WhatsApp needs media keys and
// hashes as well to recover a photo shown as "Waiting for this message".
export function rememberRetryMessage(sessionKey, message) {
    if (!message?.key?.id || !message.message) return;
    run(`INSERT OR REPLACE INTO wa_retry_messages (session_key, message_id, jid, message, created_at) VALUES (?, ?, ?, ?, ?)`,
        [sessionKey, message.key.id, message.key.remoteJid ?? '', JSON.stringify(message.message, BufferJSON.replacer), now()]);
}

export function retryMessage(sessionKey, key) {
    const row = get('SELECT message FROM wa_retry_messages WHERE session_key = ? AND message_id = ?', [sessionKey, key?.id ?? '']);
    if (row) return proto.Message.fromObject(JSON.parse(row.message, BufferJSON.reviver));
    // Texts sent by an older release (including the morning recap) can still
    // be recovered. A file's display label is never used as message content.
    const old = get(`SELECT text FROM message_log WHERE session_key = ? AND wa_message_id = ? AND direction = 'out' LIMIT 1`, [sessionKey, key?.id ?? '']);
    return old?.text && !old.text.startsWith('[file]') ? proto.Message.fromObject({ conversation: old.text }) : undefined;
}

export function pruneRetryMessages() {
    run(`DELETE FROM wa_retry_messages WHERE created_at < datetime('now', '-7 days')`);
}
