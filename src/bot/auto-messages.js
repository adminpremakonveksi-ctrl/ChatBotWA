import { getSetting, setSetting } from '../db.js';
import { AUTO_MESSAGES_KEY as KEY, SEED_AWAY_MESSAGE } from '../seeds.js';
import { normalise } from '../text.js';
import { fillText, TEMPLATES } from './replies.js';

/**
 * WhatsApp Business automatic messages (Salam, Pesan tidak di tempat) are
 * sent by WhatsApp itself from the bot's own number. The bot sees them as
 * "fromMe" messages it did not send, which normally means CS is typing on
 * the phone and hands the customer over. These texts are known, so they are
 * recognised and ignored: the bot carries on with its flow.
 *
 * The team keeps the list in the console (Pengaturan), one message per block
 * separated by a line with ---. {bot} and {cs} are filled with the names set
 * in Pengaturan. The default is the shop's Salam (the same text as the bot's
 * "Salam pembuka" template).
 */

// The Salam plus the shop's "Pesan tidak di tempat" (seeds.js): missing from
// the list, the away message was read as CS typing and muted the bot.
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

/** From the console: blocks separated by a line with --- ; empty blocks dropped. */
export function setAutoMessages(text) {
    const list = String(text ?? '')
        // Exactly three: the Salam itself has a line of seven ("-------").
        .split(/^[ \t]*-{3}[ \t]*$/m)
        .map((block) => block.trim())
        .filter((block) => block.length >= 5)
        .slice(0, 10);

    setSetting(KEY, JSON.stringify(list));

    return list;
}

const words = (text) => new Set(normalise(text).trim().split(' ').filter((w) => w.length > 1));

// Share of the automatic message's words found in the outgoing one. High
// enough that a CS reply never passes; low enough that a changed name
// ("Saya ANGGUN" vs "Saya Mawar") or a small edit in the WhatsApp app does.
const SIMILAR = 0.7;

/** True when an outgoing message is one of the automatic ones, not CS typing. */
export function isAutoMessage(text) {
    const mine = words(text);

    if (mine.size < 4) return false;

    const lists = autoMessages().map((auto) => words(fillText(auto)));
    // A list saved before 2026-10-19 may hold the Salam cut in two at its "-------".
    const known = new Set(lists.flatMap((set) => [...set]));
    let covered = 0;
    for (const word of mine) if (known.has(word)) covered++;

    return lists.some((theirs) => {
        if (theirs.size < 4) return false;

        let shared = 0;
        for (const word of theirs) if (mine.has(word)) shared++;

        // Both ways: the message is mostly an automatic text, and not a long CS reply around it.
        return shared / theirs.size >= SIMILAR && covered / mine.size >= SIMILAR;
    });
}
