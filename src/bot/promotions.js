import { all, get, now, run } from '../db.js';
import { config } from '../config.js';
import { localDateString } from './schedule.js';
import { getProduct, productName } from './products.js';

const fail = (message, statusCode = 422) => { throw Object.assign(new Error(message), { statusCode }); };
const date = (value) => {
    const v = String(value ?? '').trim();
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) fail('Tanggal promo tidak valid');
    return v;
};
export const listPromotions = () => all('SELECT * FROM promotions ORDER BY id DESC');
export const promotionActive = (p, at = new Date()) => {
    const today = localDateString(at, config.bot.timezone);
    return Boolean(p.enabled && (!p.starts_on || p.starts_on <= today) && (!p.ends_on || p.ends_on >= today));
};
export function savePromotion({ id = null, title, content, product = null, enabled = true, starts_on = null, ends_on = null } = {}) {
    title = String(title ?? '').trim();
    content = String(content ?? '').trim();
    if (!title || title.length > 120) fail('Nama promo wajib diisi, maksimal 120 huruf');
    if (!content || content.length > 4000) fail('Isi promo wajib diisi, maksimal 4000 huruf');
    if (product && !getProduct(product)) fail('Produk promo tidak ditemukan');
    if (typeof enabled !== 'boolean') fail('Status promo harus aktif atau nonaktif');
    const start = date(starts_on), end = date(ends_on);
    if (start && end && end < start) fail('Tanggal selesai harus setelah tanggal mulai');
    if (id) {
        if (!get('SELECT id FROM promotions WHERE id = ?', [id])) fail('Promo tidak ditemukan', 404);
        run('UPDATE promotions SET title = ?, content = ?, product = ?, enabled = ?, starts_on = ?, ends_on = ?, updated_at = ? WHERE id = ?', [title, content, product || null, Number(enabled), start, end, now(), id]);
    } else {
        id = Number(run('INSERT INTO promotions (title, content, product, enabled, starts_on, ends_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [title, content, product || null, Number(enabled), start, end, now(), now()]).lastInsertRowid);
    }
    return get('SELECT * FROM promotions WHERE id = ?', [id]);
}
export const deletePromotion = (id) => run('DELETE FROM promotions WHERE id = ?', [id]);
export function promotionKnowledge({ focus = null, at = new Date() } = {}) {
    return listPromotions().filter((p) => promotionActive(p, at) && (!p.product || !focus || focus.includes(p.product)))
        .map((p) => `- ${p.title}${p.product ? ` [${productName(p.product)}]` : ''}: ${p.content}${p.ends_on ? ` (berlaku sampai ${p.ends_on})` : ''}`).join('\n');
}
