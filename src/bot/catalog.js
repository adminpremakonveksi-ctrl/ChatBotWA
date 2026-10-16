import { config } from '../config.js';
import { all, db, get, getSetting, now, run, setSetting } from '../db.js';
import { logger } from '../logger.js';
import { findProduct, normalise } from './classify-rules.js';
import { productKeys } from './products.js';

/**
 * The bot number's own WhatsApp Business catalog.
 *
 * Synced from WhatsApp, each item is matched to one of the bot's products by
 * its name and description ("Jersey Basket" -> jersey); the team can correct
 * a match or exclude an item in the console. When a customer asks about a
 * product, the bot sends links to its matching items (wa.me/p/<id>/<phone>)
 * instead of pictures. Prices shown by WhatsApp are the catalog's own fixed
 * prices; the bot never computes one.
 */

db.exec(`
CREATE TABLE IF NOT EXISTS catalog_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    position INTEGER,
    updated_at TEXT
);
`);

// How many catalog items one answer may carry; more reads as spam.
export const MAX_ITEMS_PER_ANSWER = 3;

const log = logger.child({ part: 'catalog' });

const phone = () => getSetting('catalog:phone');

export const productLink = (item, number = phone()) => (number ? `https://wa.me/p/${item.id}/${number}` : null);

/** The product an item was matched to from its own words, or null. */
export const autoProduct = (item) => findProduct(normalise(`${item.name} ${item.description ?? ''}`));

/** Team correction: a product key, 'none' (never send), or null (use the automatic match). */
const override = (id) => getSetting(`catmap:${id}`);

const effectiveProduct = (item) => {
    const chosen = override(item.id);

    if (chosen === 'none') return null;

    return chosen && productKeys().includes(chosen) ? chosen : autoProduct(item);
};

/**
 * Reads the whole catalog through a connected Baileys socket and replaces the
 * stored copy. Hidden items are left out. Returns how many items were stored.
 */
/**
 * Whose catalog to read. The bot's number need not be the shop's WhatsApp
 * Business number that owns the catalog (a client linked 0813..., the
 * catalog lives on 0819...). In order: the number set in the console, the
 * number in the shop catalog link (wa.me/c/<number>), the bot's own number.
 */
export function catalogOwner(socket = null) {
    if (config.catalog?.phone) return { phone: config.catalog.phone, source: 'pengaturan' };

    const fromLink = String(getSetting('link:katalog') ?? '').match(/wa\.me\/c\/(\d{8,15})/);
    if (fromLink) return { phone: fromLink[1], source: 'link katalog toko' };

    const own = socket?.user?.id ? socket.user.id.split(':')[0].split('@')[0] : getSetting('catalog:phone');

    return own ? { phone: own, source: 'nomor bot' } : null;
}

export async function syncCatalog(socket) {
    if (!socket?.user?.id) throw new Error('WhatsApp belum tersambung');

    const owner = catalogOwner(socket);
    const jid = `${owner.phone}@s.whatsapp.net`;

    const items = [];
    let cursor;

    try {
        for (let page = 0; page < 20; page++) {
            const { products, nextPageCursor } = await socket.getCatalog({ jid, limit: 50, cursor });

            items.push(...products.filter((p) => !p.isHidden));

            if (!nextPageCursor || !products.length) break;
            cursor = nextPageCursor;
        }
    } catch (error) {
        throw new Error(
            `Katalog nomor +${owner.phone} (${owner.source}) tidak terbaca: ${error.message}. ` +
            'Pastikan nomor itu WhatsApp Business, katalognya berisi produk, dan nomornya benar (Media > Katalog WhatsApp Business).',
        );
    }

    const stamp = now();
    const save = db.transaction(() => {
        run('DELETE FROM catalog_items');
        items.forEach((p, position) =>
            run(
                `INSERT INTO catalog_items (id, name, description, image_url, position, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
                [String(p.id), p.name ?? '', p.description ?? '', p.imageUrls?.requested ?? p.imageUrls?.original ?? null, position, stamp],
            ),
        );
    });
    save();

    setSetting('catalog:phone', owner.phone);
    setSetting('catalog:synced_at', stamp);
    setSetting('catalog:error', '');
    log.info({ items: items.length }, 'katalog WhatsApp disinkronkan');

    return items.length;
}

/** Remembers why a sync failed, e.g. the number is not a WhatsApp Business account. */
export function recordSyncError(error) {
    setSetting('catalog:error', String(error?.message ?? error).slice(0, 300));
}

/** Links for a product's matching catalog items, in catalog order, at most MAX_ITEMS_PER_ANSWER. */
export function catalogLinksFor(product) {
    if (!product || !phone()) return [];

    // Promos first, so a cap of three never hides the current offer; then catalog order.
    const isPromo = (item) => /\bpromo\b/i.test(item.name);

    return all('SELECT * FROM catalog_items ORDER BY position')
        .filter((item) => effectiveProduct(item) === product)
        .sort((a, b) => Number(isPromo(b)) - Number(isPromo(a)) || a.position - b.position)
        .slice(0, MAX_ITEMS_PER_ANSWER)
        .map((item) => productLink(item));
}

/** Everything the console's catalog section shows. */
export function catalogStatus() {
    const items = all('SELECT * FROM catalog_items ORDER BY position').map((item) => ({
        ...item,
        auto: autoProduct(item),
        override: override(item.id),
        product: effectiveProduct(item),
        link: productLink(item),
    }));

    return {
        items,
        phone: phone(),
        syncedAt: getSetting('catalog:synced_at'),
        error: getSetting('catalog:error') || null,
        maxPerAnswer: MAX_ITEMS_PER_ANSWER,
    };
}

export function setItemProduct(id, product) {
    if (!get('SELECT 1 FROM catalog_items WHERE id = ?', [String(id)])) {
        throw Object.assign(new Error('Item katalog tidak ditemukan; sinkronkan dulu'), { statusCode: 404 });
    }

    if (product === '' || product == null) {
        run(`DELETE FROM settings WHERE "key" = ?`, [`catmap:${id}`]);

        return;
    }

    if (product !== 'none' && !productKeys().includes(product)) {
        throw Object.assign(new Error('Produk tidak dikenal'), { statusCode: 422 });
    }

    setSetting(`catmap:${id}`, product);
}
