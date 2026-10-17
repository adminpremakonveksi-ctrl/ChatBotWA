import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWithRules } from '../src/bot/classify-rules.js';

/**
 * How customers really write, in five levels, for every meaning the bot
 * knows. The offline classifier (no AI) must get each one right.
 *
 *   1  very short, shorthand and typos      "hrg jrsy brp", "loc?"
 *   2  casual chat                           "kak mau bikin kaos dong"
 *   3  standard, polite                      "Halo kak, saya mau pesan jersey futsal"
 *   4  Javanese / Sundanese / mixed          "badhe damel kaos, pinten regane mas"
 *   5  formal and long, several questions    "Selamat malam, perkenalkan saya ..."
 *
 * Each case: [level, step the bot is at, message, expected].
 * expected: an intent, "product:<key>", "pola:<pattern name>", or "intro:<Name>".
 */
const CASES = [
    // greeting
    [1, 'new', 'p', 'greeting'],
    [2, 'new', 'halo kakk', 'greeting'],
    [3, 'new', 'Selamat malam kak', 'greeting'],
    [4, 'new', 'sugeng dalu mas', 'greeting'],
    [4, 'new', 'kulo nuwun', 'greeting'],
    [4, 'new', 'punten', 'greeting'],
    [5, 'new', 'Assalamualaikum, selamat malam', 'greeting'],

    // introduction
    [1, 'awaiting_intro', 'budi jogja', 'intro:Budi'],
    [2, 'awaiting_intro', 'aku rina dr magelang kak', 'intro:Rina'],
    [3, 'awaiting_intro', 'Saya Andi dari Purworejo', 'intro:Andi'],
    [4, 'awaiting_intro', 'kulo Slamet saking Kutoarjo', 'intro:Slamet'],
    [4, 'awaiting_intro', 'nami kula Sri saking Kebumen', 'intro:Sri'],
    [4, 'awaiting_intro', 'abdi Asep ti Garut', 'intro:Asep'],
    [5, 'awaiting_intro', 'Perkenalkan, nama saya Dimas dari SMA 1 Purworejo', 'intro:Dimas'],

    // product
    [1, 'awaiting_product', 'jrsy', 'product:jersey'],
    [1, 'awaiting_product', 'hoddie', 'product:hoodie'],
    [2, 'awaiting_product', 'mau bikin kaos dong kak', 'product:kaos'],
    [2, 'awaiting_product', 'Mas nanya2 tentang jersey', 'product:jersey'],
    [3, 'awaiting_product', 'Saya ingin memesan jaket angkatan', 'product:jaket'],
    [4, 'awaiting_product', 'badhe damel klambi bal mas', 'product:jersey'],
    [4, 'awaiting_product', 'arep gawe kaos kelas', 'product:kaos'],
    [4, 'awaiting_product', 'hoyong damel pdl', 'product:pdl'],
    [5, 'awaiting_product', 'Kami dari OSIS berencana membuat seragam OSIS untuk pengurus baru', 'product:seragam-sekolah'],

    // price
    [1, 'awaiting_product', 'hrg?', 'price'],
    [2, 'awaiting_product', 'harganya brp kak', 'price'],
    [3, 'awaiting_quantity', 'Untuk biayanya kira-kira berapa ya kak?', 'price'],
    [4, 'awaiting_product', 'pinten regane mas?', 'price'],
    [4, 'awaiting_product', 'regine pinten nggih', 'price'],
    [5, 'awaiting_product', 'Mohon informasi kisaran harga per pcs nya', 'price'],

    // size chart
    [1, 'awaiting_product', 'sz chart', 'size_chart'],
    [2, 'awaiting_product', 'ukurannya ada apa aja kak', 'size_chart'],
    [3, 'awaiting_product', 'Boleh minta tabel ukurannya?', 'size_chart'],
    [4, 'awaiting_product', 'ukurane wonten nopo mawon', 'size_chart'],
    [5, 'awaiting_product', 'Apakah tersedia ukuran XXL untuk peserta dewasa?', 'size_chart'],

    // location
    [1, 'awaiting_product', 'loc?', 'pola:Lokasi'],
    [2, 'awaiting_product', 'alamatnya dmn kak', 'pola:Lokasi'],
    [3, 'awaiting_product', 'Lokasi tokonya di mana ya kak?', 'pola:Lokasi'],
    [4, 'awaiting_product', 'lokasine ten pundi mas', 'pola:Lokasi'],
    [4, 'awaiting_product', 'nggone neng endi to', 'pola:Lokasi'],
    [5, 'awaiting_product', 'Apakah saya bisa datang langsung ke workshop untuk melihat bahan?', 'pola:Lokasi'],

    // shipping
    [1, 'awaiting_product', 'ongkir?', 'pola:Pengiriman'],
    [2, 'awaiting_product', 'bs kirim ke makassar ga', 'pola:Pengiriman'],
    [3, 'awaiting_product', 'Pengirimannya dari mana ya kak?', 'pola:Pengiriman'],
    [4, 'awaiting_product', 'saged dikintun teng Surabaya?', 'pola:Pengiriman'],
    [5, 'awaiting_product', 'Apakah bisa dikirim ke luar pulau menggunakan ekspedisi?', 'pola:Pengiriman'],

    // trust
    [1, 'awaiting_product', 'amanah?', 'pola:Ragu / takut ditipu'],
    [2, 'awaiting_product', 'ini bukan penipuan kan kak', 'pola:Ragu / takut ditipu'],
    [3, 'awaiting_product', 'Ada testimoni pelanggan sebelumnya?', 'pola:Ragu / takut ditipu'],
    [4, 'awaiting_product', 'ora ngapusi to mas?', 'pola:Ragu / takut ditipu'],
    [5, 'awaiting_product', 'Terus terang saya masih ragu karena belum pernah order online', 'pola:Ragu / takut ditipu'],

    // minimum order
    [1, 'awaiting_product', 'min order?', 'pola:Minimal order'],
    [2, 'awaiting_product', 'bisa satuan ga kak', 'pola:Minimal order'],
    [3, 'awaiting_product', 'Minimal pemesanannya berapa ya?', 'pola:Minimal order'],
    [4, 'awaiting_product', 'minimale pinten mas', 'pola:Minimal order'],
    [4, 'awaiting_product', 'saged pesen sekedhik mboten', 'pola:Minimal order'],
    [5, 'awaiting_product', 'Berapa jumlah minimum pemesanan untuk setiap produk?', 'pola:Minimal order'],

    // design reference
    [1, 'awaiting_product', 'katalog', 'design_reference'],
    [2, 'awaiting_product', 'ada contoh desainnya ga kak', 'design_reference'],
    [3, 'awaiting_product', 'Boleh lihat portofolio hasil produksinya?', 'design_reference'],
    [4, 'awaiting_product', 'wonten contoh desain mboten', 'design_reference'],
    [5, 'awaiting_product', 'Saya ingin melihat referensi desain yang pernah dikerjakan', 'design_reference'],

    // design answers
    [1, 'awaiting_design', 'blm', 'no_reference'],
    [2, 'awaiting_design', 'blm ada kak bingung', 'no_reference'],
    [3, 'awaiting_design', 'Belum ada desain, bisa dibantu?', 'no_reference'],
    [4, 'awaiting_design', 'dereng wonten mas', 'no_reference'],
    [4, 'awaiting_design', 'durung ono desaine', 'no_reference'],
    [5, 'awaiting_design', 'Kami belum memiliki gambaran desain, mohon dibantu desainnya', 'no_reference'],
    [2, 'awaiting_design', 'udah ada kak nanti aku kirim', 'has_reference'],
    [4, 'awaiting_design', 'sampun wonten desaine', 'has_reference'],
    [5, 'awaiting_design', 'Desainnya warna navy dengan logo sekolah di dada kiri', 'has_reference'],

    // quantity
    [1, 'awaiting_quantity', '50', 'quantity'],
    [2, 'awaiting_quantity', 'sekitar 2 lusin kak', 'quantity'],
    [3, 'awaiting_quantity', 'Rencananya 30 pcs', 'quantity'],
    [4, 'awaiting_quantity', 'kinten-kinten 40 an mas', 'quantity'],
    [4, 'awaiting_quantity', 'satu kelas mas', 'quantity'],
    [5, 'awaiting_quantity', 'Untuk satu angkatan sekitar 120 orang', 'quantity'],

    // wants to ask first
    [1, 'awaiting_quantity', 'tny dlu', 'ask_first'],
    [2, 'awaiting_quantity', 'Mau nanya2 dulu mas', 'ask_first'],
    [3, 'awaiting_product', 'Izin bertanya kak', 'ask_first'],
    [4, 'awaiting_product', 'badhe takon-takon riyin', 'ask_first'],
    [4, 'awaiting_product', 'nyuwun pirsa mas', 'ask_first'],
    [5, 'awaiting_product', 'Saya masih survey beberapa vendor, belum mau pesan sekarang', 'ask_first'],

    // acknowledgement
    [1, 'awaiting_product', 'ok', 'ack'],
    [1, 'awaiting_product', '👍', 'ack'],
    [2, 'awaiting_design', 'siap kak makasih', 'ack'],
    [3, 'awaiting_product', 'Baik kak, terima kasih', 'ack'],
    [4, 'awaiting_product', 'nggih matur nuwun', 'ack'],
    [4, 'awaiting_product', 'hatur nuhun', 'ack'],
    [5, 'awaiting_product', 'Baik, terima kasih banyak atas informasinya', 'ack'],

    // second round: harder ones from real chats
    [1, 'new', 'pp', 'greeting'],
    [1, 'awaiting_product', 'ganci', 'product:gantungan-kunci'],
    [1, 'awaiting_product', 'lanyrd', 'product:id-card-lanyard'],
    [1, 'awaiting_product', 'alamt', 'pola:Lokasi'],
    [1, 'awaiting_product', 'cod?', 'pola:Pengiriman'],
    [1, 'awaiting_product', 'testi', 'pola:Ragu / takut ditipu'],
    [1, 'awaiting_product', 'moq', 'pola:Minimal order'],
    [1, 'awaiting_quantity', '2 lusin', 'quantity'],
    [2, 'awaiting_product', 'kak mau pesen kaos sablon buat komunitas', 'product:kaos'],
    [2, 'awaiting_product', 'jam bukanya smp jam brp kak', 'pola:Lokasi'],
    [2, 'awaiting_product', 'bs cod ga kak', 'pola:Pengiriman'],
    [2, 'awaiting_product', 'beneran amanah kan kak', 'pola:Ragu / takut ditipu'],
    [2, 'awaiting_product', 'bisa pesen 1 aja ga', 'pola:Minimal order'],
    [2, 'awaiting_product', 'liat contoh hasil sablonnya dong', 'design_reference'],
    [2, 'awaiting_design', 'terserah kakak aja', 'no_reference'],
    [2, 'awaiting_product', 'oke siap kak', 'ack'],
    [2, 'awaiting_product', 'cuma nanya2 aja kak', 'ask_first'],
    [3, 'awaiting_product', 'Saya mau buat bendera untuk acara kampus', 'product:bendera-printing'],
    [3, 'awaiting_product', 'Apakah bisa membuat topi dengan bordir logo?', 'product:topi'],
    [3, 'awaiting_product', 'Berapa harga per pcs nya kak?', 'price'],
    [3, 'awaiting_product', 'Tokonya buka sampai jam berapa?', 'pola:Lokasi'],
    [3, 'awaiting_product', 'Bisa dikirim ke Jakarta?', 'pola:Pengiriman'],
    [3, 'awaiting_design', 'Belum kepikiran kak', 'no_reference'],
    [3, 'awaiting_product', 'Saya mau bertanya dulu kak', 'ask_first'],
    [4, 'awaiting_product', 'badhe tumbas jaket mas, wonten?', 'product:jaket'],
    [4, 'awaiting_product', 'nek gawe hoodie piro regane', 'product:hoodie'],
    [4, 'awaiting_product', 'regane piro mas', 'price'],
    [4, 'awaiting_product', 'saged kintun mriki mboten', 'pola:Pengiriman'],
    [4, 'awaiting_product', 'alamate pundi nggih', 'pola:Lokasi'],
    [4, 'awaiting_product', 'iso pesen siji ora', 'pola:Minimal order'],
    [4, 'awaiting_product', 'aman to mas ora diapusi', 'pola:Ragu / takut ditipu'],
    [4, 'awaiting_design', 'mboten wonten mas, bingung', 'no_reference'],
    [4, 'awaiting_design', 'manut mawon', 'no_reference'],
    [4, 'awaiting_quantity', 'kinten-kinten selusin', 'quantity'],
    [4, 'awaiting_product', 'nggih mas suwun', 'ack'],
    [4, 'awaiting_product', 'mangke riyin nggih, tak takon kanca kanca', 'ask_first'],
    [5, 'awaiting_product', 'Kami dari karang taruna ingin memesan jersey futsal sejumlah 15 stel untuk turnamen', 'product:jersey'],
    [5, 'awaiting_product', 'Bisakah saya mendapatkan daftar harga untuk pemesanan dalam jumlah besar?', 'design_reference'],
    [5, 'awaiting_product', 'Mohon maaf mengganggu, saya ingin menanyakan beberapa hal terlebih dahulu', 'ask_first'],
    [5, 'awaiting_product', 'Berapa estimasi pengiriman ke Kalimantan dan menggunakan ekspedisi apa?', 'pola:Pengiriman'],

    // third round: the wider variations
    [1, 'new', 'asw', 'greeting'],
    [1, 'new', 'met malam', 'greeting'],
    [1, 'awaiting_product', '3xl ada?', 'size_chart'],
    [1, 'awaiting_product', 'ongkirnya?', 'pola:Pengiriman'],
    [1, 'awaiting_product', 'gratis ongkir?', 'pola:Pengiriman'],
    [1, 'awaiting_product', 'nego?', 'price'],
    [1, 'awaiting_product', 'pickup bisa?', 'pola:Lokasi'],
    [1, 'awaiting_product', 'refund?', 'pola:Ragu / takut ditipu'],
    [1, 'awaiting_product', 'tq', 'ack'],
    [1, 'awaiting_design', 'ss', 'has_reference'],
    [2, 'awaiting_product', 'kak ini jualan apa aja sih', 'design_reference'],
    [2, 'awaiting_product', 'muat buat badan gede ga kak', 'size_chart'],
    [2, 'awaiting_product', 'kalo ga sesuai bisa retur ga', 'pola:Ragu / takut ditipu'],
    [2, 'awaiting_product', 'cuma butuh 5 pcs bisa?', 'pola:Minimal order'],
    [2, 'awaiting_product', 'nyampe berapa hari ke medan', 'pola:Pengiriman'],
    [2, 'awaiting_product', 'hari minggu buka ga kak', 'pola:Lokasi'],
    [2, 'awaiting_product', 'paling murah brp kak', 'price'],
    [2, 'awaiting_product', 'lagi nyari vendor kak', 'ask_first'],
    [2, 'awaiting_product', 'yaudah kak makasi', 'ack'],
    [2, 'awaiting_design', 'tolong desainkan aja kak', 'no_reference'],
    [3, 'awaiting_product', 'Boleh saya minta penawaran harga?', 'price'],
    [3, 'awaiting_product', 'Apakah bisa diambil langsung di tempat?', 'pola:Lokasi'],
    [3, 'awaiting_product', 'Sudah berapa lama konveksinya berdiri?', 'pola:Ragu / takut ditipu'],
    [3, 'awaiting_product', 'Apakah menerima pesanan satuan?', 'pola:Minimal order'],
    [3, 'awaiting_product', 'Bisa minta daftar produknya?', 'design_reference'],
    [3, 'awaiting_design', 'Nanti saya kirim gambarnya kak', 'has_reference'],
    [3, 'awaiting_design', 'Mohon dibantu desainnya saja kak', 'no_reference'],
    [3, 'awaiting_product', 'Saya pikir-pikir dulu ya kak', 'ask_first'],
    [4, 'awaiting_product', 'sugeng enjing', 'greeting'],
    [4, 'awaiting_product', 'sampurasun', 'greeting'],
    [4, 'awaiting_product', 'ukurane pinten mawon mas', 'size_chart'],
    [4, 'awaiting_product', 'wonten pundi mas tokone', 'pola:Lokasi'],
    [4, 'awaiting_product', 'iso dikirim neng Jakarta ra', 'pola:Pengiriman'],
    [4, 'awaiting_product', 'tenan to iki, ora apus apus', 'pola:Ragu / takut ditipu'],
    [4, 'awaiting_product', 'nek siji wae iso ra', 'pola:Minimal order'],
    [4, 'awaiting_product', 'nyuwun contone mas', 'design_reference'],
    [4, 'awaiting_product', 'sabaraha hargana a', 'price'],
    [4, 'awaiting_design', 'durung nduwe mas, bingung', 'no_reference'],
    [4, 'awaiting_design', 'koyo ngene mas', 'has_reference'],
    [4, 'awaiting_product', 'sendiko dawuh', 'ack'],
    [4, 'awaiting_product', 'arep takon sik mas', 'ask_first'],
    [5, 'awaiting_product', 'Apakah usaha Anda sudah memiliki badan usaha resmi?', 'pola:Ragu / takut ditipu'],
    [5, 'awaiting_product', 'Mohon dikirimkan estimasi biaya untuk 100 pcs kaos', 'product:kaos'],
    [5, 'awaiting_product', 'Bagaimana ketentuan minimal pemesanan untuk jaket?', 'pola:Minimal order'],
    [5, 'awaiting_product', 'Saya sedang membandingkan beberapa vendor konveksi', 'ask_first'],
    [5, 'awaiting_product', 'Terima kasih atas penjelasannya, sangat membantu', 'ack'],

    // fourth round (migration 007, jas almamater, krama)
    [1, 'awaiting_product', 'almet', 'product:jas-almamater'],
    [2, 'awaiting_product', 'harga borongan brp kak', 'price'],
    [2, 'awaiting_product', 'oke nanti saya kabari ya kak', 'ack'],
    [3, 'awaiting_product', 'Saya mau pesan Kemeja 2000 PCS', 'product:kemeja'],
    [3, 'awaiting_product', 'Kalau tidak sesuai ada garansinya?', 'pola:Ragu / takut ditipu'],
    [4, 'awaiting_product', 'badhe damel jas almamater kangge kampus', 'product:jas-almamater'],
    [4, 'awaiting_product', 'menawi kulo mundhut kaos saged dikintun dumugi Makassar?', 'pola:Pengiriman'],
    [5, 'awaiting_product', 'Kami masih menimbang beberapa penawaran', 'ask_first'],
];

/**
 * Messages that must NOT be caught by the wrong answer: a word that only
 * looks like a keyword ("karyawan" is not "karya", "Rabu" is not "RAB").
 */
const NOT = [
    ['awaiting_product', 'mau bikin kaos untuk karyawan', 'product:kaos'],
    ['awaiting_product', 'ukurannya gimana kak', 'size_chart'],
    ['awaiting_product', 'cara bayarnya gimana', 'other'],
    ['awaiting_product', 'hari rabu bisa?', 'other'],
    ['awaiting_product', 'posisi saya di semarang', 'other'],
    ['awaiting_product', 'pengerjaannya berapa lama', 'other'],
    ['awaiting_product', 'bisa dp dulu?', 'other'],
    ['awaiting_product', 'Baik kak, terima kasih', 'ack'],
];

test('look-alike words do not trigger the wrong answer', () => {
    const wrong = NOT.map(([step, text, expected]) => {
        const got = label(classifyWithRules({ text, step }));

        return got === expected ? null : `"${text}": ${got}, expected ${expected}`;
    }).filter(Boolean);

    assert.deepEqual(wrong, []);
});

const label = (r) => {
    if (r.intent === 'custom') return `pola:${r.pattern.name}`;
    if (r.intent === 'product') return `product:${r.product}`;
    if (r.intent === 'introduction') return `intro:${r.name}`;

    return r.intent;
};

for (const level of [1, 2, 3, 4, 5]) {
    test(`level ${level}: every meaning is recognised`, () => {
        const wrong = CASES.filter(([l]) => l === level)
            .map(([, step, text, expected]) => {
                const r = classifyWithRules({ text, step });
                const got = expected.startsWith('intro:') ? `intro:${r.name}` : label(r);

                return got === expected ? null : `"${text}" (${step}): ${got}, expected ${expected}`;
            })
            .filter(Boolean);

        assert.deepEqual(wrong, []);
    });
}
