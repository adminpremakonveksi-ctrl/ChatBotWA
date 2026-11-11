import { orderStatus, readOrder } from './chat.js';
import { getProduct, productName } from './products.js';

const AMOUNT = /jumlah|pcs|qty|banyak/i;
const WAITING = /^\s*menyusul\b/i;

const notesOf = (conversation) => {
    try {
        const list = JSON.parse(conversation?.notes ?? '[]');

        return Array.isArray(list) ? list.map(String) : [];
    } catch {
        return [];
    }
};

export function handoverBrief(conversation) {
    const order = readOrder(conversation);
    const note = notesOf(conversation).find((n) => !n.startsWith('Pesanan ')) ?? '';

    if (!order.produk && !note) return null;

    const entries = Object.entries(order.jawaban);
    const amount = entries.find(([hal]) => AMOUNT.test(hal))?.[1];
    const known = getProduct(order.produk) ? productName(order.produk) : order.produk;
    const status = order.produk ? orderStatus(order) : { open: [], waiting: [] };

    return {
        want: order.produk ? `${known}${amount ? ` · ${amount}` : ''}` : 'Produk belum disebut',
        have: entries.filter(([, isi]) => !WAITING.test(isi)).map(([hal, isi]) => ({ hal, isi: String(isi) })),
        missing: [...status.open, ...status.waiting],
        note,
    };
}
