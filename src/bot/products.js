import { all, db, get, now, run } from '../db.js';
import { rememberRemoved } from '../migrations.js';
import { cleanPhrase, slugify } from '../text.js';

/**
 * Products the bot recognises, stored in the database (seeded from
 * src/seeds.js by the migrations) and fully editable in the console:
 * add, rename, change kind, delete.
 *
 * kind 'catalog' = has a fixed price list, so the bot sends the catalog.
 * kind 'design'  = priced by quantity and design, so the bot asks for a
 *                  design reference instead (SPEK-CHATBOT.md, main flow).
 * sizeChart      = needs a size chart file in Media.
 * questions      = follow-up questions the bot asks one by one once the
 *                  product is known ("kemeja apa?", "ukuran apa saja?").
 *
 * A product's keywords live with all other keywords (custom_keywords,
 * intent 'product'), so "Latih bot" and the classifier see one list.
 */

let cache = null;
const listeners = new Set();

/** Lets other caches (keywords) drop their copy when products change. */
export const onProductsChanged = (fn) => listeners.add(fn);

const changed = () => {
    cache = null;
    for (const fn of listeners) fn();
};

export function listProducts() {
    cache ??= all('SELECT * FROM products ORDER BY position, name').map((row) => ({
        key: row.key,
        name: row.name,
        catalog: row.kind === 'catalog',
        sizeChart: Boolean(row.size_chart),
        builtin: Boolean(row.builtin),
        position: row.position,
        questions: parseStored(row.questions),
    }));

    return cache;
}

function parseStored(value) {
    try {
        const list = JSON.parse(value ?? '[]');
        return Array.isArray(list) ? list.filter((q) => typeof q === 'string' && q.trim()) : [];
    } catch {
        return [];
    }
}

/** A product's follow-up questions, in order. */
export const productQuestions = (key) => getProduct(key)?.questions ?? [];

export const productKeys = () => listProducts().map((p) => p.key);

export const getProduct = (key) => listProducts().find((p) => p.key === key) ?? null;

export const productName = (key) => getProduct(key)?.name ?? key;

export const hasCatalog = (key) => Boolean(getProduct(key)?.catalog);

export const productKeywords = (key) =>
    all(`SELECT phrase FROM custom_keywords WHERE intent = 'product' AND product = ? ORDER BY phrase`, [key]).map((r) => r.phrase);

const fail = (message, statusCode = 422) => {
    throw Object.assign(new Error(message), { statusCode });
};

const parseKeywords = (value) =>
    [...new Set((Array.isArray(value) ? value : String(value ?? '').split(/[\n,]/)).map(cleanPhrase).filter((k) => k.length >= 2 && k.length <= 60))].slice(0, 200);

/** Replaces a product's keywords. A phrase another product or answer already uses is reported, not stolen. */
function setKeywords(key, value) {
    const wanted = parseKeywords(value);
    const taken = [];

    run(`DELETE FROM custom_keywords WHERE intent = 'product' AND product = ?`, [key]);

    for (const phrase of wanted) {
        const owner = get('SELECT intent, product FROM custom_keywords WHERE phrase = ?', [phrase]);

        if (owner) {
            taken.push(`"${phrase}" (sudah dipakai ${owner.product ? `produk ${productName(owner.product)}` : owner.intent})`);
            continue;
        }

        run(`INSERT INTO custom_keywords (phrase, intent, product, source, created_at) VALUES (?, 'product', ?, 'tim', ?)`, [phrase, key, now()]);
    }

    return taken;
}

function validFields(values, current = {}) {
    const name = values.name === undefined ? current.name : String(values.name).trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!name) fail('Nama produk wajib diisi');

    const catalog = values.catalog === undefined ? current.catalog : Boolean(values.catalog);
    const sizeChart = values.sizeChart === undefined ? current.sizeChart : Boolean(values.sizeChart);

    // One question per line (or an array); at most 6, so a customer is not interrogated.
    const questions = values.questions === undefined
        ? current.questions ?? []
        : (Array.isArray(values.questions) ? values.questions : String(values.questions).split('\n'))
            .map((q) => String(q).trim())
            .filter(Boolean);
    if (questions.length > 6) fail('Maksimal 6 pertanyaan lanjutan per produk');
    if (questions.some((q) => q.length > 500)) fail('Satu pertanyaan maksimal 500 huruf');

    return { name, catalog, sizeChart, questions };
}

export function createProduct(values) {
    const { name, catalog, sizeChart, questions } = validFields(values);

    let key = slugify(name) || 'produk';
    for (let i = 2; get('SELECT 1 FROM products WHERE "key" = ?', [key]); i++) key = `${slugify(name)}-${i}`;

    const position = (get('SELECT MAX(position) AS p FROM products')?.p ?? -1) + 1;
    run(
        `INSERT INTO products ("key", name, kind, size_chart, position, builtin, questions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [key, name, catalog ? 'catalog' : 'design', sizeChart ? 1 : 0, position, JSON.stringify(questions), now(), now()],
    );

    const taken = values.keywords === undefined ? [] : setKeywords(key, values.keywords);
    changed();

    return { product: getProduct(key), taken };
}

export function updateProduct(key, values) {
    const current = getProduct(key) ?? fail('Produk tidak ditemukan', 404);
    const { name, catalog, sizeChart, questions } = validFields(values, current);

    run(`UPDATE products SET name = ?, kind = ?, size_chart = ?, questions = ?, updated_at = ? WHERE "key" = ?`, [name, catalog ? 'catalog' : 'design', sizeChart ? 1 : 0, JSON.stringify(questions), now(), key]);

    const taken = values.keywords === undefined ? [] : setKeywords(key, values.keywords);
    changed();

    return { product: getProduct(key), taken };
}

/**
 * Deletes a product with its keywords, its catalog-item matches and its
 * catalog link. Conversations that mentioned it keep the old key as text.
 */
export function deleteProduct(key) {
    const product = getProduct(key) ?? fail('Produk tidak ditemukan', 404);

    // A built-in product the team deleted stays deleted through later updates.
    if (product.builtin) rememberRemoved(db, 'product', key);

    run(`DELETE FROM custom_keywords WHERE intent = 'product' AND product = ?`, [key]);
    run(`DELETE FROM settings WHERE "key" LIKE 'catmap:%' AND value = ?`, [key]);
    run(`DELETE FROM settings WHERE "key" = ?`, [`link:katalog:${key}`]);
    run(`DELETE FROM products WHERE "key" = ?`, [key]);
    changed();
}

/** For tests and imports that write through SQL. */
export const forgetProducts = changed;
