import { config } from '../config.js';
import { all, db, get, getSetting, now, run, setSetting } from '../db.js';
import { logger } from '../logger.js';
import { findProduct, normalise } from './classify-rules.js';
import { productKeys } from './products.js';


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

export const MAX_ITEMS_PER_ANSWER = 3;

const log = logger.child({ part: 'catalog' });

const phone = () => getSetting('catalog:phone');

export const productLink = (item, number = phone()) => (number ? `https://wa.me/p/${item.id}/${number}` : null);

export const autoProduct = (item) => findProduct(normalise(`${item.name} ${item.description ?? ''}`));

const override = (id) => getSetting(`catmap:${id}`);

const effectiveProduct = (item) => {
    const chosen = override(item.id);

    if (chosen === 'none') return null;

    return chosen && productKeys().includes(chosen) ? chosen : autoProduct(item);
};

export function catalogOwner(socket = null) {
    if (config.catalog?.phone) return { phone: config.catalog.phone, source: 'pengaturan' };

    const fromLink = String(getSetting('link:katalog') ?? '').match(/wa\.me\/c\/(\d{8,15})/);
    if (fromLink) return { phone: fromLink[1], source: 'link katalog toko' };

    const own = socket?.user?.id ? socket.user.id.split(':')[0].split('@')[0] : getSetting('catalog:phone');

    return own ? { phone: own, source: 'nomor bot' } : null;
}

export async function syncCatalog(socket, { isCurrent = () => true } = {}) {
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
        const guidance = /timed? ?out/i.test(error.message)
            ? 'Permintaan katalog melewati batas waktu. Katalog terakhir tetap dipakai; timeout tidak membuktikan katalog kosong atau akun bukan WhatsApp Business.'
            : 'Periksa nomor pemilik katalog di Media > Katalog WhatsApp Business dan detail error.';
        throw new Error(
            `Katalog nomor +${owner.phone} (${owner.source}) tidak terbaca: ${error.message}. ` +
            guidance,
        );
    }

    const stamp = now();
    if (!isCurrent()) return 0;
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

export function recordSyncError(error) {
    setSetting('catalog:error', String(error?.message ?? error).slice(0, 300));
}

export function catalogLinksFor(product) {
    if (!product || !phone()) return [];

    const isPromo = (item) => /\bpromo\b/i.test(item.name);

    return all('SELECT * FROM catalog_items ORDER BY position')
        .filter((item) => effectiveProduct(item) === product)
        .sort((a, b) => Number(isPromo(b)) - Number(isPromo(a)) || a.position - b.position)
        .slice(0, MAX_ITEMS_PER_ANSWER)
        .map((item) => productLink(item));
}

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
