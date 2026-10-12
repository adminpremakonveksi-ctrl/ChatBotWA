import path from 'node:path';

import { config } from '../config.js';
import { classify } from './classify.js';
import { decide } from './engine.js';
import { media } from './media.js';
import { productName } from './products.js';

const LABEL = { katalog: 'Katalog', 'size-chart': 'Size chart', 'katalog-review': 'Katalog review', promo: 'Pamflet promo' };

/**
 * Try the bot from the console without a phone: same classifier, same flow,
 * same media folder, but nothing is sent and no customer data is touched.
 * Conversations live in memory and vanish on restart.
 */
const conversations = new Map();

export async function simulate(id, { text = '', hasImage = false }) {
    const conversation = conversations.get(id) ?? { step: 'new' };

    const classified = await classify({ text, hasImage, step: conversation.step, knownProduct: conversation.product });
    const { actions, patch } = decide(conversation, classified, media);

    conversations.set(id, { ...conversation, ...patch });

    const replies = actions.flatMap((action) => {
        if (action.type === 'text') return [{ type: 'text', text: action.text }];
        if (action.type === 'handover') return [{ type: 'handover', text: `Diserahkan ke CS (${action.reason}). Bot diam di nomor ini.` }];

        const files = media.files(action.kind, action.product, action.variant);

        // "Katalog Jersey (1/2)" says more to the team than "01.png".
        const label = [LABEL[action.kind] ?? action.kind, action.product && productName(action.product), action.variant && action.variant !== 'reguler' && action.variant]
            .filter(Boolean)
            .join(' ');

        return files.length
            ? files.map((file, i) => ({
                type: 'file',
                text: `${label}${files.length > 1 ? ` (${i + 1}/${files.length})` : ''}`,
                path: path.relative(config.mediaDir, file).replace(/\\/g, '/'),
                image: path.extname(file).toLowerCase() !== '.pdf',
            }))
            : [{ type: 'missing', text: `File ${action.kind} ${action.product ?? ''} belum ada di media/` }];
    });

    return {
        intent: classified.intent,
        extras: classified.extras,
        product: classified.product,
        name: classified.name,
        via: classified.source,
        step: conversations.get(id).step,
        replies,
    };
}

export const resetSimulation = (id) => conversations.delete(id);
