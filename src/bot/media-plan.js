import { productName } from './products.js';
import { replies } from './replies.js';

export const isSizeQuestion = (text) => /\bukuran(?:nya)?\b|\bsize(?:nya)?\b/i.test(String(text ?? ''));

/** Shared by both modes. A requested variant falls back to the regular chart. */
export function sizeChartActions(media, product, variant = 'reguler') {
    if (!product) return [{ type: 'text', text: replies.sizeChartWhich() }];
    const found = [...new Set([variant || 'reguler', 'reguler', null])]
        .find((v) => media?.has?.('size-chart', product, v));
    if (found === undefined) return [{ type: 'text', text: replies.sizeChartMissing(productName(product)) }];
    return [
        { type: 'media', kind: 'size-chart', product, variant: found },
        { type: 'text', text: replies.sizeChartNote() },
    ];
}
