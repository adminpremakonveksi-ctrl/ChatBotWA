import { wordSet } from './words.js';

export const INTENTS = [
    'greeting',
    'introduction',
    'product',
    'size_chart',
    'location',
    'shipping',
    'trust',
    'design_reference',
    'moq',
    'no_reference',
    'has_reference',
    'quantity',
    'price',
    'ask_first',
    'ack',
    'human',
    'about_bot',
    'product_unknown',
    'cs_question',
    'image',
    'voice',
    'custom',
    'other',
];

export const SIZE_VARIANTS = ['reguler', 'boxy', 'oversize'];

const NOT_A_NAME = () => wordSet('bukan_nama');

export function cleanName(value) {
    if (typeof value !== 'string' || /[^\p{L}' .-]/u.test(value)) return null;

    const words = value.split(/[\s.]+/).filter(Boolean);

    if (!words.length || words.length > 3 || words.some((word) => NOT_A_NAME().has(word.toLowerCase()))) {
        return null;
    }

    const name = words
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');

    return name.length >= 2 && name.length <= 30 ? name : null;
}

export function cleanOrigin(value) {
    if (typeof value !== 'string') return null;

    const origin = value.replace(/[^\p{L}\p{N} .,'-]/gu, ' ').replace(/\s+/g, ' ').trim();

    return origin.length >= 2 && origin.length <= 60 ? origin : null;
}

export function normaliseResult(result, productKeys) {
    let intent = INTENTS.includes(result?.intent) ? result.intent : 'other';

    const patterns = (Array.isArray(result?.patterns) ? result.patterns : result?.pattern ? [result.pattern] : []).filter((p) => p && Array.isArray(p.bubbles));

    if (intent === 'custom' && !patterns.length) intent = 'other';
    const product = productKeys.includes(result?.product) ? result.product : null;
    const sizeVariant = SIZE_VARIANTS.includes(result?.sizeVariant) ? result.sizeVariant : 'reguler';

    const extras = [...new Set(Array.isArray(result?.extras) ? result.extras : [])].filter(
        (extra) => INTENTS.includes(extra) && extra !== intent && !['greeting', 'introduction', 'other', 'ack', 'ask_first', 'human', 'about_bot', 'product_unknown', 'cs_question', 'image', 'voice'].includes(extra),
    );

    return {
        intent,
        extras,
        product,
        name: cleanName(result?.name),
        origin: cleanOrigin(result?.origin),
        sizeVariant,
        quantity: typeof result?.quantity === 'string' && result.quantity.trim() ? result.quantity.trim().slice(0, 40) : null,
        patterns,
        pattern: intent === 'custom' ? patterns[0] : null,
        csQuestion: Boolean(result?.csQuestion) || result?.intent === 'cs_question',
        isQuestion: Boolean(result?.isQuestion),
        guessed: Boolean(result?.guessed),
        design: ['none', 'ready'].includes(result?.design) ? result.design : null,
        attachments: Array.isArray(result?.attachments) ? result.attachments.filter((x) => x && typeof x.kind === 'string').slice(0, 10) : [],
        text: typeof result?.text === 'string' ? result.text : '',
        source: result?.source ?? 'rules',
    };
}
