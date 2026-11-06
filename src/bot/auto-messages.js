import { config } from '../config.js';
import { all, getSetting, run, setSetting } from '../db.js';
import { AUTO_MESSAGES_KEY as KEY, SEED_AWAY_MESSAGE } from '../seeds.js';
import { normalise } from '../text.js';
import { fillText, TEMPLATES } from './replies.js';


export const DEFAULT_AUTO_MESSAGES = [TEMPLATES.welcome.text, SEED_AWAY_MESSAGE];

export function autoMessages() {
    const saved = getSetting(KEY);

    if (saved == null) return DEFAULT_AUTO_MESSAGES;

    try {
        return JSON.parse(saved);
    } catch {
        return DEFAULT_AUTO_MESSAGES;
    }
}

export function setAutoMessages(text) {
    const list = String(text ?? '')
        .split(/^[ \t]*-{3}[ \t]*$/m)
        .map((block) => block.trim())
        .filter((block) => block.length >= 5)
        .slice(0, 10);

    setSetting(KEY, JSON.stringify(list));

    return list;
}

const words = (text) => new Set(normalise(text).trim().split(' ').filter((w) => w.length > 1));

const SIMILAR = 0.7;

export function isAutoMessage(text) {
    const mine = words(text);

    if (mine.size < 4) return false;

    const lists = autoMessages().map((auto) => words(fillText(auto)));
    const known = new Set(lists.flatMap((set) => [...set]));
    let covered = 0;
    for (const word of mine) if (known.has(word)) covered++;

    return lists.some((theirs) => {
        if (theirs.size < 4) return false;

        let shared = 0;
        for (const word of theirs) if (mine.has(word)) shared++;

        return shared / theirs.size >= SIMILAR && covered / mine.size >= SIMILAR;
    });
}

export function releaseAutoHandovers({ sessionKey = null, jid = null } = {}) {
    const held = all(
        `SELECT session_key, jid, name, handed_over_at FROM conversations
         WHERE step = 'handed_over' AND handover_reason = 'CS membalas'
           AND (? IS NULL OR session_key = ?) AND (? IS NULL OR jid = ?)`,
        [sessionKey, sessionKey, jid, jid],
    );
    const released = [];

    for (const c of held) {
        const typed = all(
            `SELECT text FROM message_log
             WHERE session_key = ? AND jid = ? AND direction = 'cs' AND created_at >= datetime(?, ?)`,
            [c.session_key, c.jid, c.handed_over_at, `-${Number(config.bot.handoverHours) || 24} hours`],
        );

        if (!typed.length || !typed.every((m) => isAutoMessage(m.text ?? ''))) continue;

        run(
            `UPDATE conversations SET step = ?, handed_over_at = NULL, handover_reason = NULL, misses = 0
             WHERE session_key = ? AND jid = ?`,
            [c.name ? 'awaiting_product' : 'new', c.session_key, c.jid],
        );
        released.push(c.jid);
    }

    return released;
}
