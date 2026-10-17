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
    riyin: 'dulu', disik: 'dulu', dhisik: 'dulu', dlu: 'dulu',
};

/**
 * Javanese (ngoko and krama) and a little Sundanese, turned into the
 * Indonesian the keywords are written in: "pinten regane" -> "berapa harga",
 * "badhe damel kaos" -> "mau bikin kaos", "lokasine ten pundi" -> "lokasi
 * dimana". Every keyword then works in Javanese without being taught twice.
 * Only words with no other meaning in Indonesian chat.
 */
export const REGIONAL = {
    // question words
    pinten: 'berapa', piro: 'berapa', pira: 'berapa', pirang: 'berapa', sabaraha: 'berapa',
    pripun: 'gimana', piye: 'gimana', kepiye: 'gimana', kepripun: 'gimana', kumaha: 'gimana',
    nopo: 'apa', napa: 'apa', opo: 'apa', naon: 'apa',
    pundi: 'mana', endi: 'mana', ngendi: 'mana', pundhi: 'mana',
    // to be, to have, yes, no, done, not yet
    wonten: 'ada', onten: 'ada', enten: 'ada', ono: 'ada', aya: 'ada',
    mboten: 'tidak', mpun: 'sudah', ora: 'tidak', teu: 'tidak', ndak: 'tidak', gag: 'gak',
    dereng: 'belum', durung: 'belum', acan: 'belum',
    sampun: 'sudah', uwis: 'sudah', wis: 'sudah', wes: 'sudah', parantos: 'sudah',
    nggih: 'iya', inggih: 'iya', injih: 'iya', njih: 'iya', enggih: 'iya',
    // want, make, buy, send, can, ask
    badhe: 'mau', bade: 'mau', ajeng: 'mau', arep: 'mau', hoyong: 'mau', kepengin: 'pengen', pengin: 'pengen',
    damel: 'bikin', ndamel: 'bikin', gawe: 'bikin', nggawe: 'bikin', digawe: 'dibikin', didamel: 'dibikin',
    tumbas: 'beli', tuku: 'beli', mundhut: 'beli', mendet: 'ambil', njupuk: 'ambil', dumugi: 'sampai', menawi: 'kalau', nek: 'kalau', ngadamel: 'bikin', ngadamelkeun: 'bikin', mbayar: 'bayar',
    kintun: 'kirim', ngintun: 'kirim', dikintun: 'dikirim',
    saged: 'bisa', iso: 'bisa', isa: 'bisa', tiasa: 'bisa',
    takon: 'tanya', tangklet: 'tanya', tanglet: 'tanya', naros: 'tanya',
    // people and places
    kulo: 'saya', kula: 'saya', abdi: 'saya', panjenengan: 'kamu', sampeyan: 'kamu', njenengan: 'kamu',
    saking: 'dari', seko: 'dari', soko: 'dari',
    ten: 'di', teng: 'di', neng: 'di', nang: 'di', ning: 'di',
    mriki: 'sini', kene: 'sini', mrika: 'sana', kono: 'sana',
    panggenan: 'tempat', panggonan: 'tempat', panggenane: 'tempat', panggonane: 'tempat', nggone: 'tempat',
    // amounts and things
    sekedhik: 'sedikit', sekedik: 'sedikit', sithik: 'sedikit', sitik: 'sedikit', setitik: 'sedikit', saeutik: 'sedikit',
    kathah: 'banyak', akeh: 'banyak', seueur: 'banyak', sedoyo: 'semua', kabeh: 'semua',
    regane: 'harga', regine: 'harga', reginipun: 'harga', hargane: 'harga', hargine: 'harga', hargana: 'harga', regi: 'harga', rego: 'harga', reregan: 'harga', larang: 'mahal',
    ukurane: 'ukuran', alamate: 'alamat', lokasine: 'lokasi', desaine: 'desain', kaose: 'kaos', ongkire: 'ongkir', minimale: 'minimal',
    klambi: 'baju', bal: 'bola', kathok: 'celana', clono: 'celana', apik: 'bagus', sae: 'bagus', tenan: 'beneran',
    ngapusi: 'nipu', diapusi: 'ditipu', suwe: 'lama', dangu: 'lama', cepet: 'cepat', gedhe: 'besar', cilik: 'kecil',
    mangke: 'nanti', mengko: 'nanti', kangge: 'untuk', kanggo: 'untuk', kagem: 'untuk', dados: 'jadi', dadi: 'jadi',
    siji: 'satu', setunggal: 'satu', loro: 'dua', kalih: 'dua', telu: 'tiga', tigo: 'tiga', papat: 'empat', sekawan: 'empat', limo: 'lima', gangsal: 'lima',
    manut: 'ikut', mawon: 'aja', wae: 'aja', bae: 'aja', mung: 'cuma', namung: 'cuma', kanca: 'teman', konco: 'teman', rencang: 'teman',
        niki: 'ini', iki: 'ini', niku: 'itu', kuwi: 'itu', iku: 'itu',
    // greetings and thanks
    dalu: 'malam', enjing: 'pagi', sonten: 'sore', sugeng: 'selamat', kulonuwun: 'permisi',
    suwun: 'makasih', nuwun: 'makasih', maturnuwun: 'makasih', ngapunten: 'maaf', sepurane: 'maaf', sepuntene: 'maaf',
};

// Several words that mean one thing; replaced before the word lists.
const PHRASES = [
    [' matur nuwun ', ' makasih '], [' matur suwun ', ' makasih '], [' hatur nuhun ', ' makasih '], [' nuwun sewu ', ' permisi '],
    [' kulo nuwun ', ' permisi '], [' kula nuwun ', ' permisi '], [' kados pundi ', ' gimana '], [' di mana ', ' dimana '],
    [' nyuwun pirsa ', ' tanya '], [' nyuwun sewu ', ' permisi '],
];

/**
 * Changes whenever the text rules above change. Keywords are stored
 * normalised, so the migrations re-store them when this differs from the
 * value saved in the database (see migrations.js).
 */
export function textRulesVersion() {
    const source = JSON.stringify([SHORTHAND, REGIONAL, PHRASES, 'reduplication-1']);
    let hash = 5381;
    for (let i = 0; i < source.length; i++) hash = ((hash * 33) ^ source.charCodeAt(i)) >>> 0;

    return hash.toString(36);
}

/** Lowercase, strip punctuation, squash "kakkk" -> "kak", expand shorthand; padded with spaces for word matching. */
export function normalise(text) {
    const words = String(text ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}&\- ]/gu, ' ')
        .replace(/(\p{L})\1{2,}/gu, '$1')
        .split(/\s+/)
        .filter(Boolean)
        // "nanya2", "takon-takon" -> "nanya nanya", "takon takon" (reduplication).
        .flatMap((word) => {
            if (/^\p{L}{2,}2$/u.test(word) && !SHORTHAND[word]) return [word.slice(0, -1), word.slice(0, -1)];

            const [a, b] = word.split('-');

            return b && a === b ? [a, b] : [word];
        })
        .join(' ');

    // Phrases before the word lists ("matur nuwun", not "matur makasih"), and
    // after them for the ones the lists produce ("ten pundi" -> "di mana").
    const phrases = (text) => {
        let out = ` ${text} `;
        for (const [from, to] of PHRASES) {
            while (out.includes(from)) out = out.replace(from, to);
        }

        return out;
    };

    const mapped = phrases(words).trim().split(' ').filter(Boolean).map((word) => SHORTHAND[word] ?? REGIONAL[word] ?? word);
    const out = phrases(mapped.join(' '));

    return out;
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
