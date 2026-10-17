import { cleanName, normaliseResult } from './intents.js';
import { customKeywords } from './keywords.js';
import { activePatterns } from './patterns.js';
import { productKeys } from './products.js';
import { normalise, SHORTHAND } from '../text.js';

// Kept here too: callers import them from the classifier.
export { normalise, SHORTHAND };

/**
 * Offline keyword classifier. Always available, costs nothing, and is the
 * fallback whenever the AI classifier is off or fails.
 *
 * It will never cover every way customers phrase things - that is the reason
 * the AI classifier exists - so anything it does not recognise becomes
 * "other", which the engine hands to CS.
 */


const containsWord = (haystack, needles) => needles.some((needle) => haystack.includes(` ${needle} `));

/**
 * Keywords match at the start of a word, so "ongkir" also catches "ongkirnya".
 * Keywords ending in a digit must match whole, or "cuma 1" would catch "cuma 100".
 */
const mentions = (haystack, needles) =>
    needles.some((needle) => (/\d$/.test(needle) ? haystack.includes(` ${needle} `) : haystack.includes(` ${needle}`)));

const containsPrefix = (haystack, prefixes) => prefixes.some((prefix) => haystack.includes(` ${prefix}`));

/** Damerau-Levenshtein distance (adjacent swaps count as one edit: "jresey"). */
export function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);

    for (let j = 1; j <= b.length; j++) d[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);

            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
        }
    }

    return d[a.length][b.length];
}

/**
 * Typo tolerance for single-word keywords of 5+ letters: one slip allowed
 * ("hodie", "lanyrd", "lokais"), two for long words ("portofolio").
 * Short words are exact only - "kaos" vs "kamu" must never match.
 */
const nearly = (token, keyword) => {
    if (keyword.length < 5 || keyword.includes(' ') || /\d/.test(keyword) || token.length < 4) return false;

    const allowed = keyword.length >= 9 ? 2 : 1;

    // Also compare the token's head, so suffixes survive: "hodienya" -> "hodie".
    return editDistance(token, keyword) <= allowed || (token.length > keyword.length && editDistance(token.slice(0, keyword.length), keyword) <= allowed);
};

const tokens = (haystack) => haystack.trim().split(' ').filter(Boolean);


// Words that say "I want to order", so "mau bikin jersey, minimal berapa?" also starts the jersey flow.
const ORDER_WORDS = ['mau', 'mo ', 'ingin', 'pengen', 'pgn', 'pingin', 'bikin', 'buat', 'pesan', 'pesen', 'order', 'produksi', 'harga', 'cetak', 'butuh', 'nyari', 'cari'];

// Built-in flow answers that are not answer patterns, in the order sent when
// one message asks several. (Lokasi, Pengiriman, Ragu, Minimal order are patterns.)
const FAQ_ORDER = ['size_chart', 'design_reference'];

/** How well one keyword matches: exact at a word start beats a typo; 0 = no match. */
const keywordScore = (normalised, keyword) => {
    const exact = /\d$/.test(keyword) ? normalised.includes(` ${keyword} `) : normalised.includes(` ${keyword}`);

    return exact ? keyword.length + 1 : tokens(normalised).some((token) => !NOT_FUZZY.has(token) && nearly(token, keyword)) ? keyword.length : 0;
};

/** The keywords of a list that this message hits. */
const hitsOf = (normalised, keywords) => keywords.filter((keyword) => keywordScore(normalised, keyword) > 0);

/**
 * Every active answer pattern this message triggers, most specific match
 * first, with the keywords that triggered it.
 */
export function findPatterns(normalised) {
    const found = [];

    for (const pattern of activePatterns()) {
        const score = Math.max(0, ...pattern.keywords.map((keyword) => keywordScore(normalised, keyword)));

        if (score) found.push({ pattern, score, hits: hitsOf(normalised, pattern.keywords) });
    }

    return found.sort((a, b) => b.score - a.score);
}

/** The single best pattern for a message, or null ("Coba kalimat" in the console). */
export const findPattern = (normalised) => findPatterns(normalised)[0]?.pattern ?? null;

/** Keywords of a built-in answer: all in the database (seeded, editable, deletable). */
const keywordsFor = (intent) => customKeywords().filter((k) => k.intent === intent).map((k) => k.phrase);


const QUANTITY = /(?:^|\s)(\d{1,6})\s*(?:pcs|pc|psc|biji|buah|bh|potong|ptg|lembar|lbr|set|pasang|orang|org|stel|setel|lusin|kodi|an|anan)?(?:\s|$)/;
const QUANTITY_WORDS = [' selusin ', ' lusin', ' sekodi ', ' kodi', ' seratus', ' ratusan', ' puluhan', ' sepuluh ', ' dua puluh', ' tiga puluh', ' lima puluh'];

const SIZE_VARIANT = (text) => {
    if (containsPrefix(text, ['oversize', 'over size', 'oversized'])) return 'oversize';
    if (containsPrefix(text, ['boxy'])) return 'boxy';

    return 'reguler';
};

export function findProduct(text) {
    let best = null;

    // Product keywords live in the database with the rest (seeded + team), only for products that still exist.
    const known = new Set(productKeys());
    const candidates = customKeywords()
        .filter((k) => k.intent === 'product' && known.has(k.product))
        .map((k) => ({ key: k.product, keyword: k.phrase, taught: k.source === 'tim' }));

    for (const { key, keyword, taught: isTaught } of candidates) {
        if (text.includes(` ${keyword} `) || (text.includes(` ${keyword}`) && keyword.length >= 5)) {
            // Prefer the longest match: "kaos bola" is jersey, not kaos. Team-taught phrases win ties.
            const score = keyword.length + (isTaught ? 0.5 : 0);

            if (!best || score > best.score) best = { key, score };
        }
    }

    if (best) return best.key;

    // No exact hit: allow a typo on single-word product names.
    for (const token of tokens(text)) {
        if (NOT_FUZZY.has(token)) continue;

        const hit = candidates.find(({ keyword }) => nearly(token, keyword));
        if (hit) return hit.key;
    }

    return null;
}

// Indonesian, Javanese ("kulo Budi saking Purworejo", "nami kula Sri") and Sundanese ("abdi Asep ti Garut").
const LEAD = '(?:(?:ini\\s+)?(?:dengan|dgn|kalih|kaliyan)|(?:perkenalkan|kenalin|kenalkan),?\\s+(?:nama\\s+)?(?:saya|aku|kami)|saya|aku|sy|ak|gw|gue|ini|namaku|nama\\s+(?:saya|aku|sy)|nama|perkenalkan|kenalin|nami\\s+(?:kulo|kula|abdi)|kulo|kula|abdi|asmanipun|jenengku|jenenge\\s+aku|aranku)';
const NAME = "([\\p{L}']+(?:\\s+[\\p{L}']+){0,2}?)";
const ORIGIN_LEAD = '(?:dari|dr|asal(?:\\s+dari)?|tinggal\\s+di|domisili|di|saking|seko|soko|teko|ti|ten|teng|neng|nang)';
const STOP = '(?=\\s+(?:mau|mo|ingin|pengen|pgn|kak|min|ya|yaa|nih|mohon|izin|ijin|tanya|nanya|butuh|perlu|pesan|pesen|order|bikin|buat|minta|kalau|kalo|untuk|utk|ada|badhe|bade|ajeng|arep|hoyong|nyuwun|takon|damel|wonten|mas|mbak|mba|pak|bu|nggih|njih)\\b|\\s*$)';

/** Pulls a name and origin out of "saya Budi dari Jogja", "Budi, Magelang", ... */
export function findIntroduction(raw, { lenient = false } = {}) {
    const text = String(raw ?? '').replace(/[!?]+/g, ' ').replace(/\s+/g, ' ').trim();

    let name = null;
    let origin = null;

    const lead = new RegExp(`(?:^|[\\s,.])${LEAD}\\s+(?:kak\\s+|mas\\s+|mbak\\s+|mba\\s+|bu\\s+|pak\\s+|ibu\\s+|bapak\\s+)?${NAME}(?=\\s+${ORIGIN_LEAD}\\b|\\s*[,.]|${STOP})`, 'iu');
    const leadMatch = text.match(lead);

    if (leadMatch) {
        name = leadMatch[1];
    }

    const originMatch = text.match(new RegExp(`(?:^|[\\s,.])${ORIGIN_LEAD}\\s+([\\p{L}\\p{N} .'-]+?)(?=\\s*[,.]|${STOP})`, 'iu'));

    if (originMatch && (name || lenient)) {
        origin = originMatch[1];
    }

    if (!name && lenient) {
        // Replying to "ini dengan kak siapa dan darimana ya?" people often
        // answer bare: "Budi", "Budi dari Jogja", "Budi, Magelang".
        const bare = text.match(new RegExp(`^${NAME}(?:\\s*,\\s*|\\s+${ORIGIN_LEAD}\\s+)([\\p{L}\\p{N} .'-]+)$`, 'iu'));

        if (bare) {
            name = bare[1];
            origin = bare[2];
        } else if (/^[\p{L}' ]+$/u.test(text) && text.split(' ').length <= 3) {
            // "budi jogja": a known place at the end is the origin, not a surname.
            const words = text.split(' ');
            const last = words.at(-1).toLowerCase();

            if (words.length >= 2 && PLACES.has(last)) {
                name = words.slice(0, -1).join(' ');
                origin = words.at(-1);
            } else {
                name = text;
            }
        }
    }

    return { name, origin };
}

// Places customers often name bare ("budi jogja"); around Purworejo first, then big cities.
const PLACES = new Set([
    'purworejo', 'kutoarjo', 'kebumen', 'magelang', 'wonosobo', 'temanggung', 'jogja', 'yogya', 'yogyakarta', 'jogjakarta', 'sleman',
    'bantul', 'kulonprogo', 'wates', 'gunungkidul', 'klaten', 'solo', 'surakarta', 'semarang', 'salatiga', 'kendal', 'banjarnegara',
    'purbalingga', 'purwokerto', 'banyumas', 'cilacap', 'kebumen', 'gombong', 'muntilan', 'mungkid', 'boyolali', 'sragen', 'karanganyar',
    'sukoharjo', 'wonogiri', 'pati', 'kudus', 'jepara', 'demak', 'rembang', 'blora', 'grobogan', 'pekalongan', 'batang', 'pemalang',
    'tegal', 'brebes', 'jakarta', 'bandung', 'surabaya', 'malang', 'bogor', 'depok', 'bekasi', 'tangerang', 'cirebon', 'madiun',
    'kediri', 'ngawi', 'ponorogo', 'pacitan', 'medan', 'makassar', 'palembang', 'lampung', 'bali', 'denpasar', 'balikpapan', 'samarinda',
    'pontianak', 'banjarmasin', 'manado', 'padang', 'pekanbaru', 'batam', 'jambi', 'bengkulu', 'aceh', 'ambon', 'jayapura', 'kupang', 'mataram',
]);

// Everyday words a product name must never be "corrected" into ("baik" is not "batik").
const NOT_FUZZY = new Set([
    'baik', 'kasih', 'terima', 'makasih', 'siap', 'mana', 'sama', 'saja', 'kalau', 'harga', 'tanya', 'nanya', 'belum', 'sudah', 'bagus',
    'besar', 'kecil', 'minta', 'semua', 'sedikit', 'banyak', 'untuk', 'dengan', 'ingin', 'pesan', 'kirim', 'bikin', 'warna', 'logo', 'kamu',
    'kapan', 'tapi', 'bisa', 'boleh', 'lihat', 'liat', 'model', 'bahan', 'jumlah', 'tempat', 'bayar', 'transfer', 'nanti', 'besok', 'hari',
    'pakai', 'pake', 'kayak', 'kaya', 'masih', 'cari', 'dulu', 'lagi', 'tolong', 'mohon', 'info', 'tahu', 'paham', 'ditunggu', 'tunggu',
    'beragam', 'macam', 'borong', 'borongan', 'grosir', 'grosiran', 'partai', 'gimana', 'dimana', 'bagaimana', 'kenapa', 'mengapa', 'berapa', 'siapa', 'kapan', 'teman', 'tidak', 'nggak', 'bukan', 'karena',
    'sekarang', 'sudah', 'semoga', 'nomor', 'warna', 'kirim', 'dikirim', 'sablon', 'bordir', 'gambar', 'desain', 'design',
]);

// Words that ride along with an acknowledgement without adding anything.
const ACK_FILLERS = new Set(['kak', 'min', 'mas', 'mbak', 'mba', 'bu', 'pak', 'gan', 'sis', 'ya', 'nih', 'deh', 'dong', 'kok', 'banyak', 'sekali', 'ok', 'yang', 'kalau', 'begitu', 'gitu', 'sudah', 'udah',
    'atas', 'info', 'infonya', 'informasi', 'informasinya', 'penjelasannya', 'bantuannya', 'responnya', 'balasannya', 'jawabannya', 'to', 'lho', 'loh', 'yo', 'sanget', 'nggeh',
    'sangat', 'membantu', 'terbantu', 'bermanfaat', 'jelas', 'lengkap', 'kakak', 'semuanya', 'ya', 'kembali']);

/**
 * True when the message is only these phrases plus filler words; with
 * allowEmpty, also when there are no words at all (one emoji, a sticker).
 */
function onlyPhrases(normalised, phrases, fillers, allowEmpty = false) {
    let rest = normalised;
    let hit = false;

    for (const phrase of [...phrases].sort((a, b) => b.length - a.length)) {
        while (rest.includes(` ${phrase} `)) {
            rest = rest.replace(` ${phrase} `, ' ');
            hit = true;
        }
    }

    const left = tokens(rest);

    return left.every((word) => fillers.has(word)) && (hit || (allowEmpty && !tokens(normalised).length));
}

const GREETING_FILLERS = new Set(['kak', 'min', 'mas', 'mbak', 'mba', 'admin', 'gan', 'sis', 'bu', 'pak', 'selamat', 'ya', 'nih', 'pagi', 'siang', 'sore', 'malam', 'wr', 'wb', 'semua', 'dulu']);

// A number with a unit is an amount anywhere ("kemeja 2000 pcs"); a bare
// number only when the bot asked how many ("SMA 1" is not one piece).
const QUANTITY_UNIT = /(?:^|\s)(\d{1,6}\s*(?:pcs|pc|buah|bh|potong|ptg|lembar|lbr|set|pasang|orang|org|stel|setel|lusin|kodi|an|anan|biji))(?=\s|$)/;
// Whether they said they have a design ("desainnya sudah ada", "nanti saya kirim filenya")
// or none ("belum ada desain", "dereng wonten desaine"). Matched on normalised text.
const DESIGN_NONE = / (?:belum|tidak|gak|nggak|enggak) (?:ada |punya |memiliki |kepikiran |dapat )?(?:desain|design|referensi|konsep|gambaran|logo)/;
const DESIGN_READY = / (?:sudah|udah) (?:ada |punya |jadi |siap )?(?:desain|design|file|gambar|referensi|logo)| (?:desain|design|file|filenya|desainnya|designnya) (?:sudah|udah) (?:ada|jadi|siap)| (?:kirim|kirimkan|kirimin) (?:file|filenya|desain|desainnya|gambar)/;

const designStatus = (normalised) => (DESIGN_NONE.test(normalised) ? 'none' : DESIGN_READY.test(normalised) ? 'ready' : null);

const QUANTITY_NAMED =/(?:^|\s)((?:se|satu |dua |tiga |empat |lima |setengah )?(?:lusin|kodi)|ratusan|puluhan)(?=\s|$)/;

function quantityText(normalised, bare) {
    const found = normalised.match(QUANTITY_UNIT) ?? normalised.match(QUANTITY_NAMED) ?? (bare ? normalised.match(QUANTITY) : null);

    return found ? found[1].trim() : null;
}

export function classifyWithRules({ text, hasImage = false, step = 'new' }) {
    const normalised = normalise(text);
    const product = findProduct(normalised);
    const sizeVariant = SIZE_VARIANT(normalised);
    const intro = findIntroduction(text, { lenient: step === 'awaiting_intro' });

    // Everything the message asks, so one bubble with three questions gets three answers.
    // Answered in the order the customer asked, not by how strongly each matched.
    const at = (f) => Math.min(...f.hits.map((hit) => normalised.indexOf(` ${hit}`)).filter((i) => i >= 0), Infinity);
    const found = findPatterns(normalised).sort((a, b) => at(a) - at(b));
    const patternHits = found.flatMap((f) => f.hits);
    const patterns = found.map(({ pattern: p }) => ({ id: p.id, name: p.name, bubbles: p.bubbles, after: p.after, builtin: p.builtin }));

    // A built-in answer triggered only by the same words as a pattern is the
    // pattern's job ("sizenya" -> the team's "Ukuran"); a different question
    // in the same message still gets its built-in answer.
    const overlaps = (a, b) => a.includes(b) || b.includes(a);
    const faqs = FAQ_ORDER.filter((intent) =>
        hitsOf(normalised, keywordsFor(intent)).some((hit) => !patternHits.some((p) => overlaps(hit, p))),
    );
    const wantsProduct = Boolean(product) && containsPrefix(normalised, ORDER_WORDS);

    const result = (intent) =>
        normaliseResult(
            {
                intent,
                product,
                sizeVariant,
                quantity: quantityText(normalised, step === 'awaiting_quantity'),
                design: designStatus(normalised),
                text,
                ...intro,
                extras: [...faqs, ...(wantsProduct ? ['product'] : [])].filter((extra) => extra !== intent),
                patterns,
                source: 'rules',
            },
            productKeys(),
        );

    // A bare number is an amount only when the bot asked how many ("SMA 1 Purworejo" is not one piece).
    const quantity = () =>
        (step === 'awaiting_quantity' ? QUANTITY.test(normalised) : QUANTITY_UNIT.test(normalised)) ||
        QUANTITY_WORDS.some((w) => normalised.includes(w)) ||
        mentions(normalised, keywordsFor('quantity'));

    // Answers to the bot's own question come first: "belum ada" after "what
    // design?" means no reference, not a greeting or an unknown message.
    if (step === 'awaiting_design') {
        if (hasImage) return result('has_reference');
        if (mentions(normalised, keywordsFor('no_reference')) && !QUANTITY.test(normalised)) return result('no_reference');
        if (mentions(normalised, keywordsFor('has_reference'))) return result('has_reference');
    }

    if (step === 'awaiting_quantity' && quantity()) {
        return result('quantity');
    }

    // "Mau ngobrol sama admin": a person was asked for; nothing else matters.
    if (mentions(normalised, keywordsFor('human'))) return result('human');

    // Answer patterns (the team's and the seeded Lokasi, Pengiriman, ...) come before the built-in answers.
    if (patterns.length) return result('custom');

    // Questions the spec answers at any point in the conversation.
    // "Belum ada desain" says they have none; it is not a request for design examples.
    if (faqs[0] === 'design_reference' && DESIGN_NONE.test(normalised)) return result('no_reference');

    if (faqs.length) return result(faqs[0]);

    if (product) return result('product');

    // "harganya berapa?" without a product; then "mau nanya2 dulu" (a question announced, none asked).
    if (mentions(normalised, keywordsFor('price'))) return result('price');
    if (mentions(normalised, keywordsFor('ask_first'))) return result('ask_first');

    // "ok kak", "siap makasih", or only an emoji: nothing to answer, nothing to hand over.
    if (!hasImage && onlyPhrases(normalised, keywordsFor('ack'), ACK_FILLERS, true)) return result('ack');

    if (step === 'awaiting_design' && tokens(normalised).length >= 3) {
        // A sentence about what they want is the design description.
        return result('has_reference');
    }

    if (quantity()) return result('quantity');

    // Only a real-looking name: "kulo nuwun" has a lead word but no name.
    if (intro.name && cleanName(intro.name)) return result('introduction');

    const words = tokens(normalised);

    // Only greetings ("met malam kak", "sugeng dalu mas"), phrases included.
    if (words.length && words.length <= 6 && onlyPhrases(normalised, keywordsFor('greeting'), GREETING_FILLERS)) {
        return result('greeting');
    }

    if (step === 'new' && /^(?:halo|hallo|hai|hi|permisi|assalamu|selamat|pagi|siang|sore|malam)/.test(normalised.trim()) && words.length <= 8) {
        return result('greeting');
    }

    return result('other');
}
