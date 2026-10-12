/**
 * Products the bot recognises.
 *
 * `sizeChart: true` marks garments that need a size chart file in media/.
 *
 * `catalog: true` means the product has a fixed price list in the catalog, so
 * the bot sends the catalog file. The rest are priced by quantity and design,
 * so the bot asks for a design reference instead (SPEK-CHATBOT.md, main flow).
 *
 * `keywords` feed the offline keyword classifier only; the AI classifier is
 * given the names and decides on its own. Keywords are matched against
 * normalised text (lowercase, punctuation stripped, repeated letters squashed).
 */
export const PRODUCTS = {
    jersey: {
        name: 'Jersey',
        catalog: true,
        sizeChart: true,
        keywords: ['jersey', 'jersy', 'jersi', 'jesrey', 'baju bola', 'baju futsal', 'kaos bola', 'kaos futsal', 'baju olahraga', 'seragam bola', 'seragam futsal', 'baju voli', 'baju volly', 'baju badminton', 'baju sepeda', 'baju esport', 'baju e-sport', 'baju basket', 'jersey basket', 'jersey printing', 'bahan jersey', 'kerah jersey', 'jersey bola', 'jersey futsal'],
    },
    'id-card-lanyard': {
        name: 'ID Card & Lanyard',
        catalog: true,
        sizeChart: false,
        keywords: ['id card', 'idcard', 'id-card', 'name tag', 'nametag', 'lanyard', 'lanyar', 'tali id', 'tali name tag', 'kartu nama peserta', 'kartu panitia', 'cetak id card', 'paket idcard', 'paket id card'],
    },
    'gantungan-kunci': {
        name: 'Gantungan Kunci',
        catalog: true,
        sizeChart: false,
        keywords: ['gantungan kunci', 'gantungan', 'ganci', 'keychain', 'key chain', 'gantungan konci'],
    },
    'bendera-printing': {
        name: 'Bendera Printing',
        catalog: true,
        sizeChart: false,
        keywords: ['bendera', 'flag', 'umbul', 'umbul umbul', 'panji', 'banner bendera'],
    },
    kaos: {
        name: 'Kaos',
        catalog: false,
        sizeChart: true,
        keywords: ['kaos', 'kaus', 't-shirt', 'tshirt', 'tee', 'baju kaos', 'kaos komunitas', 'kaos sablon', 'sablon', 'kaos oblong', 'kaos polos', 'oversize', 'boxy', 'kaos kelas', 'kaos angkatan', 'kaos sekolah', 'two tone', 'two-tone', 'twotone'],
    },
    pdl: {
        name: 'PDL',
        catalog: false,
        sizeChart: true,
        keywords: ['pdl', 'pdh', 'baju lapangan', 'kemeja lapangan', 'seragam lapangan', 'baju dinas', 'kemeja pdl', 'pdl 2in1'],
    },
    kemeja: {
        name: 'Kemeja',
        catalog: false,
        sizeChart: true,
        keywords: ['kemeja', 'hem', 'baju kantor', 'seragam kantor', 'batik'],
    },
    polo: {
        name: 'Polo Shirt',
        catalog: false,
        sizeChart: true,
        keywords: ['polo', 'poloshirt', 'kaos kerah', 'kaos berkerah', 'polo shirt'],
    },
    rompi: {
        name: 'Rompi',
        catalog: false,
        sizeChart: true,
        keywords: ['rompi', 'vest', 'romp'],
    },
    jaket: {
        name: 'Jaket',
        catalog: false,
        sizeChart: true,
        keywords: ['jaket', 'jacket', 'jaket bomber', 'bomber', 'varsity', 'windbreaker', 'parasut', 'jaket angkatan'],
    },
    hoodie: {
        name: 'Hoodie',
        catalog: false,
        sizeChart: true,
        keywords: ['hoodie', 'hodie', 'hoody', 'sweater', 'crewneck', 'sweatshirt', 'zipper hoodie'],
    },
    topi: {
        name: 'Topi',
        catalog: false,
        sizeChart: false,
        keywords: ['topi', 'cap', 'snapback', 'trucker', 'bucket hat'],
    },
    'tote-bag': {
        name: 'Tote Bag',
        catalog: false,
        sizeChart: false,
        keywords: ['totebag', 'tote bag', 'tote', 'tas kain', 'goodie bag', 'goodiebag', 'tas spunbond'],
    },
    'seragam-sekolah': {
        name: 'Seragam',
        catalog: false,
        sizeChart: true,
        keywords: ['seragam', 'wearpack', 'werpack', 'baju kerja', 'baju bengkel', 'seragam kerja', 'baju olahraga sekolah', 'osis', 'mpk', 'pramuka', 'paskibra', 'paskib', 'pks', 'pmr', 'seragam sekolah', 'baju sekolah', 'seragam osis', 'baju osis', 'baju pramuka'],
    },
};

export const productKeys = Object.keys(PRODUCTS);

export const productName = (key) => PRODUCTS[key]?.name ?? key;

export const hasCatalog = (key) => Boolean(PRODUCTS[key]?.catalog);
