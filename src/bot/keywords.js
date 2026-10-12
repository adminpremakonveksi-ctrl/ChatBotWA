import { all, db, getSetting, now, run, setSetting } from '../db.js';
import { INTENTS } from './intents.js';
import { productKeys } from './products.js';

/**
 * Keywords taught by the team from the console ("Latih bot"), on top of the
 * built-in lists. Spec rule 2 - "perbanyak variasi kata kunci" - never ends,
 * so it must not need a code change.
 *
 * A keyword points at an intent (e.g. "rekber" -> trust) or at a product
 * (e.g. "kaos panitia" -> kaos); it never changes what the bot says.
 */

db.exec(`
CREATE TABLE IF NOT EXISTS custom_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phrase TEXT NOT NULL UNIQUE,
    intent TEXT NOT NULL,
    product TEXT,
    created_at TEXT
);
`);

// Intents a phrase may be taught. Greeting/other/introduction are not keyword-shaped.
export const TEACHABLE = INTENTS.filter((intent) => !['greeting', 'introduction', 'other', 'custom'].includes(intent));

let cache = null;

/** Lowercase, strip punctuation, collapse spaces: the same shape the classifier matches on. */
export const cleanPhrase = (phrase) =>
    String(phrase ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}&\- ]/gu, ' ')
        .replace(/(\p{L})\1{2,}/gu, '$1')
        .replace(/\s+/g, ' ')
        .trim();

export function customKeywords() {
    cache ??= all('SELECT id, phrase, intent, product, created_at FROM custom_keywords ORDER BY phrase');

    return cache;
}

export function addKeyword({ phrase, intent, product = null }) {
    const clean = cleanPhrase(phrase);

    if (clean.length < 2 || clean.length > 60) {
        throw Object.assign(new Error('Kata kunci harus 2-60 huruf'), { statusCode: 422 });
    }

    if (!TEACHABLE.includes(intent)) {
        throw Object.assign(new Error('Maksud tidak dikenal'), { statusCode: 422 });
    }

    if (intent === 'product' && !productKeys.includes(product)) {
        throw Object.assign(new Error('Pilih produknya'), { statusCode: 422 });
    }

    run(
        `INSERT INTO custom_keywords (phrase, intent, product, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(phrase) DO UPDATE SET intent = excluded.intent, product = excluded.product`,
        [clean, intent, intent === 'product' ? product : null, now()],
    );
    cache = null;

    return clean;
}

/**
 * A fresh install starts with a few real examples, so "Latih bot" shows how
 * teaching works instead of an empty page. Seeded once; the team may delete them.
 */
const STARTERS = [
    { phrase: 'rekber', intent: 'trust' },
    { phrase: 'jam buka', intent: 'location' },
    { phrase: 'buka jam berapa', intent: 'location' },
    { phrase: 'dikirim pakai apa', intent: 'shipping' },
    { phrase: 'contoh foto', intent: 'design_reference' },
    { phrase: 'baju tim', intent: 'product', product: 'jersey' },
    { phrase: 'kaos panitia', intent: 'product', product: 'kaos' },
    { phrase: 'kaos kelas', intent: 'product', product: 'kaos' },
];

export function seedStarterKeywords() {
    if (getSetting('keywords:seeded')) return;

    for (const starter of STARTERS) addKeyword(starter);
    setSetting('keywords:seeded', now());
}

export function removeKeyword(id) {
    run('DELETE FROM custom_keywords WHERE id = ?', [Number(id)]);
    cache = null;
}
