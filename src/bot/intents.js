import { wordSet } from './words.js';

/**
 * What a customer message can mean. The engine maps each to fixed spec text;
 * classifiers only choose among these.
 */
export const INTENTS = [
    'greeting', //         just "halo", "permisi", "malam kak"
    'introduction', //     gives their name and/or origin
    'product', //          wants to make / asks about a product
    'size_chart', //       asks for size chart / sizes
    'location', //         address, shareloc, can I visit
    'shipping', //         where it ships from, can it ship to my city, ongkir
    'trust', //            afraid of scams, is this legit, testimonials
    'design_reference', // asks for design examples / templates / portfolio
    'moq', //              minimum order, can I order just a few
    'no_reference', //     answering "what design?": has none yet
    'has_reference', //    answering "what design?": describes it or sends a picture
    'quantity', //         states how many pieces
    'price', //            asks the price without naming a product
    'ask_first', //        "mau nanya2 dulu": announces a question, asks nothing yet
    'ack', //              "ok", "siap", "makasih": nothing to answer
    'human', //            asks for a person (admin, CS, a phone call): handed over at once
    'about_bot', //        "kamu bot ya?": answered honestly, the bot carries on
    'product_unknown', //  asks for a product the shop does not list (sepatu, mukena)
    'cs_question', //      a clear question only CS can answer (DP, payment, lead time, order status)
    'image', //            a picture with no words, outside the design step
    'voice', //            a voice note (the bot cannot listen)
    'custom', //           matches an answer pattern the team built (carries `pattern`)
    'other', //            anything else - handed to CS
];

export const SIZE_VARIANTS = ['reguler', 'boxy', 'oversize'];

// Words that are never a name (Kamus: "Bukan nama orang").
const NOT_A_NAME = () => wordSet('bukan_nama');

/**
 * A name goes straight into a fixed template ("Halo Kak <nama>"), so it must
 * look like a name: letters only, short, nothing a customer could use to make
 * the bot say something else.
 */
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

/** Normalises whatever a classifier returned into the shape the engine expects. */
export function normaliseResult(result, productKeys) {
    let intent = INTENTS.includes(result?.intent) ? result.intent : 'other';

    // Answer patterns this message triggered, most specific first (also side answers next to another intent).
    const patterns = (Array.isArray(result?.patterns) ? result.patterns : result?.pattern ? [result.pattern] : []).filter((p) => p && Array.isArray(p.bubbles));

    // A pattern answer without a pattern cannot be sent.
    if (intent === 'custom' && !patterns.length) intent = 'other';
    const product = productKeys.includes(result?.product) ? result.product : null;
    const sizeVariant = SIZE_VARIANTS.includes(result?.sizeVariant) ? result.sizeVariant : 'reguler';

    // Further things the same message asked, answered before the main intent.
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
        // "2000 pcs", "2 lusin": the amount as the customer wrote it, for CS.
        quantity: typeof result?.quantity === 'string' && result.quantity.trim() ? result.quantity.trim().slice(0, 40) : null,
        patterns,
        pattern: intent === 'custom' ? patterns[0] : null,
        // The message also asks something only CS can answer ("bisa DP?"), next to its main intent.
        csQuestion: Boolean(result?.csQuestion) || result?.intent === 'cs_question',
        isQuestion: Boolean(result?.isQuestion),
        // The keyword reading rested on a typo guess (the AI double-checks those).
        guessed: Boolean(result?.guessed),
        // "none" (no design yet) / "ready" (they have one) when the message says so.
        design: ['none', 'ready'].includes(result?.design) ? result.design : null,
        // Pictures, files, a location sent with the message: { kind, note } (session.js).
        attachments: Array.isArray(result?.attachments) ? result.attachments.filter((x) => x && typeof x.kind === 'string').slice(0, 10) : [],
        // The message itself: a follow-up answer is stored for CS as written.
        text: typeof result?.text === 'string' ? result.text : '',
        source: result?.source ?? 'rules',
    };
}
