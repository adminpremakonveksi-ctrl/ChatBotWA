import { config } from '../config.js';
import { all, get, now, run } from '../db.js';
import { utcOffsetMinutes } from './schedule.js';
import { normalise } from '../text.js';
import { wordSet } from './words.js';

const local = () => `${utcOffsetMinutes() >= 0 ? '+' : ''}${utcOffsetMinutes()} minutes`;

const COLUMNS = ['step', 'name', 'origin', 'product', 'return_step', 'handed_over_at', 'handover_reason', 'last_message_at', 'quantity', 'details', 'detail_index', 'misses', 'notes', 'offered_cs', 'order_info'];

const toDate = (stamp) => (stamp ? new Date(`${stamp.replace(' ', 'T')}Z`) : null);

const hoursSince = (stamp, at) => {
    const date = toDate(stamp);

    return date ? (at.getTime() - date.getTime()) / 3600000 : Infinity;
};

/**
 * Where a customer is in the flow. Two things send a conversation back to the
 * greeting, keeping the stored name so a returning customer is greeted by it:
 *  - a handover older than HANDOVER_HOURS (CS has had its shift), and
 *  - a half-finished conversation idle for RESET_HOURS, except one waiting for
 *    a follow-up answer (the size list comes days later) or chatting with the
 *    AI (it remembers the order being discussed): detailWaitDays.
 */
export function loadConversation(sessionKey, jid, at = new Date()) {
    const row = get('SELECT * FROM conversations WHERE session_key = ? AND jid = ?', [sessionKey, jid]);

    if (!row) {
        return { step: 'new', name: null, origin: null, product: null, return_step: null, quantity: null, details: null, detail_index: null, misses: 0, notes: null, offered_cs: 0, order_info: null };
    }

    const expired =
        row.step === 'handed_over'
            ? hoursSince(row.handed_over_at, at) >= config.bot.handoverHours
            : row.step === 'awaiting_detail' || row.step === 'chat'
              ? hoursSince(row.last_message_at, at) >= (config.bot.detailWaitDays ?? 14) * 24
              : row.step !== 'new' && hoursSince(row.last_message_at, at) >= config.bot.resetHours;

    if (expired) {
        return { ...row, step: 'new', product: null, return_step: null, handed_over_at: null, handover_reason: null, quantity: null, details: null, detail_index: null, misses: 0, notes: null, offered_cs: 0, order_info: null };
    }

    return row;
}

export function saveConversation(sessionKey, jid, values) {
    const stamp = now();
    const current = loadConversation(sessionKey, jid);
    const merged = { ...current, ...values, last_message_at: stamp };

    run(
        `INSERT INTO conversations (session_key, jid, ${COLUMNS.join(', ')}, created_at, updated_at)
         VALUES (?, ?, ${COLUMNS.map(() => '?').join(', ')}, ?, ?)
         ON CONFLICT(session_key, jid) DO UPDATE SET
         ${COLUMNS.map((column) => `${column} = excluded.${column}`).join(', ')}, updated_at = excluded.updated_at`,
        [sessionKey, jid, ...COLUMNS.map((column) => merged[column] ?? null), stamp, stamp],
    );
}

/** Back to the greeting, e.g. after CS is done or after a test. Keeps the name. */
export function resetConversation(sessionKey, jid) {
    run(
        `UPDATE conversations SET step = 'new', product = NULL, return_step = NULL, handed_over_at = NULL, handover_reason = NULL,
         quantity = NULL, details = NULL, detail_index = NULL, misses = 0, notes = NULL, offered_cs = 0, order_info = NULL
         WHERE session_key = ? AND jid = ?`,
        [sessionKey, jid],
    );
}

export function markHandover(sessionKey, jid, reason) {
    saveConversation(sessionKey, jid, { step: 'handed_over', handed_over_at: now(), handover_reason: reason });
    logMessage({ sessionKey, jid, direction: 'handover', text: reason });
}

export function logMessage({ sessionKey, jid, direction, waMessageId = null, text = null, intent = null }) {
    run(
        `INSERT INTO message_log (session_key, jid, direction, wa_message_id, text, intent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sessionKey, jid, direction, waMessageId, text, intent, now()],
    );
}

/** How often the bot sent exactly this bubble to this customer in the last `minutes`. */
export function recentlySent(sessionKey, jid, text, minutes) {
    return get(
        `SELECT COUNT(*) AS n FROM message_log
         WHERE session_key = ? AND jid = ? AND direction = 'out' AND text = ? AND created_at >= datetime('now', ?)`,
        [sessionKey, jid, text, `-${Number(minutes)} minutes`],
    ).n;
}

/** True when a message id was sent by the bot itself (not by CS on the phone). */
export function isBotMessage(waMessageId) {
    return Boolean(get(`SELECT 1 FROM message_log WHERE wa_message_id = ? AND direction = 'out' LIMIT 1`, [waMessageId]));
}

/** Message volume per local day, for deciding the AI budget later. */
export function stats(days = 30) {
    return all(
        `SELECT date(created_at, '${local()}') AS tanggal,
                SUM(direction = 'in') AS masuk,
                SUM(direction = 'out') AS keluar,
                COUNT(DISTINCT CASE WHEN direction = 'in' THEN jid END) AS pelanggan,
                SUM(direction = 'handover') AS handover
         FROM message_log
         WHERE created_at >= datetime('now', ?)
         GROUP BY tanggal ORDER BY tanggal DESC`,
        [`-${Number(days)} days`],
    );
}

/** "62812...@s.whatsapp.net" -> "62812..."; privacy ids (@lid) have no number. */
export const phoneOf = (jid) => (jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0].split(':')[0] : null);

/** Conversations active since a UTC stamp, newest first, with their last customer message. */
export function listConversations(since) {
    return all(
        `SELECT c.*,
                (SELECT text FROM message_log m
                  WHERE m.session_key = c.session_key AND m.jid = c.jid AND m.direction = 'in'
                  ORDER BY m.id DESC LIMIT 1) AS last_text,
                (SELECT COUNT(*) FROM message_log m
                  WHERE m.session_key = c.session_key AND m.jid = c.jid AND m.direction = 'in'
                    AND m.created_at >= ?) AS incoming
         FROM conversations c
         WHERE c.last_message_at >= ?
         ORDER BY c.last_message_at DESC`,
        [since, since],
    ).map((row) => ({ ...row, phone: phoneOf(row.jid) }));
}

export function messagesOf(sessionKey, jid, limit = 200) {
    return all(
        `SELECT direction, text, intent, created_at FROM message_log
         WHERE session_key = ? AND jid = ? AND direction <> 'step' ORDER BY id DESC LIMIT ?`,
        [sessionKey, jid, limit],
    ).reverse();
}

/** Deletes chat text older than `days`; customers' messages are not kept forever. */
export function prune(days) {
    const cutoff = `-${Number(days)} days`;
    const messages = run(`DELETE FROM message_log WHERE created_at < datetime('now', ?)`, [cutoff]).changes;
    const conversations = run(`DELETE FROM conversations WHERE last_message_at < datetime('now', ?)`, [cutoff]).changes;

    return { messages, conversations };
}

/** Labels a customer's just-answered bubbles with what the classifier made of them. */
export function tagIncoming(sessionKey, jid, intent) {
    run(
        `UPDATE message_log SET intent = ? WHERE session_key = ? AND jid = ? AND direction = 'in' AND intent IS NULL`,
        [intent, sessionKey, jid],
    );
}

/** Customer messages the bot did not understand: the to-do list for teaching it. */
export function unrecognised(days = 30) {
    return all(
        `SELECT text, COUNT(*) AS times, MAX(created_at) AS last_at
         FROM message_log
         WHERE direction = 'in' AND intent = 'other' AND TRIM(COALESCE(text, '')) <> ''
           AND created_at >= datetime('now', ?)
         GROUP BY LOWER(TRIM(text))
         ORDER BY last_at DESC
         LIMIT 100`,
        [`-${Number(days)} days`],
    );
}

/**
 * How far customers got through the reply flow: distinct customers per stage,
 * from the step changes the bot logs. A later stage implies the earlier ones.
 */
function funnel(since) {
    const count = (sql, params = []) => get(sql, [since, ...params]).n;
    const reached = (steps) =>
        count(
            `SELECT COUNT(DISTINCT jid) AS n FROM message_log
             WHERE direction = 'step' AND created_at >= datetime('now', ?) AND text IN (${steps.map(() => '?').join(', ')})`,
            steps,
        );

    return [
        { stage: 'Menghubungi', n: count(`SELECT COUNT(DISTINCT jid) AS n FROM message_log WHERE direction = 'in' AND created_at >= datetime('now', ?)`) },
        { stage: 'Menyebut produk', n: reached(['awaiting_design', 'awaiting_quantity']) },
        { stage: 'Ditanya jumlah', n: reached(['awaiting_quantity']) },
        {
            stage: 'Alur selesai, menunggu CS',
            n: count(`SELECT COUNT(DISTINCT jid) AS n FROM message_log WHERE direction = 'handover' AND text = 'alur selesai' AND created_at >= datetime('now', ?)`),
        },
    ];
}

/** Everything the Statistik page draws, in local time. */
export function analytics(days = 30) {
    const since = `-${Number(days)} days`;
    const offset = local();

    const byDay = new Map(stats(days).map((row) => [row.tanggal, row]));
    const daily = [];
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(Date.now() + utcOffsetMinutes() * 60000 - i * 86400000).toISOString().slice(0, 10);
        const row = byDay.get(date) ?? {};
        daily.push({ date, masuk: row.masuk ?? 0, pelanggan: row.pelanggan ?? 0, handover: row.handover ?? 0 });
    }

    const hourRows = all(
        `SELECT CAST(strftime('%H', created_at, '${offset}') AS INTEGER) AS hour, COUNT(*) AS n
         FROM message_log WHERE direction = 'in' AND created_at >= datetime('now', ?) GROUP BY hour`,
        [since],
    );
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, n: hourRows.find((r) => r.hour === hour)?.n ?? 0 }));

    const intents = all(
        `SELECT intent, COUNT(*) AS n FROM message_log
         WHERE direction = 'in' AND intent IS NOT NULL AND created_at >= datetime('now', ?)
         GROUP BY intent ORDER BY n DESC`,
        [since],
    );

    const handovers = all(
        `SELECT text AS reason, COUNT(*) AS n FROM message_log
         WHERE direction = 'handover' AND created_at >= datetime('now', ?)
         GROUP BY text ORDER BY n DESC`,
        [since],
    );

    const labelled = intents.reduce((sum, row) => sum + row.n, 0);
    const other = intents.find((row) => row.intent === 'other')?.n ?? 0;

    return {
        days,
        daily,
        hours,
        intents,
        handovers,
        recognisedRate: labelled ? (labelled - other) / labelled : null,
        funnel: funnel(since),
        patterns: intents.filter((row) => row.intent.startsWith('pola: ')).map((row) => ({ name: row.intent.slice(6), n: row.n })),
        totals: {
            masuk: daily.reduce((sum, d) => sum + d.masuk, 0),
            pelanggan: get(
                `SELECT COUNT(DISTINCT jid) AS n FROM message_log WHERE direction = 'in' AND created_at >= datetime('now', ?)`,
                [since],
            ).n,
            handover: daily.reduce((sum, d) => sum + d.handover, 0),
        },
    };
}

/* ------------------------------------------------- Latih bot helpers --- */

// Words that carry no meaning of their own (Kamus: "Kata dibuang dari saran").
const FILLERS = () => wordSet('pengisi_saran');

/** The core of a message to teach as a keyword: "Mau nanya2 dulu mas" -> "mau nanya nanya dulu". */
export function suggestPhrase(text) {
    const words = normalise(text).trim().split(' ').filter((w) => w && !FILLERS().has(w));

    return words.slice(0, 6).join(' ').slice(0, 60);
}

const DISMISSED = 'teach:dismissed';

export const dismissKey = (text) => String(text ?? '').trim().toLowerCase();

export function dismissedTexts() {
    try {
        return JSON.parse(get(`SELECT value FROM settings WHERE "key" = ?`, [DISMISSED])?.value ?? '[]');
    } catch {
        return [];
    }
}

/** Hides one unrecognised message from Latih bot, or shows it again (undo). */
export function dismissText(text, undo = false) {
    const key = dismissKey(text);
    if (!key) return;

    const list = dismissedTexts().filter((t) => t !== key);
    if (!undo) list.push(key);

    run(
        `INSERT INTO settings ("key", value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT("key") DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [DISMISSED, JSON.stringify(list.slice(-500)), now()],
    );
}

/**
 * The conversation just before the message being answered, oldest first, for
 * the AI: [{ who: 'pelanggan' | 'bot' | 'cs', text }]. `skip` = how many of the
 * latest incoming lines are the message itself (already logged).
 */
export function recentHistory(sessionKey, jid, skip = 1, limit = 6) {
    const rows = all(
        `SELECT direction, text FROM message_log
         WHERE session_key = ? AND jid = ? AND direction IN ('in', 'out', 'cs') AND TRIM(COALESCE(text, '')) <> ''
         ORDER BY id DESC LIMIT ?`,
        [sessionKey, jid, limit + skip],
    );

    // Drop the message itself (its lines are the newest incoming ones).
    let dropped = 0;
    const before = rows.filter((row) => {
        if (dropped < skip && row.direction === 'in') {
            dropped++;

            return false;
        }

        return true;
    });

    return before
        .slice(0, limit)
        .reverse()
        .map((row) => ({ who: row.direction === 'in' ? 'pelanggan' : row.direction === 'cs' ? 'cs' : 'bot', text: String(row.text).slice(0, 300) }));
}
