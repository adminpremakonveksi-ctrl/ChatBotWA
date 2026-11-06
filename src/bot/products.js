import { all, db, get, now, run } from '../db.js';
import { rememberRemoved } from '../migrations.js';
import { cleanPhrase, slugify } from '../text.js';


let cache = null;
const listeners = new Set();

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
        info: parseInfo(row.info),
    }));

    return cache;
}

export const INFO_LISTS = ['sebutan', 'model', 'teknik', 'tanya'];
export const INFO_PAIRS = { bahan: 'ket', tidak: 'ganti' };
export const INFO_TEXTS = ['warna', 'ukuran', 'moq', 'catatan'];

const lines = (value) =>
    (Array.isArray(value) ? value : String(value ?? '').split('\n')).map((v) => String(v).trim()).filter(Boolean);

const pairOf = (value, second) => {
    if (value && typeof value === 'object') return { nama: String(value.nama ?? '').trim(), [second]: String(value[second] ?? '').trim() };
    const [nama, ...rest] = String(value).split(':');

    return { nama: nama.trim(), [second]: rest.join(':').trim() };
};

export function cleanInfo(values = {}) {
    const info = {};

    for (const key of INFO_LISTS) info[key] = lines(values[key]).slice(0, 40);
    for (const [key, second] of Object.entries(INFO_PAIRS)) {
        info[key] = (Array.isArray(values[key]) ? values[key] : lines(values[key])).map((v) => pairOf(v, second)).filter((p) => p.nama).slice(0, 40);
    }
    for (const key of INFO_TEXTS) info[key] = String(values[key] ?? '').replace(/\r\n/g, '\n').trim();

    const size = JSON.stringify(info).length;
    if (size > 12000) fail('Data produk terlalu panjang (maksimal sekitar 12.000 huruf)');
    for (const key of INFO_LISTS) if (info[key].some((v) => v.length > 300)) fail('Satu baris maksimal 300 huruf');

    return info;
}

function parseInfo(value) {
    try {
        return cleanInfo(JSON.parse(value ?? '{}'));
    } catch {
        return cleanInfo({});
    }
}

function parseStored(value) {
    try {
        const list = JSON.parse(value ?? '[]');
        return Array.isArray(list) ? list.filter((q) => typeof q === 'string' && q.trim()) : [];
    } catch {
        return [];
    }
}

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

    const questions = values.questions === undefined
        ? current.questions ?? []
        : (Array.isArray(values.questions) ? values.questions : String(values.questions).split('\n'))
            .map((q) => String(q).trim())
            .filter(Boolean);
    if (questions.length > 6) fail('Maksimal 6 pertanyaan lanjutan per produk');
    if (questions.some((q) => q.length > 500)) fail('Satu pertanyaan maksimal 500 huruf');

    const info = values.info === undefined ? current.info ?? cleanInfo({}) : cleanInfo(values.info);

    return { name, catalog, sizeChart, questions, info };
}

export function createProduct(values) {
    const { name, catalog, sizeChart, questions, info } = validFields(values);

    let key = slugify(name) || 'produk';
    for (let i = 2; get('SELECT 1 FROM products WHERE "key" = ?', [key]); i++) key = `${slugify(name)}-${i}`;

    const position = (get('SELECT MAX(position) AS p FROM products')?.p ?? -1) + 1;
    run(
        `INSERT INTO products ("key", name, kind, size_chart, position, builtin, questions, info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [key, name, catalog ? 'catalog' : 'design', sizeChart ? 1 : 0, position, JSON.stringify(questions), JSON.stringify(info), now(), now()],
    );

    const taken = values.keywords === undefined ? [] : setKeywords(key, values.keywords);
    changed();

    return { product: getProduct(key), taken };
}

export function updateProduct(key, values) {
    const current = getProduct(key) ?? fail('Produk tidak ditemukan', 404);
    const { name, catalog, sizeChart, questions, info } = validFields(values, current);

    run(`UPDATE products SET name = ?, kind = ?, size_chart = ?, questions = ?, info = ?, updated_at = ? WHERE "key" = ?`, [name, catalog ? 'catalog' : 'design', sizeChart ? 1 : 0, JSON.stringify(questions), JSON.stringify(info), now(), key]);

    const taken = values.keywords === undefined ? [] : setKeywords(key, values.keywords);
    changed();

    return { product: getProduct(key), taken };
}

export function deleteProduct(key) {
    const product = getProduct(key) ?? fail('Produk tidak ditemukan', 404);

    if (product.builtin) rememberRemoved(db, 'product', key);

    run(`DELETE FROM custom_keywords WHERE intent = 'product' AND product = ?`, [key]);
    run(`DELETE FROM settings WHERE "key" LIKE 'catmap:%' AND value = ?`, [key]);
    run(`DELETE FROM settings WHERE "key" = ?`, [`link:katalog:${key}`]);
    run(`DELETE FROM products WHERE "key" = ?`, [key]);
    changed();
}

export const forgetProducts = changed;
