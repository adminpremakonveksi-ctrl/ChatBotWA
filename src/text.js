import { SEED_WORDS } from './seeds.js';

/**
 * The one shape text is compared in: customer messages, built-in keywords,
 * team keywords and pattern keywords all go through normalise(), so a phrase
 * stored as "belum ada" matches a customer typing "blm ada".
 *
 * The dictionary (chat shorthand "brp" -> "berapa", Javanese/Sundanese
 * "pinten" -> "berapa", phrases "matur nuwun" -> "makasih") is data: it
 * starts from src/seeds.js and is replaced by the database copy the team
 * edits in the console (src/bot/words.js calls setDictionary).
 *
 * Imports only the seeds: the migrations use this before anything else loads.
 */

let words = new Map();
let phrases = [];

const pairsOf = (list) => (SEED_WORDS[list]?.words ?? []).map(([word, value]) => ({ word, value }));

/**
 * Sets the dictionary. `shorthand` entries win over `regional` ones for the
 * same word; phrases are [{ word: 'matur nuwun', value: 'makasih' }].
 */
export function setDictionary({ shorthand = [], regional = [], phrase = [] } = {}) {
    words = new Map();
    for (const { word, value } of [...regional, ...shorthand]) {
        if (word && value) words.set(String(word).toLowerCase(), String(value).toLowerCase());
    }

    phrases = phrase
        .filter((p) => p.word && p.value)
        .map((p) => [` ${String(p.word).toLowerCase().trim()} `, ` ${String(p.value).toLowerCase().trim()} `]);
}

// The seeds until the database copy is loaded.
setDictionary({ shorthand: pairsOf('singkatan'), regional: pairsOf('bahasa_daerah'), phrase: pairsOf('frasa') });

/** What a single word is read as ("brp" -> "berapa"), or the word itself. */
export const expandWord = (word) => words.get(word) ?? word;

/**
 * Changes whenever the dictionary changes. Keywords are stored normalised,
 * so they are re-stored when this differs from the value saved in the
 * database (see migrations.js).
 */
export function textRulesVersion() {
    const source = JSON.stringify([[...words.entries()].sort(), phrases, 'reduplication-1']);
    let hash = 5381;
    for (let i = 0; i < source.length; i++) hash = ((hash * 33) ^ source.charCodeAt(i)) >>> 0;

    return hash.toString(36);
}

/** Lowercase, strip punctuation, squash "kakkk" -> "kak", expand shorthand; padded with spaces for word matching. */
export function normalise(text) {
    const joined = String(text ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}&\- ]/gu, ' ')
        .replace(/(\p{L})\1{2,}/gu, '$1')
        .split(/\s+/)
        .filter(Boolean)
        // "nanya2", "takon-takon" -> "nanya nanya", "takon takon" (reduplication).
        .flatMap((word) => {
            if (/^\p{L}{2,}2$/u.test(word) && !words.has(word)) return [word.slice(0, -1), word.slice(0, -1)];

            const [a, b] = word.split('-');

            return b && a === b ? [a, b] : [word];
        })
        .join(' ');

    // Phrases before the word lists ("matur nuwun", not "matur makasih"), and
    // after them for the ones the lists produce ("ten pundi" -> "di mana").
    const replacePhrases = (value) => {
        let out = ` ${value} `;
        for (const [from, to] of phrases) {
            while (out.includes(from)) out = out.replace(from, to);
        }

        return out;
    };

    const mapped = replacePhrases(joined).trim().split(' ').filter(Boolean).map(expandWord);

    return replacePhrases(mapped.join(' '));
}

/** A keyword as it is stored: normalised, without the padding. */
export const cleanPhrase = (phrase) => normalise(phrase).trim();

/** "Kaos Polo Anak" -> "kaos-polo-anak": a stable key for a product the team adds. */
export const slugify = (text) =>
    String(text ?? '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
