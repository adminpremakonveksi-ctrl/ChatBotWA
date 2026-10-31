import { cleanName, normaliseResult } from './intents.js';
import { customKeywords } from './keywords.js';
import { activePatterns } from './patterns.js';
import { productKeys } from './products.js';
import { wordMap, wordSet, wordsOf } from './words.js';
import { normalise, squashWord } from '../text.js';

// Kept here too: callers import them from the classifier.
export { normalise };

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


// Word lists (Kamus, words.js): what says "I want to order" ("mau bikin jersey,
// minimal berapa?" also starts the jersey flow), and what asks to have
// something made (for products the shop does not list).
const ORDER_WORDS = () => wordsOf('kata_pesan');
const MAKE_WORDS = () => wordsOf('kata_buat');

/** A word list as a regex alternative; multi-word entries allow any spacing or a comma. */
const escapeRegex = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (list) => `(?:${wordsOf(list).map((w) => escapeRegex(w).replace(/ +/g, '[\\s,]+')).join('|') || '(?!)'})`;

// Built-in flow answers that are not answer patterns, in the order sent when
// one message asks several. (Lokasi, Pengiriman, Ragu, Minimal order are patterns.)
const FAQ_ORDER = ['size_chart', 'design_reference'];

/** How well one keyword matches: exact at a word start beats a typo; 0 = no match. */
const keywordScore = (normalised, keyword) => {
    const exact = /\d$/.test(keyword) ? normalised.includes(` ${keyword} `) : normalised.includes(` ${keyword}`);

    return exact ? keyword.length + 1 : tokens(normalised).some((token) => !wordSet('bukan_typo').has(token) && nearly(token, keyword)) ? keyword.length : 0;
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

        // exact: a keyword is really in the message, not only a typo-tolerant guess.
        if (score) found.push({ pattern, score, hits: hitsOf(normalised, pattern.keywords), exact: pattern.keywords.some((k) => keywordScore(normalised, k) === k.length + 1) });
    }

    return found.sort((a, b) => b.score - a.score);
}

/** The single best pattern for a message, or null ("Coba kalimat" in the console). */
export const findPattern = (normalised) => findPatterns(normalised)[0]?.pattern ?? null;

const productKeywordsOf = (key) => customKeywords().filter((k) => k.intent === 'product' && k.product === key).map((k) => k.phrase);

/** Keywords of a built-in answer: all in the database (seeded, editable, deletable). */
const keywordsFor = (intent) => customKeywords().filter((k) => k.intent === intent).map((k) => k.phrase);


// A number, optionally with a unit from the list ("50", "50 pcs", "2 lusin").
const QUANTITY = () => new RegExp(`(?:^|\\s)(\\d{1,6})\\s*${alt('satuan')}?(?:\\s|$)`);

/** Size chart variant from the list (oversize, boxy); reguler otherwise. */
const SIZE_VARIANT = (text) => {
    for (const [word, variant] of wordMap('varian_ukuran')) {
        if (text.includes(` ${word}`)) return variant;
    }

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
        if (wordSet('bukan_typo').has(token)) continue;

        const hit = candidates.find(({ keyword }) => nearly(token, keyword));
        if (hit) return hit.key;
    }

    return null;
}

// The words around a name, from the lists (Kamus): Indonesian, Javanese
// ("kulo Budi saking Purworejo", "nami kula Sri") and Sundanese ("abdi Asep ti Garut").
const LEAD = () => alt('awal_nama');
const NAME = "([\\p{L}']+(?:\\s+[\\p{L}']+){0,2}?)";
const ORIGIN_LEAD = () => alt('awal_asal');
const STOP = () => `(?=\\s+${alt('penghenti_nama')}\\b|\\s*$)`;

/** Pulls a name and origin out of "saya Budi dari Jogja", "Budi, Magelang", ... */
export function findIntroduction(raw, { lenient = false } = {}) {
    // As typed, minus emoji and stretched letters ("sayaa Budi 🙏"), and minus
    // the chat's extras at the end ("Budi, Magelang kak hehe").
    const extras = wordSet('kata_imbuhan');
    const parts = String(raw ?? '')
        .replace(/[^\p{L}\p{N}\s,.'-]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => {
            const [, core, tail] = word.match(/^(.*?)([,.]*)$/u);

            if (!core) return word;
            const squashed = squashWord(core);

            // Unchanged words keep their capitals ("Jogja").
            return (squashed === core.toLowerCase() ? core : squashed) + tail;
        });
    const extra = (word) => extras.has(word.replace(/[,.]+$/, '').toLowerCase());
    while (parts.length > 1 && extra(parts.at(-1))) parts.pop();
    // "eh, Budi dari Jogja", "permisi kak, Budi, Magelang": the same at the start.
    while (parts.length > 1 && extra(parts[0])) parts.shift();
    const text = parts.join(' ').replace(/[,.]+$/, '').trim();

    let name = null;
    let origin = null;

    const lead = new RegExp(`(?:^|[\\s,.])${LEAD()}\\s+(?:kak\\s+|mas\\s+|mbak\\s+|mba\\s+|bu\\s+|pak\\s+|ibu\\s+|bapak\\s+)?${NAME}(?=\\s+${ORIGIN_LEAD()}\\b|\\s*[,.]|${STOP()})`, 'iu');
    const leadMatch = text.match(lead);

    if (leadMatch) {
        name = leadMatch[1];
    }

    const originMatch = text.match(new RegExp(`(?:^|[\\s,.])${ORIGIN_LEAD()}\\s+([\\p{L}\\p{N} .'-]+?)(?=\\s*[,.]|${STOP()})`, 'iu'));

    if (originMatch && (name || lenient)) {
        origin = originMatch[1];
    }

    if (!name && lenient) {
        // Replying to "ini dengan kak siapa dan darimana ya?" people often
        // answer bare: "Budi", "Budi dari Jogja", "Budi, Magelang".
        const bare = text.match(new RegExp(`^${NAME}(?:\\s*,\\s*|\\s+${ORIGIN_LEAD()}\\s+)([\\p{L}\\p{N} .'-]+)$`, 'iu'));

        if (bare) {
            name = bare[1];
            origin = bare[2];
        } else if (/^[\p{L}' ]+$/u.test(text) && text.split(' ').length <= 3) {
            // "budi jogja": a known place at the end is the origin, not a surname.
            const words = text.split(' ');
            const last = words.at(-1).toLowerCase();

            if (words.length >= 2 && wordSet('kota').has(last)) {
                name = words.slice(0, -1).join(' ');
                origin = words.at(-1);
            } else {
                name = text;
            }
        }
    }

    return { name, origin };
}

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
    // "ok makasih sih", "halo malam dong hehe": the chat's own extras (Kamus kata_imbuhan) say nothing.
    const extras = wordSet('kata_imbuhan');

    return left.every((word) => fillers.has(word) || extras.has(word)) && (hit || (allowEmpty && !tokens(normalised).length));
}

// A number with a unit is an amount anywhere ("kemeja 2000 pcs"); a bare
// number only when the bot asked how many ("SMA 1" is not one piece).
const QUANTITY_UNIT = () => new RegExp(`(?:^|\\s)(\\d{1,6}\\s*${alt('satuan')})(?=\\s|$)`);

// Whether they said they have a design ("desainnya sudah ada", "nanti saya kirim filenya")
// or none ("belum ada desain", "dereng wonten desaine"), from the word lists. Normalised text.
const DESIGN_NONE = () => new RegExp(` ${alt('kata_tidak')} (?:${alt('kata_punya')} )?${alt('kata_desain')}`);
const DESIGN_READY = () =>
    new RegExp(` ${alt('kata_sudah')} (?:${alt('kata_punya')} )?${alt('kata_desain')}| ${alt('kata_desain')} ${alt('kata_sudah')} ${alt('kata_punya')}| ${alt('kata_kirim')} ${alt('kata_desain')}`);

const designStatus = (normalised) => (DESIGN_NONE().test(normalised) ? 'none' : DESIGN_READY().test(normalised) ? 'ready' : null);

const QUANTITY_NAMED =/(?:^|\s)((?:se|satu |dua |tiga |empat |lima |setengah )?(?:lusin|kodi)|ratusan|puluhan)(?=\s|$)/;

// "2rb pcs", "1,5 ribu", "dua ratus biji", "seratus", "lima puluh orang".
const QUANTITY_THOUSANDS = /(?:^|\s)(\d{1,4}(?:[.,]\d)?\s*(?:rb|ribu|k)(?:\s+pcs)?)(?=\s|$)/;
const NUMBER_WORD = '(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan)';
const QUANTITY_WORDS_NUM = new RegExp(`(?:^|\\s)((?:se|${NUMBER_WORD}\\s)(?:ratus|ribu|puluh)(?:\\s${NUMBER_WORD}(?:\\spuluh)?)?(?:\\s(?:pcs|orang|stel|setel|lusin))?)(?=\\s|$)`);

function quantityText(normalised, bare) {
    const found =
        normalised.match(QUANTITY_UNIT()) ??
        normalised.match(QUANTITY_THOUSANDS) ??
        normalised.match(QUANTITY_WORDS_NUM) ??
        normalised.match(QUANTITY_NAMED) ??
        (bare ? normalised.match(QUANTITY()) : null);

    return found ? found[1].trim() : null;
}

export function classifyWithRules({ text, hasImage = false, hasAudio = false, attachments = [], step = 'new', usePatterns = true }) {
    const normalised = normalise(text);
    const product = findProduct(normalised);
    const sizeVariant = SIZE_VARIANT(normalised);
    const intro = findIntroduction(text, { lenient: step === 'awaiting_intro' });

    // Everything the message asks, so one bubble with three questions gets three answers.
    // Answered in the order the customer asked, not by how strongly each matched.
    const at = (f) => Math.min(...f.hits.map((hit) => normalised.indexOf(` ${hit}`)).filter((i) => i >= 0), Infinity);
    // A pattern matched only by a typo guess never beats a product named exactly
    // ("seragam batik kantor" is kemeja, not "kantore" -> Lokasi).
    const matched = usePatterns ? findPatterns(normalised) : [];
    const found = matched
        .filter((f) => f.exact || !product)
        .sort((a, b) => at(a) - at(b));
    // Whether every match here was exact; a guess is checked by the AI when it is on.
    const guessed = matched.some((f) => !f.exact);
    const patternHits = found.flatMap((f) => f.hits);
    const patterns = found.map(({ pattern: p }) => ({ id: p.id, name: p.name, bubbles: p.bubbles, after: p.after, builtin: p.builtin }));

    // A built-in answer triggered only by the same words as a pattern is the
    // pattern's job ("sizenya" -> the team's "Ukuran"); a different question
    // in the same message still gets its built-in answer.
    const overlaps = (a, b) => a.includes(b) || b.includes(a);
    const faqs = FAQ_ORDER.filter((intent) =>
        hitsOf(normalised, keywordsFor(intent)).some((hit) => !patternHits.some((p) => overlaps(hit, p))),
    );
    const wantsProduct = Boolean(product) && containsPrefix(normalised, ORDER_WORDS());

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
                // A typo-tolerant guess decided something here: the AI double-checks it when on.
                csQuestion: mentions(normalised, keywordsFor('cs_question')),
                // A question ("?" or a question word from Kamus): mid-flow it is answered, not taken as the step's answer.
                isQuestion: String(text ?? '').includes('?') || tokens(normalised).some((w) => wordSet('kata_tanya').has(w)),
                attachments,
                guessed: guessed || (Boolean(product) && !productKeywordsOf(product).some((k) => normalised.includes(` ${k}`))),
                source: 'rules',
            },
            productKeys(),
        );

    // A bare number is an amount only when the bot asked how many ("SMA 1 Purworejo" is not one piece).
    const quantity = () =>
        (step === 'awaiting_quantity' ? QUANTITY().test(normalised) : QUANTITY_UNIT().test(normalised)) ||
        QUANTITY_THOUSANDS.test(normalised) ||
        QUANTITY_WORDS_NUM.test(normalised) ||
        mentions(normalised, keywordsFor('quantity'));

    // Answers to the bot's own question come first: "belum ada" after "what
    // design?" means no reference, not a greeting or an unknown message.
    if (step === 'awaiting_design') {
        if (hasImage) return result('has_reference');
        if (mentions(normalised, keywordsFor('no_reference')) && !QUANTITY().test(normalised)) return result('no_reference');
        if (mentions(normalised, keywordsFor('has_reference'))) return result('has_reference');
    }

    // A voice note, or a picture with no words outside the design step.
    if (hasAudio && !normalised.trim()) return result('voice');
    if (hasImage && !normalised.trim() && step !== 'awaiting_design') return result('image');

    if (step === 'awaiting_quantity' && quantity()) {
        return result('quantity');
    }

    // "Mau ngobrol sama admin": a person was asked for; nothing else matters.
    if (mentions(normalised, keywordsFor('human'))) return result('human');

    // "Kamu bot ya?": answered honestly, the bot carries on.
    if (mentions(normalised, keywordsFor('about_bot'))) return result('about_bot');

    // Answer patterns (the team's and the seeded Lokasi, Pengiriman, ...) come before the built-in answers.
    if (patterns.length) return result('custom');

    // Questions the spec answers at any point in the conversation.
    // "Belum ada desain" says they have none; it is not a request for design examples.
    if (faqs[0] === 'design_reference' && DESIGN_NONE().test(normalised)) return result('no_reference');

    if (faqs.length) return result(faqs[0]);

    if (product) return result('product');

    // "Bisa DP dulu?", "berapa lama pengerjaannya": clear, but only CS can answer.
    if (mentions(normalised, keywordsFor('cs_question'))) return result('cs_question');

    // "harganya berapa?" without a product; then "mau nanya2 dulu" (a question announced, none asked).
    if (mentions(normalised, keywordsFor('price'))) return result('price');
    if (mentions(normalised, keywordsFor('ask_first'))) return result('ask_first');

    // "ok kak", "siap makasih", or only an emoji: nothing to answer, nothing to hand over.
    if (!hasImage && onlyPhrases(normalised, keywordsFor('ack'), wordSet('pengisi_oke'), true)) return result('ack');

    // "eh salah, nama saya Haikal" at the design question: a name said plainly
    // (Kamus awal_nama_pasti), not a design description.
    if (intro.name && cleanName(intro.name) && mentions(normalised, wordsOf('awal_nama_pasti'))) return result('introduction');

    if (step === 'awaiting_design' && tokens(normalised).length >= 3) {
        // A sentence about what they want is the design description.
        return result('has_reference');
    }

    if (quantity()) return result('quantity');

    // Only a real-looking name: "kulo nuwun" has a lead word but no name.
    if (intro.name && cleanName(intro.name)) return result('introduction');

    const words = tokens(normalised);

    // Only greetings ("met malam kak", "sugeng dalu mas"), phrases included.
    // At most six words that say something ("eh halo selamat malam ya kak hehe" is a greeting).
    const meaningful = words.filter((word) => !wordSet('kata_imbuhan').has(word));
    if (words.length && meaningful.length <= 6 && onlyPhrases(normalised, keywordsFor('greeting'), wordSet('pengisi_sapaan'))) {
        return result('greeting');
    }

    if (step === 'new' && /^(?:halo|hallo|hai|hi|permisi|assalamu|selamat|pagi|siang|sore|malam)/.test(normalised.trim()) && words.length <= 8) {
        return result('greeting');
    }

    // "Bisa bikin sepatu?", "jual tas ransel?": asks to make or buy something
    // the shop does not list. CS checks it; the chat is not closed.
    if (containsPrefix(normalised, MAKE_WORDS()) && words.length <= 12) return result('product_unknown');

    return result('other');
}
