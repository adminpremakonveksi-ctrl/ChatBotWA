import { getSetting, setSetting } from '../db.js';
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

const KEY = 'wa:auto_messages';

export const DEFAULT_AUTO_MESSAGES = [TEMPLATES.welcome.text];

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
        .split(/^\s*-{3,}\s*$/m)
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

    return autoMessages().some((auto) => {
        const theirs = words(fillText(auto));
        if (theirs.size < 4) return false;

        let shared = 0;
        for (const word of theirs) if (mine.has(word)) shared++;

        // Both ways: the message is mostly the automatic text, and not a long CS reply quoting it.
        return shared / theirs.size >= SIMILAR && shared / mine.size >= SIMILAR;
    });
}
