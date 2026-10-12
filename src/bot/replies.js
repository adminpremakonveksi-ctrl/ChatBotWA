import { config } from '../config.js';
import { all, run, setSetting } from '../db.js';

/**
 * Every sentence the bot can send. The defaults are copied word for word from
 * SPEK-CHATBOT.md; the team may change any of them from the console
 * ("Template balasan"). Either way the bot sends fixed text: AI only picks
 * which template to send and never writes one.
 *
 * Placeholders: {bot} and {cs} everywhere, plus the ones a template lists in
 * `vars` ({nama}, {produk}). Do not "tidy" the default wording here; it is
 * the client's spec and the "Kembalikan ke naskah asli" target.
 */
export const TEMPLATES = {
    greetKnown: {
        group: 'Sapaan',
        label: '[1] Pelanggan sudah menyebut nama',
        when: 'Pesan pertama pelanggan yang sudah memperkenalkan diri, atau pelanggan lama yang kembali.',
        vars: ['nama'],
        text:
            'Halo Kak {nama}, terima kasih sudah menghubungi Prema Konveksi. Sembari menunggu CS {cs} online, izinkan saya {bot} selaku AI Agent untuk membantu kakak ya.\n\n' +
            'Kak {nama} mau informasi tentang produk apa nih? Kami siap bantu 😉',
    },
    greetUnknown: {
        group: 'Sapaan',
        label: '[2] Pelanggan belum memperkenalkan diri',
        when: 'Pesan pertama pelanggan yang hanya menyapa atau langsung bertanya.',
        vars: [],
        text:
            'Halo Kak, terima kasih sudah menghubungi kami. Sembari menunggu CS Agent {cs} online, izinkan saya {bot} selaku AI Agent untuk membantu kakak ya.\n\n' +
            'Sebelumnya ini dengan kak siapa dan darimana ya? Mau kami simpan nomornya 😇',
    },
    afterIntro: {
        group: 'Sapaan',
        label: '[3] Setelah pelanggan memperkenalkan diri',
        when: 'Pelanggan menjawab sapaan [2] dengan nama dan asalnya.',
        vars: ['nama'],
        text: 'Siap Kak {nama}, salam kenal ya. Kak {nama} mau informasi tentang produk apa nih? Kami siap bantu 😉',
    },

    askDesign: {
        group: 'Alur pemesanan',
        label: '[4] Minta referensi desain',
        when: 'Pelanggan menanyakan produk yang harganya bergantung jumlah dan desain (kaos, PDL, hoodie, dll).',
        vars: ['produk'],
        text:
            'Siap kak. Jadi kakak mau bikin produk {produk} yaa.\n\n' +
            'Kalau untuk harga bergantung dengan jumlah pemesanan dan desain kak. Desainnya rencana mau dibikin seperti apa kak?\n\n' +
            'Jika sudah ada referensi dari internet / deskripsi desain yang diinginkan bisa diinfokan ke kami ya kak. 😉',
    },
    askQuantity: {
        group: 'Alur pemesanan',
        label: '[5] Minta jumlah pemesanan',
        when: 'Setelah katalog dikirim, atau setelah pelanggan menjawab soal desain.',
        vars: [],
        text:
            'Oke kak, untuk desainnya akan kami cek setelah CS {cs} online kembali ya kak.\n\n' +
            'Kalau perihal jumlah pemesanannya, rencana kakak mau bikin berapa produk nih?',
    },
    portfolio: {
        group: 'Alur pemesanan',
        label: '[6] / [6B] Belum punya referensi',
        when: 'Pelanggan belum punya desain, atau minta contoh desain.',
        vars: [],
        text: 'Misal belum ada referensi, bisa ambil referensi dari portofolio produk yang udah pernah kami buat kak. Kakak bisa masuk ke grup telegram kami ya : https://t.me/portofolioprema',
    },
    jerseyTemplates: {
        group: 'Alur pemesanan',
        label: '[6] Template desain jersey',
        when: 'Gelembung kedua [6], khusus jersey.',
        vars: [],
        text:
            'Untuk desain jersey bisa kakak cek template dari kami terlebih dahulu kak, barangkali ada desain yang kakak suka & mau dijadikan referensi. Untuk desainnya bisa dicustom warna nya kak sesuai request. Jika sudah ketemu desain yang disuka bisa screenshot ke kami ya kak! Berikut link nya : https://www.instagram.com/premasportswear\n\n' +
            'Jika mau request desain selain yang ada di katalog juga bisa kok kak 😃',
    },
    waitForCs: {
        group: 'Alur pemesanan',
        label: '[7] Minta menunggu CS',
        when: 'Akhir alur, dan setiap kali bot tidak mengerti pertanyaan lalu menyerahkan ke CS.',
        vars: [],
        text: 'Informasi/pertanyaan perihal pemesanan produk sudah kami terima ya kak. Pesan kakak akan kami balas setelah CS {cs} online kembali. Terima kasih atas kesediaannya menunggu ya. 😍',
    },
    socials: {
        group: 'Alur pemesanan',
        label: '[8] Link sosial media',
        when: 'Setelah [7] di akhir alur, sembari menunggu CS.',
        vars: [],
        text:
            'Sambil menunggu CS kami online, kakak bisa stalking akun sosial media kami, barangkali bisa dapat referensi baru untuk desain produknya. Oh iyaa, kalau berkenan bisa follow/ikuti akun sosial media kami ya kak, agar tidak ketinggalan promo menarik dari kami. 😉\n\n' +
            'Instagram: instagram.com/premakonveksi\n' +
            'Tiktok: tiktok.com/premakonveksi\n' +
            'Telegram: t.me/portofolioprema',
    },
    jerseyPromo: {
        group: 'Alur pemesanan',
        label: '[9] Promo jersey',
        when: 'Saat pelanggan menanyakan jersey, setelah katalog dan pamflet promo. Kosongkan kalau sedang tidak ada promo.',
        vars: [],
        optional: true,
        text: '',
    },

    sizeChartWhich: {
        group: 'Pertanyaan umum',
        label: 'Size chart: tanya produknya',
        when: 'Pelanggan minta size chart tanpa menyebut produk.',
        vars: [],
        text: 'Size chart untuk produk apa ya kak? Biar aku bantu kirim yang sesuai 😉',
    },
    sizeChartNote: {
        group: 'Pertanyaan umum',
        label: 'Size chart: keterangan',
        when: 'Dikirim setelah gambar size chart.',
        vars: [],
        text:
            'Silahkan mengumpulkan list ukuran terlebih dahulu ya kak. Size yang tertera dalam satuan centimeter (cm) ya! 😇\n\n' +
            'nb.\n' +
            '1. Yang diukur adalah panjang baju x lebar baju ya. Lebar baju diukur dari bawah lengan baju (lihat ilustrasi pada size chart).\n' +
            '2. Toleransi jahit ±2cm',
    },
    location: {
        group: 'Pertanyaan umum',
        label: 'Lokasi / shareloc',
        when: 'Pelanggan menanyakan alamat, lokasi, atau jam buka.',
        vars: [],
        text:
            'Silahkan buat sharelocnya ya kak. Lokasi kami ada di Jl. H. Agus Salim, Purworejo, Jawa Tengah. Jam operasional mulai dari 8.30 sd 17.00 ya kak.\n\n' +
            'nb. Setiap hari Minggu pelayanan offline libur.',
    },
    locationMap: {
        group: 'Pertanyaan umum',
        label: 'Lokasi: link peta',
        when: 'Gelembung kedua setelah jawaban lokasi.',
        vars: [],
        text: 'https://maps.app.goo.gl/VcEFAFZVhP2x6o91A',
    },
    shipping: {
        group: 'Pertanyaan umum',
        label: 'Pengiriman dari mana',
        when: 'Pelanggan menanyakan asal pengiriman, ongkir, atau pengiriman ke kotanya.',
        vars: [],
        text: 'Pengiriman dari Purworejo, Jawa Tengah ya kak, namun jangan khawatir, kami melayani pengiriman keluar kota melalui rekanan ekspedisi. Kami sudah memiliki pelanggan dari Sabang - Merauke kak, jadi kami sudah terbiasa menghandle pengiriman ke luar daerah dengan ongkos kirim ekonomis mulai dari Rp 1.000/piece. 😇',
    },
    trust: {
        group: 'Pertanyaan umum',
        label: 'Ragu / takut ditipu',
        when: 'Pelanggan ragu, takut ditipu, atau minta testimoni. Dikirim bersama katalog review.',
        vars: [],
        text: 'Aman kakk, kami sudah vendor nasional kok. Kakak bisa cek portofolio kami kak, kami memiliki pelanggan dari Sabang sampai Merauke, jadi kakak tidak perlu khawatir. Setiap produk yang kami produksi juga bergaransi, misal ada ketidaksesuaian bisa digaransikan tanpa biaya tambahan. 😁',
    },
    moq1: {
        group: 'Pertanyaan umum',
        label: 'Minimal order (gelembung 1)',
        when: 'Pelanggan menanyakan minimal order.',
        vars: [],
        text:
            'Untuk minimum pemesanan, tiap produk berbeda ya kak 😊\n\n' +
            '• Kaos: bisa mulai 1 pcs, khusus bahan Cotton Combed 30s dengan pilihan warna marun, navy, army, putih, atau hitam. Kalau pesan lebih dari 12 pcs, warna dan jenis bahan bisa request.\n' +
            '• Bendera Printing: bisa mulai dari 1 pcs.',
    },
    moq2: {
        group: 'Pertanyaan umum',
        label: 'Minimal order (gelembung 2)',
        when: 'Langsung setelah gelembung 1.',
        vars: [],
        text:
            'Untuk produk lainnya:\n\n' +
            '• PDL, Rompi, Jersey, serta Paket ID Card & Lanyard: minimal 6 pcs\n' +
            '• Produk selain yang disebutkan di atas: minimal 12 pcs\n\n' +
            'Kalau kakak sudah tahu mau bikin produk apa dan jumlahnya berapa, boleh langsung diinfokan ya kak 😄',
    },
};

const MAX_LENGTH = 3000;

let overrides = null;

/** Team edits, keyed by template; loaded once and refreshed on every save. */
const edited = () => {
    overrides ??= new Map(
        all(`SELECT "key", value FROM settings WHERE "key" LIKE 'reply:%'`).map((row) => [row.key.slice(6), row.value]),
    );

    return overrides;
};

/** The text a template currently has (team edit, or the spec default). */
export function templateText(key) {
    if (key === 'jerseyPromo' && !edited().has(key)) {
        // Promo text set earlier in Pengaturan (before templates were editable).
        return config.bot.jerseyPromo || '';
    }

    return edited().get(key) ?? TEMPLATES[key].text;
}

/** Fills {bot}, {cs}, {nama}, {produk}. Null for an empty optional template (step skipped). */
export function render(key, vars = {}) {
    const text = templateText(key);

    if (!text) return null;

    const values = { bot: config.bot.botName, cs: config.bot.csName, ...vars };

    return text.replace(/\{(\w+)\}/g, (match, name) => (values[name] != null ? String(values[name]) : match));
}

const fail = (message) => {
    throw Object.assign(new Error(message), { statusCode: 422 });
};

/** Saves a team edit after checking it can always be filled in. */
export function updateTemplate(key, value) {
    const template = TEMPLATES[key] ?? fail('Template tidak dikenal');
    const text = String(value ?? '').replace(/\r\n/g, '\n').trim();

    if (!text && !template.optional) fail('Template tidak boleh kosong. Pakai "Kembalikan ke naskah asli" kalau ingin membatalkan.');
    if (text.length > MAX_LENGTH) fail(`Maksimal ${MAX_LENGTH} huruf`);

    const allowed = ['bot', 'cs', ...template.vars];
    const unknown = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((name) => !allowed.includes(name));

    if (unknown.length) {
        fail(`{${unknown[0]}} tidak bisa dipakai di sini. Yang tersedia: ${allowed.map((a) => `{${a}}`).join(', ')}`);
    }

    setSetting(`reply:${key}`, text);
    overrides = null;
}

export function resetTemplate(key) {
    if (!TEMPLATES[key]) fail('Template tidak dikenal');

    run(`DELETE FROM settings WHERE "key" = ?`, [`reply:${key}`]);
    overrides = null;
}

/** Everything the console's "Template balasan" page shows. */
export function listTemplates() {
    return Object.entries(TEMPLATES).map(([key, t]) => ({
        key,
        group: t.group,
        label: t.label,
        when: t.when,
        vars: ['bot', 'cs', ...t.vars],
        optional: Boolean(t.optional),
        default: t.text,
        text: templateText(key),
        changed: edited().has(key) && edited().get(key) !== t.text,
    }));
}

/** The engine's view: one function per bubble, same names as before. */
export const replies = {
    greetKnown: (nama) => render('greetKnown', { nama }),
    greetUnknown: () => render('greetUnknown'),
    afterIntro: (nama) => render('afterIntro', { nama }),
    askDesign: (produk) => render('askDesign', { produk }),
    askQuantity: () => render('askQuantity'),
    portfolio: () => render('portfolio'),
    jerseyTemplates: () => render('jerseyTemplates'),
    waitForCs: () => render('waitForCs'),
    socials: () => render('socials'),
    jerseyPromo: () => render('jerseyPromo'),
    sizeChartWhich: () => render('sizeChartWhich'),
    sizeChartNote: () => render('sizeChartNote'),
    location: () => render('location'),
    locationMap: () => render('locationMap'),
    shipping: () => render('shipping'),
    trust: () => render('trust'),
    moq1: () => render('moq1'),
    moq2: () => render('moq2'),
};
