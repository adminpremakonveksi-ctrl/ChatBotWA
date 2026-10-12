import { BufferJSON, initAuthCreds, proto } from 'baileys';

import { all, get, now, run } from './db.js';

/**
 * A Baileys auth store backed by the bot's local SQLite database.
 *
 * Drop-in replacement for useMultiFileAuthState. Credentials survive restarts,
 * redeploys and a fresh checkout, which is what keeps a paired number paired
 * instead of falling back to a QR scan every time.
 */
export async function useSqliteAuthState(sessionId) {
    const existing = get('SELECT creds FROM wa_auth_creds WHERE wa_session_id = ? LIMIT 1', [sessionId]);
    const isNew = !existing;

    const creds = isNew ? initAuthCreds() : JSON.parse(existing.creds, BufferJSON.reviver);

    const saveCreds = async () => {
        run(
            `INSERT INTO wa_auth_creds (wa_session_id, creds, created_at, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(wa_session_id) DO UPDATE SET creds = excluded.creds, updated_at = excluded.updated_at`,
            [sessionId, JSON.stringify(creds, BufferJSON.replacer), now(), now()],
        );
    };

    // Persist the freshly generated identity straight away. Baileys only emits
    // creds.update later, and a restart before that would otherwise hand out a
    // different registration id and invalidate the QR already on screen.
    if (isNew) {
        await saveCreds();
    }

    const keys = {
        async get(type, ids) {
            const found = {};

            if (!ids.length) {
                return found;
            }

            const placeholders = ids.map(() => '?').join(', ');

            const rows = all(
                `SELECT key_id, value FROM wa_auth_keys
                 WHERE wa_session_id = ? AND category = ? AND key_id IN (${placeholders})`,
                [sessionId, type, ...ids],
            );

            for (const row of rows) {
                let value = JSON.parse(row.value, BufferJSON.reviver);

                // App state sync keys must be handed back as protobuf objects.
                if (type === 'app-state-sync-key' && value) {
                    value = proto.Message.AppStateSyncKeyData.fromObject(value);
                }

                found[row.key_id] = value;
            }

            return found;
        },

        async set(data) {
            const stamp = now();

            for (const category of Object.keys(data)) {
                for (const id of Object.keys(data[category])) {
                    const value = data[category][id];

                    if (value) {
                        run(
                            `INSERT INTO wa_auth_keys (wa_session_id, category, key_id, value, created_at, updated_at)
                             VALUES (?, ?, ?, ?, ?, ?)
                             ON CONFLICT(wa_session_id, category, key_id)
                             DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
                            [sessionId, category, id, JSON.stringify(value, BufferJSON.replacer), stamp, stamp],
                        );
                    } else {
                        run(
                            'DELETE FROM wa_auth_keys WHERE wa_session_id = ? AND category = ? AND key_id = ?',
                            [sessionId, category, id],
                        );
                    }
                }
            }
        },
    };

    /** Wipes the pairing for this session so the next connect shows a QR. */
    const clear = async () => {
        run('DELETE FROM wa_auth_keys WHERE wa_session_id = ?', [sessionId]);
        run('DELETE FROM wa_auth_creds WHERE wa_session_id = ?', [sessionId]);
    };

    return { state: { creds, keys }, saveCreds, clear };
}
