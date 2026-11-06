import { createHash } from 'node:crypto';
import { all, db, get, now, run } from './db.js';


export const userOf = (jid) => String(jid ?? '').split('@')[0].split(':')[0];
const serverOf = (jid) => String(jid ?? '').split('@')[1] ?? '';
const deviceOf = (jid) => {
    const head = String(jid ?? '').split('@')[0];

    return head.includes(':') ? head.split(':')[1] : null;
};

export const isLid = (jid) => serverOf(jid) === 'lid';
export const isPn = (jid) => serverOf(jid) === 's.whatsapp.net';

const own = { lid: null, pn: null };

export function setOwnIdentity({ lid, id } = {}) {
    if (!isLid(lid) || !isPn(id)) return;

    own.lid = userOf(lid);
    own.pn = userOf(id);
    store(own.lid, own.pn);
}

function store(lid, pn) {
    const known = get('SELECT pn FROM lid_map WHERE lid = ?', [lid]);
    if (known?.pn === pn) return false;

    db.transaction(() => {
        run(
            `INSERT INTO lid_map (lid, pn, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(lid) DO UPDATE SET pn = excluded.pn, updated_at = excluded.updated_at`,
            [lid, pn, now()],
        );
        mergeConversations(lid, pn);
    })();

    return true;
}

export function rememberLid(lid, pn) {
    if (!isLid(lid) || !isPn(pn) || !userOf(lid) || !userOf(pn)) return false;

    const l = userOf(lid);
    const p = userOf(pn);

    if (own.lid && (l === own.lid) !== (p === own.pn)) return false;

    return store(l, p);
}

function mergeConversations(lid, pn) {
    const lidJid = `${lid}@lid`;
    const pnJid = `${pn}@s.whatsapp.net`;

    for (const row of all('SELECT * FROM conversations WHERE jid = ?', [lidJid])) {
        const other = get('SELECT last_message_at FROM conversations WHERE session_key = ? AND jid = ?', [row.session_key, pnJid]);

        if (other && String(other.last_message_at ?? '') >= String(row.last_message_at ?? '')) {
            run('DELETE FROM conversations WHERE session_key = ? AND jid = ?', [row.session_key, lidJid]);
        } else {
            run('DELETE FROM conversations WHERE session_key = ? AND jid = ?', [row.session_key, pnJid]);
            run('UPDATE conversations SET jid = ? WHERE session_key = ? AND jid = ?', [pnJid, row.session_key, lidJid]);
        }
    }

    run('UPDATE message_log SET jid = ? WHERE jid = ?', [pnJid, lidJid]);
    run('UPDATE outgoing_queue SET jid = ? WHERE jid = ?', [pnJid, lidJid]);
    run('UPDATE incoming_queue SET jid = ? WHERE jid = ?', [pnJid, lidJid]);
}

export function pnOfLid(jid) {
    if (!isLid(jid)) return null;
    if (own.lid && userOf(jid) === own.lid) return own.pn;

    return get('SELECT pn FROM lid_map WHERE lid = ?', [userOf(jid)])?.pn ?? null;
}

export function pnJidOf(jid) {
    const pn = pnOfLid(jid);
    if (!pn) return null;

    const device = deviceOf(jid);

    return `${pn}${device ? `:${device}` : ''}@s.whatsapp.net`;
}

export function conversationJid(jid) {
    const pn = pnOfLid(jid);

    return pn ? `${pn}@s.whatsapp.net` : jid;
}

export function learnFromKey(key = {}) {
    if (key.fromMe) return;

    if (key.senderLid && key.senderPn) rememberLid(key.senderLid, key.senderPn);
    if (key.participantLid && key.participantPn) rememberLid(key.participantLid, key.participantPn);
    if (isLid(key.remoteJid) && key.senderPn && !key.participant) rememberLid(key.remoteJid, key.senderPn);
    if (isPn(key.remoteJid) && key.senderLid && !key.participant) rememberLid(key.senderLid, key.remoteJid);
}

export function withLidFallback(repository, toPn = pnJidOf, cache = null, hasSession = null) {
    const decrypt = repository.decryptMessage.bind(repository);

    const tag = (error, args) => {
        if (error && typeof error === 'object') {
            error.senderJid ??= args?.jid;
            error.e2eType ??= args?.type;
        }

        return error;
    };

    const records = async (jids) => {
        if (!hasSession) return undefined;
        const found = {};
        for (const jid of jids.filter(Boolean)) {
            try { found[isLid(jid) ? 'lid' : 'pn'] = Boolean(await hasSession(jid)); } catch {                      }
        }

        return found;
    };

    const attempt = async (args) => {
        try {
            return await decrypt(args);
        } catch (error) {
            tag(error, args);
            const pn = isLid(args?.jid) ? toPn(args.jid) : null;
            if (error && typeof error === 'object') error.records ??= await records([args?.jid, pn]);

            if (!pn || !/no (matching )?sessions?|no session record|invalid prekey id|missing signedprekey/i.test(String(error?.message))) throw error;

            try {
                return await decrypt({ ...args, jid: pn });
            } catch (second) {
                error.message = `${error.message} (juga dicoba dengan sesi nomor ${userOf(pn)}: ${second?.message})`;
                throw error;
            }
        }
    };

    repository.decryptMessage = async (args) => {
        if (!cache || !Buffer.isBuffer(args?.ciphertext)) return attempt(args);
        const key = `${args.jid}|${args.type}|${createHash('sha256').update(args.ciphertext).digest('hex')}`;
        let result = cache.get(key);
        if (!result) {
            result = attempt(args);
            cache.set(key, result);
            result.catch(() => cache.del(key));
        }
        return Buffer.from(await result);
    };

    return repository;
}
