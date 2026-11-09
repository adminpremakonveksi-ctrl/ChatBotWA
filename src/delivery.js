import { BufferJSON, proto } from 'baileys';

import { all, get, now, run } from './db.js';
import { conversationJid } from './lid.js';

const sameConversation = (jid, key) => !key?.remoteJid || Boolean(jid && conversationJid(jid) === conversationJid(key.remoteJid));

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

export function rememberRetryMessage(sessionKey, message) {
    if (!message?.key?.id || !message.message) return;
    const original = message.message.deviceSentMessage?.message ?? message.message;
    run(`INSERT OR IGNORE INTO wa_retry_messages (session_key, message_id, jid, message, created_at) VALUES (?, ?, ?, ?, ?)`,
        [sessionKey, message.key.id, message.key.remoteJid ?? '', JSON.stringify(original, BufferJSON.replacer), now()]);
}

export function preparedRetryMessage(sessionKey, key) {
    const row = get('SELECT jid, message FROM wa_retry_messages WHERE session_key = ? AND message_id = ?', [sessionKey, key?.id ?? '']);
    return row && sameConversation(row.jid, key) ? proto.Message.fromObject(JSON.parse(row.message, BufferJSON.reviver)) : undefined;
}

export function retryMessage(sessionKey, key) {
    const prepared = preparedRetryMessage(sessionKey, key);
    if (prepared) return prepared;
    const old = get(`SELECT jid, text FROM message_log WHERE session_key = ? AND wa_message_id = ? AND direction = 'out' LIMIT 1`, [sessionKey, key?.id ?? '']);
    return old?.text && sameConversation(old.jid, key) && !old.text.startsWith('[file]') ? proto.Message.fromObject({ conversation: old.text }) : undefined;
}

export function pruneRetryMessages() {
    run(`DELETE FROM wa_retry_messages WHERE created_at < datetime('now', '-7 days')
        AND NOT EXISTS (SELECT 1 FROM outgoing_queue q WHERE q.session_key = wa_retry_messages.session_key AND q.id = wa_retry_messages.message_id)`);
}
