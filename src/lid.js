import { all, db, get, now, run } from './db.js';

/**
 * WhatsApp addresses a person either by phone number (628...@s.whatsapp.net,
 * "PN") or by LID (a hidden id, 2806...@lid). The same person, or the bot's
 * own phone, can show up under either. Baileys 6.7 keeps no mapping, which
 * broke two things:
 *  - a message from our own phone addressed by LID could not be decrypted
 *    (the encryption session was made under the number): CS typing on the
 *    phone went unseen and the bot kept answering;
 *  - one customer could be two conversations.
 *
 * The mapping is learnt from customers' incoming messages (WhatsApp sends both
 * ids) and from our own account, and kept in the table lid_map. Messages we
 * sent ourselves never teach anything: their sender ids are ours.
 */

/** "6281:3@s.whatsapp.net" -> "6281". */
export const userOf = (jid) => String(jid ?? '').split('@')[0].split(':')[0];
const serverOf = (jid) => String(jid ?? '').split('@')[1] ?? '';
const deviceOf = (jid) => {
    const head = String(jid ?? '').split('@')[0];

    return head.includes(':') ? head.split(':')[1] : null;
};

export const isLid = (jid) => serverOf(jid) === 'lid';
export const isPn = (jid) => serverOf(jid) === 's.whatsapp.net';

// The bot's own identity (set when the socket is made and when it connects).
const own = { lid: null, pn: null };

/** The bot's own LID and number: always mapped to each other, never to anyone else. */
export function setOwnIdentity({ lid, id } = {}) {
    if (!isLid(lid) || !isPn(id)) return;

    own.lid = userOf(lid);
    own.pn = userOf(id);
    store(own.lid, own.pn);
}

/** Stores a pair; when it is new, the LID's conversation joins the number's. */
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

/**
 * Remembers that a customer's LID is this number. Refused when it would tie
 * the bot's own LID or number to someone else.
 */
export function rememberLid(lid, pn) {
    if (!isLid(lid) || !isPn(pn) || !userOf(lid) || !userOf(pn)) return false;

    const l = userOf(lid);
    const p = userOf(pn);

    if (own.lid && (l === own.lid) !== (p === own.pn)) return false;

    return store(l, p);
}

/**
 * A conversation (and its messages) kept under the LID moves to the number,
 * so a customer handed to CS stays handed over. When both exist, the one
 * written last is kept.
 */
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
}

/** The phone number user of a LID, or null. Our own from memory: it must work before anything is stored. */
export function pnOfLid(jid) {
    if (!isLid(jid)) return null;
    if (own.lid && userOf(jid) === own.lid) return own.pn;

    return get('SELECT pn FROM lid_map WHERE lid = ?', [userOf(jid)])?.pn ?? null;
}

/** A LID jid as the phone-number jid of the same device ("2806:3@lid" -> "6281...:3@s.whatsapp.net"), or null. */
export function pnJidOf(jid) {
    const pn = pnOfLid(jid);
    if (!pn) return null;

    const device = deviceOf(jid);

    return `${pn}${device ? `:${device}` : ''}@s.whatsapp.net`;
}

/** The jid a conversation is kept under: the number when known, so one customer is one chat. */
export function conversationJid(jid) {
    const pn = pnOfLid(jid);

    return pn ? `${pn}@s.whatsapp.net` : jid;
}

/**
 * Learns the LID/number pair from a customer's incoming message. Baileys 6.7
 * puts the author's ids on the key (sender_lid / sender_pn, participant_* in
 * groups). A message we sent (fromMe) is skipped: those ids are ours.
 */
export function learnFromKey(key = {}) {
    if (key.fromMe) return;

    if (key.senderLid && key.senderPn) rememberLid(key.senderLid, key.senderPn);
    if (key.participantLid && key.participantPn) rememberLid(key.participantLid, key.participantPn);
    if (isLid(key.remoteJid) && key.senderPn && !key.participant) rememberLid(key.remoteJid, key.senderPn);
    if (isPn(key.remoteJid) && key.senderLid && !key.participant) rememberLid(key.senderLid, key.remoteJid);
}

/**
 * Wraps a Baileys signal repository so that a message from a LID address whose
 * session was made under the number is read with that session. When that
 * fails too, the original error is reported (it names the real address).
 */
export function withLidFallback(repository, toPn = pnJidOf) {
    const decrypt = repository.decryptMessage.bind(repository);

    repository.decryptMessage = async (args) => {
        try {
            return await decrypt(args);
        } catch (error) {
            const pn = isLid(args?.jid) ? toPn(args.jid) : null;

            if (!pn || !/no (matching )?sessions?|no session record/i.test(String(error?.message))) throw error;

            try {
                return await decrypt({ ...args, jid: pn });
            } catch (second) {
                error.message = `${error.message} (juga dicoba dengan sesi nomor ${userOf(pn)}: ${second?.message})`;
                throw error;
            }
        }
    };

    return repository;
}
