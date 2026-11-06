import fs from 'node:fs';
import path from 'node:path';

import { config } from '../config.js';
import { getSetting, run, setSetting } from '../db.js';
import { catalogLinksFor, productLink } from './catalog.js';
import { all as allRows } from '../db.js';
import { listProducts } from './products.js';


const EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];

export const MIME = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
};

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function baseName(kind, product, variant) {
    switch (kind) {
        case 'katalog':
            return path.join('katalog', product ?? 'umum');
        case 'size-chart':
            return path.join('size-chart', !variant || variant === 'reguler' ? product : `${product}-${variant}`);
        case 'katalog-review':
            return 'katalog-review';
        case 'promo':
            return path.join('promo', product ?? 'umum');
        case 'pola':
            return path.join('pola', String(product));
        default:
            throw Object.assign(new Error(`Jenis media tidak dikenal: ${kind}`), { statusCode: 422 });
    }
}

const isMedia = (file) => EXTENSIONS.includes(path.extname(file).toLowerCase());

export function sniffType(buffer) {
    if (!buffer || buffer.length < 12) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
    if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
    if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return '.pdf';

    return null;
}

function slotDefinitions() {
    const slot = (kind, product, variant, label, group, { multi = false, optional = false, effect }) => ({
        id: [kind, product ?? '', variant ?? ''].join(':').replace(/:+$/, ''),
        kind,
        product,
        variant,
        label,
        group,
        multi,
        optional,
        effect,
    });

    const products = listProducts();

    return [
        ...products
            .filter((p) => p.catalog)
            .map((p) => slot('katalog', p.key, null, p.name, 'Katalog', { multi: true, effect: 'Dikirim saat pelanggan menanyakan produk ini. Tanpa file, alur tetap jalan.' })),
        slot('katalog', null, null, 'Katalog umum', 'Katalog', { multi: true, effect: 'Dikirim saat pelanggan minta contoh desain tapi belum menyebut produk.' }),
        ...products
            .filter((p) => p.sizeChart)
            .flatMap((p) => [
                slot('size-chart', p.key, 'reguler', p.name, 'Size chart', { effect: 'Tanpa file, pertanyaan size chart produk ini diserahkan ke CS.' }),
                slot('size-chart', p.key, 'boxy', `${p.name} boxy`, 'Size chart', { optional: true, effect: 'Opsional. Tanpa file, dikirim size chart reguler.' }),
                slot('size-chart', p.key, 'oversize', `${p.name} oversize`, 'Size chart', { optional: true, effect: 'Opsional. Tanpa file, dikirim size chart reguler.' }),
            ]),
        slot('katalog-review', null, null, 'Katalog review', 'Lainnya', { multi: true, effect: 'Dikirim saat pelanggan ragu / takut ditipu. Tanpa file, hanya teks.' }),
        slot('promo', 'jersey', null, 'Pamflet promo jersey [9]', 'Lainnya', { multi: true, optional: true, effect: 'Dikirim saat pelanggan menanyakan jersey (langkah [9]). Kosongkan kalau sedang tidak ada promo.' }),
    ];
}

export function createMedia(dir = config.mediaDir) {
    const files = (kind, product = null, variant = null) => {
        if (kind === 'size-chart' && !product) return [];

        const base = path.join(dir, baseName(kind, product, variant));

        if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
            return fs
                .readdirSync(base)
                .filter(isMedia)
                .sort()
                .map((file) => path.join(base, file));
        }

        const candidates = [...EXTENSIONS, ...EXTENSIONS.map((ext) => ext.toUpperCase())];
        const found = candidates.map((ext) => base + ext).find((file) => fs.existsSync(file));

        return found ? [found] : [];
    };


    const ownLink = (kind, product = null, variant = null) => getSetting(`link:${[kind, product, variant].filter(Boolean).join(':')}`);

    const links = (kind, product = null, variant = null) => {
        if (kind !== 'katalog') {
            const own = kind === 'pola' ? null : ownLink(kind, product, variant);

            return own ? [own] : [];
        }

        const own = ownLink(kind, product);
        if (own) return [own];

        const items = catalogLinksFor(product);
        if (items.length) return items;

        if (product && files(kind, product).length) return [];

        const shop = ownLink(kind, null);

        return shop ? [shop] : [];
    };

    const link = (kind, product = null) => links(kind, product)[0] ?? null;

    const has = (kind, product = null, variant = null) => files(kind, product, variant).length > 0 || links(kind, product, variant).length > 0;

    const relative = (file) => path.relative(dir, file).replace(/\\/g, '/');

    const describe = (file) => {
        const ext = path.extname(file).toLowerCase();

        return { path: relative(file), name: path.basename(file), size: fs.statSync(file).size, type: ext === '.pdf' ? 'pdf' : 'image' };
    };

    const slots = () =>
        slotDefinitions().map((slot) => ({
            ...slot,
            files: files(slot.kind, slot.product, slot.variant).map(describe),
            linkable: true,
            link: ownLink(slot.kind, slot.product, slot.variant),
            catalogItems: slot.kind === 'katalog' && slot.product && !ownLink(slot.kind, slot.product) ? catalogLinksFor(slot.product).length : 0,
            fallbackLink: slot.kind === 'katalog' && slot.product && !ownLink(slot.kind, slot.product) && !catalogLinksFor(slot.product).length && files(slot.kind, slot.product).length === 0 ? ownLink('katalog', null) : null,
        }));

    const setLink = (id, value) => {
        const slot = findSlot(id);

        let url = String(value ?? '').trim();

        if (!url) {
            run(`DELETE FROM settings WHERE "key" = ?`, [`link:${slot.id}`]);

            return null;
        }

        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        url = url.replace(/^http:\/\//i, 'https://');

        if (slot.kind !== 'katalog') {
            let parsed = null;
            try {
                parsed = new URL(url);
            } catch {
            }
            if (!parsed || !parsed.hostname.includes('.') || /\s/.test(url)) {
                throw Object.assign(new Error('Link tidak valid. Tempel link lengkap, mis. https://drive.google.com/...'), { statusCode: 422 });
            }

            setSetting(`link:${slot.id}`, url);

            return url;
        }

        if (!/^https:\/\/(wa\.me\/(c|p)\/[\w/-]+|api\.whatsapp\.com\/[\w?=&/.-]+)$/i.test(url)) {
            throw Object.assign(new Error('Tempel link katalog WhatsApp, mis. https://wa.me/c/6281234567890'), { statusCode: 422 });
        }

        setSetting(`link:${slot.id}`, url);

        return url;
    };

    const findSlot = (id) => {
        const slot = slotDefinitions().find((s) => s.id === id);

        if (!slot) throw Object.assign(new Error('Tempat file tidak dikenal'), { statusCode: 404 });

        return slot;
    };

    const catalogItemLinks = (ids = []) => {
        const byId = new Map(allRows('SELECT * FROM catalog_items').map((item) => [item.id, item]));

        return ids.map((id) => byId.get(String(id))).filter(Boolean).map((item) => productLink(item)).filter(Boolean);
    };

    const savePattern = (patternId, buffer) => saveInto({ kind: 'pola', product: String(patternId), variant: null, multi: true }, buffer);

    const save = (id, buffer) => saveInto(findSlot(id), buffer);

    const saveInto = (slot, buffer) => {
        const ext = sniffType(buffer);

        if (!ext) throw Object.assign(new Error('Hanya gambar JPG, PNG, WEBP, atau PDF'), { statusCode: 415 });
        if (buffer.length > MAX_UPLOAD_BYTES) throw Object.assign(new Error('File lebih dari 15 MB'), { statusCode: 413 });

        const base = path.join(dir, baseName(slot.kind, slot.product, slot.variant));
        fs.mkdirSync(path.dirname(base), { recursive: true });

        if (!slot.multi) {
            for (const old of files(slot.kind, slot.product, slot.variant)) fs.rmSync(old, { force: true });
            if (fs.existsSync(base) && fs.statSync(base).isDirectory()) fs.rmSync(base, { recursive: true, force: true });

            fs.writeFileSync(base + ext, buffer);

            return base + ext;
        }

        const existing = files(slot.kind, slot.product, slot.variant);

        if (existing.length === 1 && !(fs.existsSync(base) && fs.statSync(base).isDirectory())) {
            fs.mkdirSync(base, { recursive: true });
            fs.renameSync(existing[0], path.join(base, `01${path.extname(existing[0]).toLowerCase()}`));
        }

        fs.mkdirSync(base, { recursive: true });

        const numbers = fs.readdirSync(base).map((name) => parseInt(name, 10)).filter(Number.isFinite);
        const next = String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(2, '0');
        const target = path.join(base, next + ext);

        fs.writeFileSync(target, buffer);

        return target;
    };

    const resolve = (rel) => {
        const target = path.resolve(dir, String(rel ?? ''));
        const inside = path.relative(dir, target);

        if (!rel || inside.startsWith('..') || path.isAbsolute(inside) || !isMedia(target) || !fs.existsSync(target)) {
            throw Object.assign(new Error('File tidak ditemukan'), { statusCode: 404 });
        }

        return target;
    };

    const remove = (rel) => {
        const target = resolve(rel);
        fs.rmSync(target, { force: true });

        const parent = path.dirname(target);
        if (parent !== dir && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
    };

    const checklist = () =>
        slots()
            .filter((slot) => !slot.optional)
            .map((slot) => ({
                label: slot.group === 'Katalog' && slot.product ? `Katalog ${slot.label}` : slot.group === 'Size chart' ? `Size chart ${slot.label}` : slot.label,
                expected: `${baseName(slot.kind, slot.product, slot.variant).replace(/\\/g, '/')}.pdf|jpg|png`,
                ok: slot.files.length > 0 || Boolean(slot.link || slot.fallbackLink || slot.catalogItems),
                effect: slot.effect,
            }));

    return { files, has, link, links, catalogItemLinks, slots, setLink, save, savePattern, resolve, remove, checklist };
}

export const media = createMedia();
