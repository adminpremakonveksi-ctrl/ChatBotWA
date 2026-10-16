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
    'custom', //           matches an answer pattern the team built (carries `pattern`)
    'other', //            anything else - handed to CS
];

export const SIZE_VARIANTS = ['reguler', 'boxy', 'oversize'];

const NOT_A_NAME = new Set([
    'mau', 'mo', 'ingin', 'pengen', 'pgn', 'pingin', 'tanya', 'nanya', 'kak', 'ka', 'kakak', 'min', 'admin',
    'mas', 'mbak', 'mba', 'bu', 'pak', 'dari', 'dr', 'asal', 'di', 'ada', 'lagi', 'bisa', 'boleh', 'sudah',
    'udah', 'belum', 'mau', 'ya', 'yaa', 'iya', 'nih', 'ini', 'itu', 'saya', 'aku', 'sy', 'ak', 'gw', 'gue',
    'butuh', 'perlu', 'cari', 'nyari', 'pesan', 'pesen', 'order', 'bikin', 'buat', 'minta', 'halo', 'hai',
    'hallo', 'permisi', 'selamat', 'malam', 'pagi', 'siang', 'sore', 'tadi', 'yang', 'dan', 'atau', 'juga',
    'mohon', 'tolong', 'info', 'informasi', 'kok', 'apa', 'gimana', 'bagaimana', 'berapa', 'terima', 'kasih',
    'makasih', 'oke', 'ok', 'siap', 'baik', 'sama', 'dengan', 'dgn', 'tidak', 'gak', 'ga', 'nggak', 'enggak',
    'assalamualaikum', 'waalaikumsalam', 'salam', 'kenal',
    // Javanese / Sundanese words that are not names
    'kulo', 'kula', 'badhe', 'bade', 'ajeng', 'arep', 'nggih', 'njih', 'inggih', 'saking', 'seko', 'soko', 'wonten', 'nopo',
    'pinten', 'sampun', 'dereng', 'matur', 'nuwun', 'suwun', 'sugeng', 'dalu', 'enjing', 'sonten', 'punten', 'hoyong',
    'damel', 'takon', 'nyuwun', 'pripun', 'piye', 'mboten', 'ora', 'niki', 'iki', 'mriki', 'mangke', 'riyin', 'ngapunten',
    'monggo', 'mangga', 'sami', 'ten', 'teng', 'neng', 'oke', 'sip', 'mantap', 'makasih',
]);

/**
 * A name goes straight into a fixed template ("Halo Kak <nama>"), so it must
 * look like a name: letters only, short, nothing a customer could use to make
 * the bot say something else.
 */
export function cleanName(value) {
    if (typeof value !== 'string' || /[^\p{L}' .-]/u.test(value)) return null;

    const words = value.split(/[\s.]+/).filter(Boolean);

    if (!words.length || words.length > 3 || words.some((word) => NOT_A_NAME.has(word.toLowerCase()))) {
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
        (extra) => INTENTS.includes(extra) && extra !== intent && !['greeting', 'introduction', 'other', 'ack', 'ask_first'].includes(extra),
    );

    return {
        intent,
        extras,
        product,
        name: cleanName(result?.name),
        origin: cleanOrigin(result?.origin),
        sizeVariant,
        patterns,
        pattern: intent === 'custom' ? patterns[0] : null,
        source: result?.source ?? 'rules',
    };
}
