import { config } from '../config.js';
import { all, run, setSetting } from '../db.js';
import { listProducts } from './products.js';

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
    welcome: {
        group: 'Sapaan',
        label: 'Salam pembuka (menggantikan [2])',
        when: 'Pesan pertama pelanggan yang belum memperkenalkan diri. Kosongkan untuk memakai [2] dari spesifikasi.',
        vars: [],
        optional: true,
        text:
            'Halo kak 👋! Saya {bot}, Narahubung Prema Konveksi. Sebelumnya ini dengan kak *siapa* dan *darimana* ya?\n\n' +
            'Rencana mau pesan/tanya-tanya produk apa nih?\n' +
            '- Kaos Sablon/Polo\n- Kemeja PDH/PDL\n- Rompi\n- Jaket\n- Jersey\n- Lanyard & ID Card\n- Jas Almamater\n- Produk lainnya\n\n' +
            '-------\n\n*no call, text only*\n\n' +
            '_nb. Khusus hari MINGGU pelayanan melalui CS sedikit slow response, terima kasih_',
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
    introAgain: {
        group: 'Sapaan',
        label: 'Kenalan lagi di tengah obrolan',
        when: 'Pelanggan menyebut atau membetulkan namanya di tengah alur ("eh salah, nama saya Haikal"). Nama diganti, alur tetap di pertanyaan yang sedang ditunggu.',
        vars: ['nama'],
        text: 'Siap Kak {nama}, salam kenal ya 😊',
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
    askQuantityCatalog: {
        group: 'Alur pemesanan',
        label: '[5] Minta jumlah, setelah katalog',
        when: 'Setelah katalog produk ber-price list (jersey, ID card, dll) dikirim. Belum ada obrolan desain, jadi tanpa kalimat "desainnya akan kami cek".',
        vars: [],
        text: 'Kalau perihal jumlah pemesanannya, rencana kakak mau bikin berapa produk nih?',
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
    catalogLink: {
        group: 'Alur pemesanan',
        label: 'Link katalog WhatsApp',
        when: 'Dikirim sebagai katalog untuk produk yang memakai link katalog WhatsApp Business (atur di halaman Media).',
        vars: ['link', 'produk'],
        text: 'Berikut katalog {produk} kami ya kak, silakan dicek 👇\n{link}',
    },
    jerseyPromo: {
        group: 'Alur pemesanan',
        label: '[9] Promo jersey',
        when: 'Saat pelanggan menanyakan jersey, setelah katalog dan pamflet promo. Kosongkan kalau sedang tidak ada promo.',
        vars: [],
        optional: true,
        text: '',
    },

    askFirst: {
        group: 'Pertanyaan umum',
        label: 'Mau tanya-tanya dulu',
        when: 'Pelanggan bilang mau bertanya dulu ("mau nanya2 dulu", "masih survey") tanpa pertanyaan. Bot menunggu pertanyaannya, tidak menyerahkan ke CS.',
        vars: [],
        text: 'Boleh banget kak, silakan ditanyakan saja ya 😊',
    },
    priceWhich: {
        group: 'Pertanyaan umum',
        label: 'Harga: tanya produknya',
        when: 'Pelanggan menanyakan harga tanpa menyebut produk.',
        vars: [],
        text: 'Harga untuk produk apa ya kak? Biar aku bantu kirim info yang sesuai 😉',
    },

    clarify: {
        group: 'Penutup',
        label: 'Belum paham, tanya ulang',
        when: 'Pesan yang tidak dipahami bot. Bot menanyakan ulang dulu; baru diserahkan ke CS setelah beberapa kali berturut-turut (atur jumlahnya di Pengaturan).',
        vars: [],
        text:
            'Maaf kak, {bot} belum paham maksudnya 🙏 Boleh dijelaskan lagi dengan kalimat lain? Misalnya mau tanya produk, harga, ukuran, lokasi, atau pengiriman 😊\n---\n' +
            'Mohon maaf kak, {bot} masih kurang menangkap maksudnya 🙏 Boleh diceritakan lagi kakak mau tanya atau pesan apa?\n---\n' +
            'Maaf kak, bisa diperjelas lagi? 🙏 {bot} bisa bantu soal produk, harga, ukuran, desain, lokasi, dan pengiriman 😊',
    },
    handoverNotice: {
        group: 'Penutup',
        label: 'Dioper ke CS',
        when: 'Bubble terakhir setiap kali bot menyerahkan pelanggan ke CS (alur selesai, pertanyaan tidak dikenali, pesan berulang). Tidak dikirim kalau CS sendiri yang membalas dari HP. Kosongkan untuk mematikan.',
        vars: [],
        optional: true,
        text: 'Ok, request nya kami alihkan ke CS kami di waktu kerja ya kak 🙏',
    },

    sizeChartWhich: {
        group: 'Pertanyaan umum',
        label: 'Size chart: tanya produknya',
        when: 'Pelanggan minta size chart tanpa menyebut produk.',
        vars: [],
        text: 'Size chart untuk produk apa ya kak? Biar aku bantu kirim yang sesuai 😉',
    },
    productUnknown: {
        group: 'Pertanyaan umum',
        label: 'Produk yang tidak ada di daftar',
        when: 'Pelanggan menanyakan produk yang tidak dikenali bot (mis. sepatu, tas ransel). Bot tidak menutup chat; CS mengecek nanti. {daftar_produk} = semua produk di halaman Produk, otomatis.',
        vars: ['daftar_produk'],
        text: 'Untuk produk itu nanti dicek dulu oleh CS {cs} ya kak 🙏 Produk yang biasa kami buat antara lain {daftar_produk} 😊',
    },
    aiUnknown: {
        group: 'Pertanyaan umum',
        label: 'AI belum tahu, tawarkan CS',
        when: 'Hanya kalau AI aktif: pertanyaan yang tidak ada jawabannya di catatan toko, atau terlalu jauh dari urusan konveksi. Kalau pelanggan menjawab "iya/boleh", diserahkan ke CS (daftar katanya di Kamus).',
        vars: [],
        text: 'Waduh maaf kak, untuk yang itu {bot} belum tahu jawabannya 🙏 Apa mau {bot} oper ke CS {cs} langsung?',
    },
    detailLater: {
        group: 'Pertanyaan umum',
        label: 'Jawaban menyusul (mis. list ukuran)',
        when: 'Pelanggan bilang jawaban pertanyaan lanjutan menyusul ("nanti saya kabari", "masih dikumpulkan"). Chat tidak ditutup: bot menunggu jawabannya (lamanya di Pengaturan, "Lama menunggu jawaban lanjutan").',
        vars: [],
        text: 'Siap kak, ditunggu ya kabarnya 😊 Kalau list ukuran/datanya sudah lengkap, langsung kirim ke sini saja ya kak, nanti {bot} teruskan ke CS {cs}.',
    },
    csQuestion: {
        group: 'Pertanyaan umum',
        label: 'Pertanyaan yang dijawab CS',
        when: 'Pertanyaan yang jelas tetapi hanya CS yang tahu jawabannya: DP, cara bayar, lama pengerjaan, status pesanan, komplain. Bot mencatatnya untuk CS (muncul di Percakapan dan rekap pagi) dan percakapan tetap berjalan.',
        vars: [],
        text: 'Pertanyaan kakak sudah {bot} catat ya kak, nanti dijawab langsung oleh CS {cs} begitu online 🙏',
    },
    imageReceived: {
        group: 'Pertanyaan umum',
        label: 'Gambar / file / lokasi diterima',
        when: 'Pelanggan mengirim gambar, video, file, lokasi atau kontak tanpa keterangan, di luar langkah desain. {lampiran} = gambarnya / filenya / lokasinya / videonya / kontaknya. Isinya dicatat untuk CS.',
        vars: ['lampiran'],
        text: 'Terima kasih kak, {lampiran} sudah {bot} terima. Nanti dicek oleh CS {cs} ya 🙏',
    },
    voiceNote: {
        group: 'Pertanyaan umum',
        label: 'Pesan suara',
        when: 'Pelanggan mengirim voice note. Bot tidak bisa mendengar pesan suara.',
        vars: [],
        text: 'Maaf kak, {bot} belum bisa mendengar pesan suara 🙏 Boleh diketik saja ya kak?',
    },
    aboutBot: {
        group: 'Pertanyaan umum',
        label: '"Kamu bot ya?"',
        when: 'Pelanggan bertanya apakah yang membalas bot atau manusia. Bot menjawab jujur dan tetap membantu.',
        vars: [],
        text: 'Yang membalas sekarang {bot}, AI Agent Prema Konveksi, sembari menunggu CS {cs} online kak 😊 Ada yang bisa {bot} bantu? Kalau mau langsung dengan CS, bilang saja ya kak.',
    },
    sizeChartMissing: {
        group: 'Pertanyaan umum',
        label: 'Size chart: belum ada filenya',
        when: 'Pelanggan minta size chart produk yang file/link-nya belum diisi di halaman Media. Bot tidak menutup chat; CS mengirimkannya nanti.',
        vars: ['produk'],
        text: 'Untuk size chart {produk} nanti dikirimkan CS {cs} ya kak 🙏',
    },
    priceDesign: {
        group: 'Pertanyaan umum',
        label: 'Harga: produk tergantung desain',
        when: 'Pelanggan menanyakan harga lagi untuk produk yang harganya tergantung jumlah & desain. Bot menjelaskan lalu melanjutkan alur, tidak menutup chat.',
        vars: ['produk'],
        text: 'Untuk harga {produk} bergantung dengan jumlah pemesanan dan desain kak. Nanti CS {cs} hitungkan setelah datanya lengkap ya 😊',
    },
    sizeChartLink: {
        group: 'Pertanyaan umum',
        label: 'Size chart: link',
        when: 'Kalau slot size chart di halaman Media diisi link (bukan gambar), bot mengirim kalimat ini dengan link-nya.',
        vars: ['link', 'produk'],
        text: 'Berikut size chart {produk} ya kak 👇\n{link}',
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
};

const MAX_LENGTH = 3000;

let overrides = null;

const edited = () => {
    overrides ??= new Map(
        all(`SELECT "key", value FROM settings WHERE "key" LIKE 'reply:%'`).map((row) => [row.key.slice(6), row.value]),
    );

    return overrides;
};

export function templateText(key) {
    if (key === 'jerseyPromo' && !edited().has(key)) {
        return config.bot.jerseyPromo || '';
    }

    return edited().get(key) ?? TEMPLATES[key].text;
}

export function fillText(text, vars = {}) {
    const values = { bot: config.bot.botName, cs: config.bot.csName, nama: '', ...vars };

    return text
        .replace(/\{(\w+)\}/g, (match, name) => (values[name] != null ? String(values[name]) : match))
        .replace(/ +([,.!?])/g, '$1')
        .replace(/[ \t]{2,}/g, ' ');
}

const VERSION_LINE = /\n[ \t]*---[ \t]*\n/;

export function render(key, vars = {}, version = null) {
    const text = templateText(key);

    if (!text) return null;

    const versions = text.split(VERSION_LINE).map((v) => v.trim()).filter(Boolean);
    const chosen = versions[version == null ? Math.floor(Math.random() * versions.length) : version % versions.length] ?? text;
    const values = { bot: config.bot.botName, cs: config.bot.csName, ...vars };

    return chosen.replace(/\{(\w+)\}/g, (match, name) => (values[name] != null ? String(values[name]) : match));
}

export const renderAll = (key, vars = {}) => {
    const text = templateText(key) ?? '';
    const count = text.split(VERSION_LINE).filter((v) => v.trim()).length || 1;

    return Array.from({ length: count }, (_, i) => render(key, vars, i));
};

const fail = (message) => {
    throw Object.assign(new Error(message), { statusCode: 422 });
};

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

export const forgetTemplates = () => {
    overrides = null;
};

export function resetTemplate(key) {
    if (!TEMPLATES[key]) fail('Template tidak dikenal');

    run(`DELETE FROM settings WHERE "key" = ?`, [`reply:${key}`]);
    overrides = null;
}

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

export function productListText() {
    const names = listProducts().map((p) => p.name);

    return names.length > 1 ? `${names.slice(0, -1).join(', ')} dan ${names.at(-1)}` : names[0] ?? 'berbagai produk konveksi';
}

export const replies = {
    greetKnown: (nama) => render('greetKnown', { nama }),
    greetUnknown: () => render('welcome') ?? render('greetUnknown'),
    afterIntro: (nama) => render('afterIntro', { nama }),
    introAgain: (nama) => render('introAgain', { nama }),
    askDesign: (produk) => render('askDesign', { produk }),
    askQuantity: () => render('askQuantity'),
    askQuantityCatalog: () => render('askQuantityCatalog'),
    askFirst: () => render('askFirst'),
    priceWhich: () => render('priceWhich'),
    portfolio: () => render('portfolio'),
    jerseyTemplates: () => render('jerseyTemplates'),
    waitForCs: () => render('waitForCs'),
    handoverNotice: () => render('handoverNotice'),
    clarify: (n = 0) => render('clarify', {}, n),
    isClarify: (text) => renderAll('clarify').includes(text),
    sizeChartMissing: (produk) => render('sizeChartMissing', { produk }),
    productUnknown: () => render('productUnknown', { daftar_produk: productListText() }),
    aboutBot: () => render('aboutBot'),
    csQuestion: () => render('csQuestion'),
    aiUnknown: () => render('aiUnknown'),
    detailLater: () => render('detailLater'),
    imageReceived: (lampiran = 'gambarnya') => render('imageReceived', { lampiran }),
    voiceNote: () => render('voiceNote'),
    priceDesign: (produk) => render('priceDesign', { produk }),
    socials: () => render('socials'),
    jerseyPromo: () => render('jerseyPromo'),
    catalogLink: (link, produk) => render('catalogLink', { link, produk }),
    sizeChartLink: (link, produk) => render('sizeChartLink', { link, produk }),
    sizeChartWhich: () => render('sizeChartWhich'),
    sizeChartNote: () => render('sizeChartNote'),
};
