import { all, db, get, now, run } from '../db.js';
import { rememberRemoved } from '../migrations.js';
import { cleanPhrase } from '../text.js';
import { onProductsChanged, productKeys } from './products.js';
import { onWordsChanged } from './words.js';


export { cleanPhrase };

export const TEACHABLE = ['product', 'size_chart', 'design_reference', 'no_reference', 'has_reference', 'quantity', 'greeting', 'ask_first', 'ack', 'price', 'human', 'about_bot', 'cs_question'];

let cache = null;
const forget = () => {
    cache = null;
};
onProductsChanged(forget);
onWordsChanged(forget);

export function customKeywords() {
    cache ??= all('SELECT id, phrase, intent, product, source, created_at FROM custom_keywords ORDER BY phrase');

    return cache;
}

const fail = (message, statusCode = 422) => {
    throw Object.assign(new Error(message), { statusCode });
};

export function addKeyword({ phrase, intent, product = null }) {
    const clean = cleanPhrase(phrase);

    if (clean.length < 2 || clean.length > 60) fail('Kata kunci harus 2-60 huruf');
    if (!TEACHABLE.includes(intent)) fail('Maksud tidak dikenal');
    if (intent === 'product' && !productKeys().includes(product)) fail('Pilih produknya');

    run(
        `INSERT INTO custom_keywords (phrase, intent, product, source, created_at) VALUES (?, ?, ?, 'tim', ?)
         ON CONFLICT(phrase) DO UPDATE SET intent = excluded.intent, product = excluded.product`,
        [clean, intent, intent === 'product' ? product : null, now()],
    );
    forget();

    return clean;
}

export function updateKeyword(id, { phrase, intent, product = null }) {
    const row = get('SELECT * FROM custom_keywords WHERE id = ?', [Number(id)]) ?? fail('Kata kunci tidak ditemukan', 404);
    const clean = phrase === undefined ? row.phrase : cleanPhrase(phrase);
    const target = intent ?? row.intent;
    const targetProduct = target === 'product' ? (product ?? row.product) : null;

    if (clean.length < 2 || clean.length > 60) fail('Kata kunci harus 2-60 huruf');
    if (!TEACHABLE.includes(target)) fail('Maksud tidak dikenal');
    if (target === 'product' && !productKeys().includes(targetProduct)) fail('Pilih produknya');
    if (get('SELECT 1 FROM custom_keywords WHERE phrase = ? AND id <> ?', [clean, row.id])) fail(`"${clean}" sudah ada`);

    if (row.source === 'bawaan' && (clean !== row.phrase || target !== row.intent)) rememberRemoved(db, 'keyword', row.phrase);

    run('UPDATE custom_keywords SET phrase = ?, intent = ?, product = ? WHERE id = ?', [clean, target, targetProduct, row.id]);
    forget();

    return clean;
}

export function removeKeyword(id) {
    const row = get('SELECT phrase, source FROM custom_keywords WHERE id = ?', [Number(id)]);
    if (row?.source === 'bawaan') rememberRemoved(db, 'keyword', row.phrase);

    run('DELETE FROM custom_keywords WHERE id = ?', [Number(id)]);
    forget();
}

export const forgetKeywords = forget;
