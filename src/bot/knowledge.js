import { all, get, now, run } from '../db.js';
import { promotionKnowledge } from './promotions.js';
import { INFO_PAIRS, listProducts } from './products.js';

/**
 * What the bot knows about the shop (AI chat mode), all written by the team
 * in the console and stored in SQLite:
 *
 *  - Info toko: topics with an answer ("Pembayaran & DP": "DP 50% ..."),
 *  - Tanya-jawab: questions customers ask and the shop's answer, general or
 *    for one product,
 *  - per product (halaman Produk): names, models, bahan, teknik done and NOT
 *    done, colours, sizes, minimum order, what to ask, notes (products.js),
 *  - current promotions, managed from the Promo page.
 *
 * The AI answers only from this. A topic left empty is "not told yet".
 */

const fail = (message, statusCode = 422) => {
    throw Object.assign(new Error(message), { statusCode });
};

const text = (value, max, label) => {
    const clean = String(value ?? '').replace(/\r\n/g, '\n').trim();
    if (clean.length > max) fail(`${label} maksimal ${max} huruf`);

    return clean;
};

/* ------------------------------------------------------------- Info toko --- */

export const listTopics = () => all('SELECT id, title, content, position FROM store_info ORDER BY position, id');

export function saveTopic({ id = null, title, content } = {}) {
    const t = text(title, 120, 'Judul');
    if (!t) fail('Judul wajib diisi');
    const c = text(content, 4000, 'Isi');

    if (id) {
        if (!get('SELECT 1 FROM store_info WHERE id = ?', [id])) fail('Topik tidak ditemukan', 404);
        run('UPDATE store_info SET title = ?, content = ?, updated_at = ? WHERE id = ?', [t, c, now(), id]);

        return get('SELECT id, title, content, position FROM store_info WHERE id = ?', [id]);
    }

    const position = (get('SELECT MAX(position) AS p FROM store_info')?.p ?? -1) + 1;
    const { lastInsertRowid } = run('INSERT INTO store_info (title, content, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [t, c, position, now(), now()]);

    return get('SELECT id, title, content, position FROM store_info WHERE id = ?', [lastInsertRowid]);
}

export function deleteTopic(id) {
    run('DELETE FROM store_info WHERE id = ?', [id]);
}

/** Moves a topic one place up (-1) or down (+1). */
export function moveTopic(id, by) {
    const list = listTopics();
    const i = list.findIndex((t) => t.id === Number(id));
    const j = i + Math.sign(by);
    if (i < 0 || j < 0 || j >= list.length) return listTopics();

    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((t, position) => run('UPDATE store_info SET position = ? WHERE id = ?', [position, t.id]));

    return listTopics();
}

/* ----------------------------------------------------------- Tanya-jawab --- */

export const listFaq = () => all('SELECT id, product, question, answer, position FROM faq ORDER BY position, id');

export function saveFaq({ id = null, product = null, question, answer } = {}) {
    const q = text(question, 500, 'Pertanyaan');
    const a = text(answer, 2000, 'Jawaban');
    if (!q || !a) fail('Pertanyaan dan jawaban wajib diisi');
    const p = product && listProducts().some((x) => x.key === product) ? product : null;

    if (id) {
        if (!get('SELECT 1 FROM faq WHERE id = ?', [id])) fail('Tanya-jawab tidak ditemukan', 404);
        run('UPDATE faq SET product = ?, question = ?, answer = ?, updated_at = ? WHERE id = ?', [p, q, a, now(), id]);

        return get('SELECT id, product, question, answer, position FROM faq WHERE id = ?', [id]);
    }

    const position = (get('SELECT MAX(position) AS p FROM faq')?.p ?? -1) + 1;
    const { lastInsertRowid } = run('INSERT INTO faq (product, question, answer, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [p, q, a, position, now(), now()]);

    return get('SELECT id, product, question, answer, position FROM faq WHERE id = ?', [lastInsertRowid]);
}

export function deleteFaq(id) {
    run('DELETE FROM faq WHERE id = ?', [id]);
}

/* --------------------------------------------------- what the AI is told --- */

const bullet = (label, value) => (value ? `  ${label}: ${value}` : null);

function productBlock(p, sendable) {
    const i = p.info;
    const pair = (list, key, joiner) => list.map((x) => (x[key] ? `${x.nama} ${joiner} ${x[key]}` : x.nama)).join('; ');
    const rows = [
        `- ${p.name} [kode: ${p.key}]`,
        bullet('nama lain', i.sebutan.join(', ')),
        bullet('model', i.model.join(', ')),
        bullet('bahan', pair(i.bahan, INFO_PAIRS.bahan, '→')),
        bullet('teknik yang DILAYANI', i.teknik.join(', ')),
        bullet('teknik yang TIDAK dilayani (tawarkan gantinya)', pair(i.tidak, INFO_PAIRS.tidak, '→ ganti dengan')),
        bullet('warna', i.warna),
        bullet('ukuran', i.ukuran),
        bullet('minimal order', i.moq),
        bullet('yang perlu ditanyakan sebelum penawaran', i.tanya.join(', ')),
        bullet('catatan', i.catatan),
        bullet('file yang bisa dikirim', sendable.join(', ')),
    ];
    const told = rows.slice(1, -1).some(Boolean);

    return [...rows, told ? null : '  (detail produk ini belum diisi toko)'].filter(Boolean).join('\n');
}

/** One line for a product that is not being discussed: enough to recognise it and answer "do you make X?". */
const productLine = (p) => `- ${p.name} [kode: ${p.key}]${p.info.sebutan.length ? ` (nama lain: ${p.info.sebutan.join(', ')})` : ''}`;

/**
 * Everything the bot may say, as one block for the AI. `media.has` decides
 * which files exist, so the AI only offers what can really be sent.
 *
 * `focus`: the product keys being discussed. Those get every detail and their
 * own Q&A; the others one line each, so the AI does not mix products up (a
 * long list buries what matters). No focus: every product in full.
 */
export function knowledgeBlock(media, { focus = null, at = new Date() } = {}) {
    const products = listProducts();
    const full = (p) => !focus || focus.includes(p.key);
    const sendable = (key) => [
        media?.has?.('katalog', key) && 'katalog',
        media?.has?.('size-chart', key) && 'size chart',
    ].filter(Boolean);

    const topics = listTopics()
        .map((t) => `- ${t.title}: ${t.content || '(belum diisi toko: jawab akan ditanyakan ke CS)'}`)
        .join('\n');

    const faq = listFaq()
        .filter((f) => !f.product || !focus || focus.includes(f.product))
        .map((f) => `- T: ${f.question}${f.product ? ` [produk: ${products.find((p) => p.key === f.product)?.name ?? f.product}]` : ''}\n  J: ${f.answer}`)
        .join('\n');

    const shown = products.filter(full);
    const others = products.filter((p) => !full(p));
    const productText = [
        shown.map((p) => productBlock(p, sendable(p.key))).join('\n'),
        others.length && `${shown.length ? 'Produk lain (detailnya diberikan kalau pelanggan menanyakannya):\n' : 'Detail tiap produk diberikan setelah pelanggan menyebut produknya:\n'}${others.map(productLine).join('\n')}`,
    ]
        .filter(Boolean)
        .join('\n');

    const promotions = promotionKnowledge({ focus, at });

    return [
        `INFO TOKO:\n${topics || '(belum ada)'}`,
        `PRODUK (hanya ini yang dibuat toko):\n${productText || '(belum ada)'}`,
        faq && `TANYA-JAWAB DARI TOKO:\n${faq}`,
        `PROMO RESMI AKTIF:\n${promotions || '(tidak ada promo aktif untuk produk ini; jangan menawarkan promo)'}`,
        media?.has?.('katalog', null) && 'Katalog seluruh toko bisa dikirim (jenis "katalog", produk kosong).',
    ]
        .filter(Boolean)
        .join('\n\n');
}
