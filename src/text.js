/**
 * The one shape text is compared in: customer messages, built-in keywords,
 * team keywords and pattern keywords all go through normalise(), so a phrase
 * stored as "belum ada" matches a customer typing "blm ada".
 *
 * No imports: the database migrations use this before anything else loads.
 */

/**
 * Chat shorthand, written out, so "brp min order nya" matches "berapa" and
 * "minimal" keywords. Only unambiguous abbreviations: a wrong expansion is
 * worse than none.
 */
export const SHORTHAND = {
    brp: 'berapa', brapa: 'berapa', berapaan: 'berapa', brpa: 'berapa',
    gmn: 'gimana', gmna: 'gimana', gimn: 'gimana', bgmn: 'bagaimana', bgmna: 'bagaimana',
    dmn: 'dimana', dmna: 'dimana', dimn: 'dimana', mana2: 'mana',
    bs: 'bisa', bsa: 'bisa', bisaa: 'bisa',
    gk: 'gak', ggk: 'gak', g: 'gak', ga: 'gak', nggk: 'nggak', engga: 'nggak', ngga: 'nggak', kaga: 'gak',
    tdk: 'tidak', tak: 'tidak',
    blm: 'belum', blom: 'belum', belom: 'belum',
    udh: 'udah', udah: 'udah', dah: 'udah', sdh: 'sudah', sudh: 'sudah',
    klo: 'kalau', kalo: 'kalau', kl: 'kalau', kalu: 'kalau',
    yg: 'yang', dgn: 'dengan', utk: 'untuk', untk: 'untuk', tp: 'tapi', jg: 'juga', sm: 'sama', aja: 'aja', aj: 'aja', ajh: 'aja',
    pesen: 'pesan', psn: 'pesan', mesen: 'pesan', bkin: 'bikin', bikinin: 'bikin', bkn: 'bikin', mau: 'mau', mo: 'mau', pgn: 'pengen', pngn: 'pengen',
    mnta: 'minta', mnt: 'minta', tny: 'tanya', tnya: 'tanya', nnya: 'nanya',
    hrg: 'harga', hrga: 'harga', harganya: 'harga', ongkos: 'ongkos', okr: 'ongkir',
    lok: 'lokasi', loc: 'lokasi', almt: 'alamat', alamt: 'alamat',
    pcs: 'pcs', psc: 'pcs', pc: 'pcs', biji: 'pcs',
    sz: 'size', siz: 'size', ukrn: 'ukuran', ukr: 'ukuran',
    mksh: 'makasih', mks: 'makasih', trims: 'makasih', thx: 'makasih', tq: 'makasih',
    kk: 'kak', kakk: 'kak', ka: 'kak', kaka: 'kak',
};

/** Lowercase, strip punctuation, squash "kakkk" -> "kak", expand shorthand; padded with spaces for word matching. */
export function normalise(text) {
    const words = String(text ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}&\- ]/gu, ' ')
        .replace(/(\p{L})\1{2,}/gu, '$1')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => SHORTHAND[word] ?? word);

    return ` ${words.join(' ')} `;
}

/** A keyword as it is stored: normalised, without the padding. */
export const cleanPhrase = (phrase) => normalise(phrase).trim();

/** "Kaos Polo Anak" -> "kaos-polo-anak": a stable key for a product the team adds. */
export const slugify = (text) =>
    String(text ?? '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
