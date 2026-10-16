import fs from 'node:fs';
import path from 'node:path';

import { config } from '../config.js';
import { all, db, get, now, run } from '../db.js';
import { rememberRemoved } from '../migrations.js';
import { SEED_PATTERNS } from '../seeds.js';
import { cleanPhrase } from '../text.js';
import { localDateString } from './schedule.js';

/**
 * Answer patterns the team builds in the console ("Pola jawaban"): a name,
 * the phrases that trigger it, and an answer made of bubbles in order.
 *
 *   { type: 'text', text }        fixed text the team wrote ({nama} {bot} {cs}); several
 *                                 versions separated by a "---" line, one picked at random
 *   { type: 'photos' }            every photo uploaded to the pattern, in order
 *   { type: 'catalog', items }    WhatsApp Business catalog items, as product links
 *   { type: 'link', url }         any https link
 *   { type: 'slot', slot }        the files of a Media slot, e.g. 'katalog-review'
 *
 * It is still fixed text: the team writes it, the bot only picks it. A
 * matching pattern wins over the built-in answers, so the team can replace
 * one ("Ukuran" instead of the built-in size chart reply).
 *
 * Seeded "bawaan" patterns (Lokasi, Pengiriman, Ragu, Minimal order) carry
 * `builtin`, the AI label of the same meaning; they are edited and deleted
 * like any other, and "Kembalikan ke bawaan" restores the seed.
 * The table is created by src/migrations.js.
 */

const MAX_BUBBLES = 10;
const MAX_KEYWORDS = 300;
const MAX_TEXT = 3000;

const fail = (message, statusCode = 422) => {
    throw Object.assign(new Error(message), { statusCode });
};

let cache = null;

const parse = (row) => ({
    id: row.id,
    name: row.name,
    keywords: JSON.parse(row.keywords),
    bubbles: JSON.parse(row.bubbles),
    after: row.after,
    enabled: Boolean(row.enabled),
    startsOn: row.starts_on || '',
    endsOn: row.ends_on || '',
    builtin: row.builtin || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

export function listPatterns() {
    cache ??= all('SELECT * FROM patterns ORDER BY id').map(parse);

    return cache;
}

export const getPattern = (id) => listPatterns().find((p) => p.id === Number(id)) ?? fail('Pola tidak ditemukan', 404);

/** Splits a text bubble into its versions ("---" on a line of its own). */
export const textVersions = (text) =>
    String(text)
        .split(/\n\s*-{3,}\s*\n/)
        .map((v) => v.trim())
        .filter(Boolean);

/** Whether a pattern's date window (if any) includes today, in the shop's timezone. */
export const inSchedule = (p, date = new Date()) => {
    const today = localDateString(date, config.bot.timezone);

    return (!p.startsOn || today >= p.startsOn) && (!p.endsOn || today <= p.endsOn);
};

/** Patterns the bot may answer with: switched on, in its dates, with a trigger and an answer. */
export const activePatterns = () => listPatterns().filter((p) => p.enabled && p.keywords.length && p.bubbles.length && inSchedule(p));

export function createPattern(name) {
    const clean = String(name ?? '').trim().slice(0, 60) || 'Pola baru';
    const stamp = now();
    const { lastInsertRowid } = run(`INSERT INTO patterns (name, created_at, updated_at) VALUES (?, ?, ?)`, [clean, stamp, stamp]);
    cache = null;

    return getPattern(Number(lastInsertRowid));
}

function validBubble(bubble) {
    switch (bubble?.type) {
        case 'text': {
            const text = String(bubble.text ?? '').replace(/\r\n/g, '\n').trim();
            if (!textVersions(text).length) fail('Gelembung teks tidak boleh kosong');
            if (text.length > MAX_TEXT) fail(`Teks maksimal ${MAX_TEXT} huruf`);

            const unknown = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((v) => !['nama', 'bot', 'cs'].includes(v));
            if (unknown.length) fail(`{${unknown[0]}} tidak dikenal. Yang tersedia: {nama} {bot} {cs}`);

            return { type: 'text', text };
        }
        case 'photos':
            return { type: 'photos' };
        case 'catalog': {
            const items = [...new Set((bubble.items ?? []).map(String))].slice(0, 5);
            if (!items.length) fail('Pilih minimal satu produk katalog');

            return { type: 'catalog', items };
        }
        case 'link': {
            const url = String(bubble.url ?? '').trim();
            if (!/^https:\/\/[^\s<>"']+$/i.test(url)) fail('Link harus diawali https:// tanpa spasi');

            return { type: 'link', url };
        }
        case 'slot': {
            // A Media slot id: "katalog-review", "katalog:jersey", "size-chart:kaos:reguler".
            const slot = String(bubble.slot ?? '').trim();
            if (!/^[a-z-]+(:[a-z0-9-]+){0,2}$/.test(slot)) fail('Pilih file dari halaman Media');

            return { type: 'slot', slot };
        }
        default:
            return fail('Jenis gelembung tidak dikenal');
    }
}

export function updatePattern(id, values) {
    const pattern = getPattern(id);
    const name = values.name === undefined ? pattern.name : String(values.name).trim().slice(0, 60);

    if (!name) fail('Nama pola wajib diisi');

    const keywords = values.keywords === undefined
        ? pattern.keywords
        : [...new Set((Array.isArray(values.keywords) ? values.keywords : String(values.keywords).split(/[\n,]/)).map(cleanPhrase).filter((k) => k.length >= 2))].slice(0, MAX_KEYWORDS);

    const bubbles = values.bubbles === undefined ? pattern.bubbles : values.bubbles.map(validBubble);
    if (bubbles.length > MAX_BUBBLES) fail(`Maksimal ${MAX_BUBBLES} gelembung`);

    const after = values.after === undefined ? pattern.after : values.after === 'handover' ? 'handover' : 'stay';
    const enabled = values.enabled === undefined ? pattern.enabled : Boolean(values.enabled);

    const day = (v, label) => {
        const d = String(v ?? '').trim();
        if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail(`${label}: pakai tanggal seperti 2026-11-01`);

        return d;
    };
    const startsOn = values.startsOn === undefined ? pattern.startsOn : day(values.startsOn, 'Mulai berlaku');
    const endsOn = values.endsOn === undefined ? pattern.endsOn : day(values.endsOn, 'Selesai berlaku');
    if (startsOn && endsOn && endsOn < startsOn) fail('Tanggal selesai sebelum tanggal mulai');

    // Built-in keywords the team took out are never seeded back by a later update.
    if (pattern.builtin) for (const k of pattern.keywords.filter((k) => !keywords.includes(k))) rememberRemoved(db, `pattern:${pattern.builtin}`, k);

    run(
        `UPDATE patterns SET name = ?, keywords = ?, bubbles = ?, after = ?, enabled = ?, starts_on = ?, ends_on = ?, updated_at = ? WHERE id = ?`,
        [name, JSON.stringify(keywords), JSON.stringify(bubbles), after, enabled ? 1 : 0, startsOn || null, endsOn || null, now(), pattern.id],
    );
    cache = null;

    return getPattern(pattern.id);
}

/** "Ajarkan" from Latih bot: one more trigger phrase for a pattern. */
export function addPatternKeyword(id, phrase) {
    const pattern = getPattern(id);
    const clean = cleanPhrase(phrase);

    if (clean.length < 2 || clean.length > 60) fail('Kata kunci harus 2-60 huruf');

    return updatePattern(pattern.id, { keywords: [...pattern.keywords, clean] });
}

export function deletePattern(id) {
    const pattern = getPattern(id);

    run('DELETE FROM patterns WHERE id = ?', [pattern.id]);
    cache = null;

    fs.rmSync(path.join(config.mediaDir, 'pola', String(pattern.id)), { recursive: true, force: true });
}

/** The seed of a built-in pattern ("Lokasi", ...), for "Kembalikan ke bawaan". */
export const seedFor = (builtin) => SEED_PATTERNS.find((s) => s.builtin === builtin) ?? null;

/** Puts a built-in pattern back to its seed: name, keywords, answer, switched on, no dates. */
export function resetPattern(id) {
    const pattern = getPattern(id);
    const seed = seedFor(pattern.builtin) ?? fail('Pola ini buatan tim, tidak punya versi bawaan');

    const reset = updatePattern(pattern.id, { name: seed.name, keywords: seed.keywords, bubbles: seed.bubbles, after: 'stay', enabled: true, startsOn: '', endsOn: '' });
    // Back to the original on purpose: later seed updates may add to it again.
    run('DELETE FROM seed_removed WHERE kind = ?', [`pattern:${pattern.builtin}`]);

    return reset;
}

/**
 * Brings back a built-in pattern the team deleted, from its seed.
 * Returns the new pattern, or null when it still exists.
 */
export function restoreBuiltin(builtin) {
    const seed = seedFor(builtin) ?? fail('Pola bawaan tidak dikenal', 404);
    if (listPatterns().some((p) => p.builtin === builtin)) return null;

    const stamp = now();
    const { lastInsertRowid } = run(
        `INSERT INTO patterns (name, keywords, bubbles, after, enabled, builtin, created_at, updated_at) VALUES (?, ?, ?, 'stay', 1, ?, ?, ?)`,
        [seed.name, JSON.stringify([...new Set(seed.keywords.map(cleanPhrase))]), JSON.stringify(seed.bubbles), builtin, stamp, stamp],
    );
    run('DELETE FROM seed_removed WHERE kind = ?', [`pattern:${builtin}`]);
    cache = null;

    return getPattern(Number(lastInsertRowid));
}

/** Built-in patterns that were deleted and can be brought back. */
export const missingBuiltins = () => SEED_PATTERNS.filter((s) => !listPatterns().some((p) => p.builtin === s.builtin)).map((s) => ({ builtin: s.builtin, name: s.name }));

/** The active pattern for an AI label (location, shipping, trust, moq), if the team kept it. */
export const patternForBuiltin = (builtin) => activePatterns().find((p) => p.builtin === builtin) ?? null;

/** Lets an override test in the same process see edits made through SQL. */
export const forgetPatterns = () => {
    cache = null;
};

export const patternExists = (id) => Boolean(get('SELECT 1 FROM patterns WHERE id = ?', [Number(id)]));
