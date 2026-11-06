import { all, db, get, now, run } from '../db.js';
import { loadDictionary, rememberRemoved, syncTextRules } from '../migrations.js';
import { SEED_WORDS } from '../seeds.js';


export const WORD_LISTS = Object.fromEntries(
    Object.entries(SEED_WORDS).map(([name, meta]) => [name, { label: meta.label, help: meta.help, pairs: Boolean(meta.pairs) }]),
);

const DICTIONARY = new Set(['singkatan', 'bahasa_daerah', 'frasa']);

let cache = null;
const listeners = new Set();

export const onWordsChanged = (fn) => listeners.add(fn);

function rows() {
    cache ??= all('SELECT id, list, word, value, source FROM word_lists ORDER BY list, word');

    return cache;
}

const sets = new Map();
const maps = new Map();

export function wordSet(list) {
    if (!sets.has(list)) sets.set(list, new Set(rows().filter((r) => r.list === list).map((r) => r.word)));

    return sets.get(list);
}

export const wordsOf = (list) => [...wordSet(list)].sort((a, b) => b.length - a.length);

export function wordMap(list) {
    if (!maps.has(list)) maps.set(list, new Map(rows().filter((r) => r.list === list).map((r) => [r.word, r.value])));

    return maps.get(list);
}

export const wordRows = (list = null) => rows().filter((r) => !list || r.list === list);

function changed(list) {
    cache = null;
    sets.clear();
    maps.clear();

    if (DICTIONARY.has(list)) {
        loadDictionary(db);
        syncTextRules(db);
    }

    for (const fn of listeners) fn(list);
}

const fail = (message, statusCode = 422) => {
    throw Object.assign(new Error(message), { statusCode });
};

function clean(list, word, value) {
    const meta = WORD_LISTS[list] ?? fail('Daftar kata tidak dikenal');
    const w = String(word ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const v = value == null ? null : String(value).toLowerCase().replace(/\s+/g, ' ').trim();

    if (!w || w.length > 60) fail('Kata harus 1-60 huruf');
    if (meta.pairs && !v) fail('Isi juga artinya (dibaca sebagai apa)');
    if (v && v.length > 60) fail('Arti maksimal 60 huruf');

    return { w, v: meta.pairs ? v : null };
}

export function addWord({ list, word, value = null }) {
    const { w, v } = clean(list, word, value);

    if (get('SELECT 1 FROM word_lists WHERE list = ? AND word = ?', [list, w])) fail(`"${w}" sudah ada di daftar ini`);

    run(`INSERT INTO word_lists (list, word, value, source, created_at) VALUES (?, ?, ?, 'tim', ?)`, [list, w, v, now()]);
    changed(list);

    return wordRows(list).find((r) => r.word === w);
}

export function updateWord(id, { word, value } = {}) {
    const row = get('SELECT * FROM word_lists WHERE id = ?', [Number(id)]) ?? fail('Kata tidak ditemukan', 404);
    const { w, v } = clean(row.list, word ?? row.word, value === undefined ? row.value : value);

    if (w !== row.word && get('SELECT 1 FROM word_lists WHERE list = ? AND word = ?', [row.list, w])) fail(`"${w}" sudah ada di daftar ini`);

    if (row.source === 'bawaan' && w !== row.word) rememberRemoved(db, `word:${row.list}`, row.word);

    run('UPDATE word_lists SET word = ?, value = ? WHERE id = ?', [w, v, row.id]);
    changed(row.list);

    return wordRows(row.list).find((r) => r.id === row.id);
}

export function removeWord(id) {
    const row = get('SELECT * FROM word_lists WHERE id = ?', [Number(id)]) ?? fail('Kata tidak ditemukan', 404);

    if (row.source === 'bawaan') rememberRemoved(db, `word:${row.list}`, row.word);

    run('DELETE FROM word_lists WHERE id = ?', [row.id]);
    changed(row.list);
}

export const forgetWords = () => changed(null);
