/**
 * Prema Konveksi's own answers to the 75 questions ("PREMA KONVEKSI — MASTER
 * KNOWLEDGE CHATBOT MAWAR", versi 1.1, 22 Oktober 2026, confirmed by the owner).
 * Seeded once by migration 019 into what the team edits in the console
 * (Pengetahuan, Produk): only fields still empty are filled, so later edits by
 * the owner are never overwritten.
 *
 * Decisions taken with the client on 2026-10-24:
 *  - the fixed amounts in this document (size surcharges, the design fee
 *    range) may be quoted by Mawar exactly as written; product prices and
 *    totals stay with CS;
 *  - size surcharge group A is the table on page 14 (XXL +5.000, then +4.000
 *    per size: 3XL +9.000, 4XL +13.000, 5XL +17.000), not the summary on page 1.
 */

export const PREMA_TOPICS = [
    {
        title: 'Tentang Prema',
        content: `Nama usaha: PREMA KONVEKSI (tulisan merek yang benar: PREMA). Layanan produksi pakaian, apparel, seragam dan merchandise custom untuk perorangan maupun kelompok.
Pelanggan terbanyak: pelajar SMP, SMA/SMK dan mahasiswa, biasanya koordinator pesanan kelompok (OSIS, ekstrakurikuler, HIMA, ketua kelas, panitia). Juga melayani perusahaan, instansi, komunitas dan perorangan.
Pesanan biasanya untuk identitas kelompok: seragam OSIS/ekskul, PDL organisasi, kemeja korsa, seragam HIMA, jersey dan kaos kelas, jersey tim, pakaian komunitas, atribut panitia, ID card dan lanyard.
Pelanggan dari Purworejo dan dari luar daerah (Kalimantan, Sumatera, Sulawesi, Papua). Melayani seluruh Indonesia, tidak hanya Pulau Jawa.
Musim ramai: Oktober–Desember. Slot produksi bisa terbatas, sarankan konsultasi dan pesan lebih awal. Jangan menjanjikan kapasitas produksi; itu dicek CS.`,
    },
    {
        title: 'Alamat & lokasi workshop',
        content: `Prema Konveksi, Jalan Haji Agus Salim, Ruko Tegalsari Nomor 2, Kelurahan Purworejo, Kabupaten Purworejo, Jawa Tengah.
Google Maps: https://maps.app.goo.gl/hJZ2RZwcsNNeawc86 (pakai link ini, bukan lokasi usaha lain yang namanya mirip).
Boleh datang langsung di jam operasional tanpa janji. Disarankan konfirmasi dulu ke admin supaya pelayanan bisa disiapkan. Jangan bilang kunjungan harus reservasi.
Tidak ada cabang, dan belum ada rencana cabang yang diumumkan.`,
    },
    {
        title: 'Jam kerja CS',
        content: `Senin–Sabtu 08.30–17.00 WIB. Minggu bukan hari operasional reguler: chat tetap bisa dibalas tapi lebih lambat. Tanggal merah mengikuti informasi dari admin.
Pertanyaan boleh diterima kapan saja, tapi jangan menjanjikan respons cepat dari staf di luar jam kerja.`,
    },
    {
        title: 'Sosial media & kontak',
        content: `Instagram @premakonveksi, TikTok @premakonveksi (promosi, portofolio, info produk). Telegram: t.me/portofolioprema (referensi dan portofolio).
WhatsApp utama Prema Konveksi: 0819-9991-1895, saluran utama konsultasi dan pemesanan.
Belum ada marketplace aktif.`,
    },
    {
        title: 'Cara pesan (langkah dari awal sampai barang sampai)',
        content: `1. Konsultasi awal: pelanggan menyampaikan produk dan kebutuhannya.
2. Pengumpulan spesifikasi: produk, jumlah, bahan, model, warna, ukuran, desain, tanggal dibutuhkan.
3. Penawaran oleh CS (harga dan persyaratan).
4. Kesepakatan dan pembayaran DP.
5. Pembuatan Work Order (rincian produk dan spesifikasi).
6. ACC Work Order oleh pelanggan: pesanan terkunci dan estimasi produksi mulai dihitung.
7. Produksi dan quality control.
8. Admin mengabarkan pesanan selesai.
9. Pelunasan saat pengambilan atau sebelum pengiriman.
10. Pengambilan atau pengiriman.
11. Purnajual: keluhan sesuai ketentuan komplain dan garansi.
Mawar hanya menjelaskan dan mengumpulkan kebutuhan. Penawaran final, persetujuan order, pembayaran dan closing dilakukan CS.`,
    },
    {
        title: 'Minimal order & pesan satuan',
        content: `Kaos Cotton Combed 30s warna standar (hitam, putih, navy, marun, army): bisa 1 pcs.
Bendera printing: bisa 1 pcs.
PDL: minimal 6 pcs. Rompi: minimal 6 pcs. Jersey: minimal 6 pcs. Paket ID card dan lanyard: minimal 6 paket.
Produk lain umumnya minimal 12 pcs, kecuali katalog menyebut lain (katalog resmi diutamakan).
Pesanan dengan beberapa desain atau warna: perhitungan minimal order dicek CS. Jangan menggabungkan jumlah beda desain/warna untuk memenuhi minimal order tanpa persetujuan CS.`,
    },
    {
        title: 'Campur ukuran & warna',
        content: `Ukuran boleh dicampur dalam satu pesanan (S, M, L, XL, XXL, dst. sesuai size chart). Minta pelanggan menyiapkan rincian jumlah per ukuran dengan benar.
Warna tergantung produk, bahan, jumlah dan ketersediaan. Kaos satuan Cotton Combed 30s hanya hitam, putih, navy, marun, army. Kaos lebih dari 12 pcs boleh mengajukan bahan dan warna lain sesuai katalog.
Beberapa warna dalam satu pesanan boleh diajukan; kalau warna berbeda juga beda desain, minimal order dan biaya tambahannya dicek CS.
Mencocokkan warna dengan contoh pelanggan (warna logo, foto seragam, kode warna) bisa diajukan, tapi kecocokan dan ketersediaan dikonfirmasi CS. Jangan menjanjikan warna 100% sama, terutama antara layar dan kain.`,
    },
    {
        title: 'Ukuran & tambahan biaya ukuran besar',
        content: `Ukuran mengikuti size chart resmi tiap produk; pakai size chart produk itu sendiri, jangan dari produk lain. Pakaian dewasa tersedia sampai 5XL. Ukuran awal dan ukuran anak mengikuti size chart masing-masing produk.
Tambahan ukuran besar untuk kaos, kaos raglan, kemeja PDL/PDH/korsa, jaket, rompi, polo dan jas almamater: XXL +Rp5.000, 3XL +Rp9.000, 4XL +Rp13.000, 5XL +Rp17.000 (setelah XXL naik Rp4.000 per tingkat).
Tambahan untuk jersey, per item: XXL +Rp5.000, 3XL +Rp10.000, 4XL +Rp15.000, 5XL +Rp20.000. Jersey setelan: tambahan dihitung untuk atasan dan celana masing-masing (setelan XXL: Rp5.000 atasan + Rp5.000 celana).
Topi: all size dan bisa disesuaikan, tidak ada tambahan ukuran.
Produk lain: mengikuti katalog.
Ukuran custom atau ukur badan: dikonsultasikan ke CS, tidak semua produk bisa.`,
    },
    {
        title: 'Bahan (umum)',
        content: `Pelanggan tidak bisa membawa bahan sendiri: Prema memakai bahan sendiri, sistemnya all-in sesuai spesifikasi pesanan.
Pilihan bahan mengikuti katalog dan guidebook resmi yang berlaku. Jangan menganggap bahan yang umum di pasaran pasti tersedia di Prema.
Jangan menjanjikan sifat tertentu (anti air, anti luntur, ketebalan pasti) tanpa data bahan resmi. Contoh bahan dan detailnya bisa ditanyakan ke admin.`,
    },
    {
        title: 'Model & permintaan custom',
        content: `Tiap produk punya banyak model dan variasi, tapi belum ada daftar model yang bisa langsung dijanjikan.
Model custom sesuai referensi pelanggan diterima untuk dicek: minta foto referensi, kumpulkan info dasar, lalu teruskan ke CS (pola, bahan, jumlah, kemungkinan biaya tambahan).
Komponen tambahan (kerah, saku, resleting, kancing, furing, dll.) bisa dipertimbangkan tergantung produk dan model; jangan menjamin bisa dibuat atau menyebut biayanya.
Produk di luar daftar: Prema terbuka untuk pakaian atau barang yang dikenakan di badan selama memungkinkan secara teknis, tapi jangan dijanjikan. Minta referensi dan teruskan ke CS. Jangan mengumumkan rencana produk baru.`,
    },
    {
        title: 'Cara cetak & penempatan logo',
        content: `Metode yang dikonfirmasi per produk: kaos sablon atau bordir; PDL, PDH/korsa bordir; jas almamater bordir; rompi bordir; jaket bordir, printing atau sablon; jersey printing; ID card dan lanyard printing; topi sablon atau bordir; bendera printing; gantungan kunci printing; pin jarum printing.
Metode di luar daftar itu boleh diajukan ke CS tapi tidak boleh dijanjikan Mawar.
Logo boleh di area yang memungkinkan (depan, belakang, lengan, dll.) sesuai bentuk produk; area khusus diteruskan ke CS.
Jersey: nama dan nomor berbeda tiap baju bisa, dan personalisasi nama serta nomor gratis. Perubahan artwork lain di luar nama dan nomor tidak otomatis gratis. Minta pelanggan menyiapkan daftar nama dan nomor; format akhirnya mengikuti arahan CS.`,
    },
    {
        title: 'Desain & revisi',
        content: `Prema membantu desain sesuai kebutuhan produksi. Pesanan lebih dari 12 pcs: jasa desain gratis. Pesanan 12 pcs atau kurang dengan desain sederhana: bisa dipertimbangkan gratis. Pesanan 12 pcs atau kurang dengan desain rumit: umumnya Rp25.000–Rp50.000. Desain sangat rumit bisa lebih dari Rp50.000. Gratis atau tidak dan nilai pastinya diputuskan CS setelah melihat referensi; Mawar tidak menetapkan biaya desain.
Revisi desain tidak dibatasi sebelum ACC. Setelah ACC desain atau ACC Work Order pesanan final dan tidak bisa direvisi; jangan menjanjikan pengecualian.
Sebelum produksi ada desain atau mockup untuk dicek. Mockup adalah gambaran, bukan foto barang jadi.
File desain boleh format apa saja (JPG, PNG, PDF, screenshot, foto). Tidak perlu file vektor; tim bisa membantu mengolah ulang.
Portofolio: Instagram @premakonveksi, TikTok @premakonveksi, Telegram t.me/portofolioprema.`,
    },
    {
        title: 'Pembayaran & DP',
        content: `DP pelanggan dalam Kabupaten Purworejo minimal 50%; luar Kabupaten Purworejo 60%. Keringanan DP bisa diajukan, keputusannya oleh admin; Mawar tidak menyetujui perubahan DP.
Pelunasan setelah produk selesai, saat diambil atau sebelum dikirim, paling lambat H+5 sejak pemberitahuan barang selesai.
Pembayaran lewat transfer rekening dan cara lain dari Prema. Nomor rekening, QRIS dan instruksi bayar hanya dari admin; Mawar tidak memberikannya.
Nota, invoice atau kuitansi bisa untuk setiap pesanan (sekolah, instansi); kebutuhan khusus disampaikan ke admin.`,
    },
    {
        title: 'Lama pengerjaan',
        content: `Estimasi standar: kaos 2–3 minggu; jersey 2–3 minggu; kemeja PDL 3–4 minggu; rompi 3–4 minggu; jaket 5–6 minggu; jas almamater 5–6 minggu; ID card dan lanyard 7–14 hari; bendera printing 7–10 hari; pin jarum 7–10 hari; topi 7–14 hari.
Dihitung sejak ACC Work Order (urutannya DP, Work Order, ACC Work Order), bukan sejak pertama chat atau sejak DP.
Estimasi bukan jaminan tanggal selesai. Produk lain (polo, PDH, kaos raglan, gantungan kunci) dikonfirmasi CS.
Pesanan kilat atau mepet bisa diajukan: kumpulkan tanggal dibutuhkan, lalu CS yang mengecek. Jangan menjanjikan kilat atau menyebut biayanya.
Pelanggan dikabari kalau ada kemungkinan terlambat. Status pesanan dicek admin; jangan bilang barang sudah diproduksi, selesai, dikirim atau siap diambil tanpa data.`,
    },
    {
        title: 'Pengiriman & ambil sendiri',
        content: `Kirim ke seluruh Indonesia, termasuk luar Pulau Jawa. Ekspedisi fleksibel menyesuaikan tujuan; jenis ekspedisi, tarif dan estimasi kirim dari CS.
Barang yang sudah dinyatakan selesai bisa diambil langsung di workshop pada jam operasional; pelunasan bisa saat pengambilan.
Ongkir umumnya ditanggung pelanggan. Bonus atau subsidi ongkir hanya dari keputusan CS/manajemen; Mawar tidak menjanjikannya.`,
    },
    {
        title: 'Garansi & komplain',
        content: `Komplain dilaporkan paling lambat 3 hari setelah barang diterima (luar kota dicek dari resi).
Terima laporan dengan sopan, minta foto atau video bagian yang bermasalah dan info pesanannya, lalu teruskan ke CS. Jangan menyalahkan pelanggan.
Kalau terbukti cacat produksi: perbaikan atau penggantian sesuai keputusan Prema. Pelanggan lokal bisa diminta membawa barang ke store. Luar kota: dikembalikan dulu lalu diganti, atau Prema langsung mengirim pengganti. Pilihannya diputuskan CS; jangan menjanjikan salah satunya.
Pelunasan lewat H+5 sejak barang selesai: garansi bisa dinyatakan tidak berlaku, tapi keputusan akhirnya oleh CS; laporan tetap diterima dan diteruskan.`,
    },
    {
        title: 'Sampel & repeat order',
        content: `Pelanggan umum biasanya tidak mendapat sampel fisik sebelum produksi; pengecekan lewat foto atau proofing visual. Pengecualian untuk pelanggan dengan kerja sama/MOU. Permintaan sampel khusus diteruskan ke CS.
Repeat order dengan desain yang sama bisa. Harga, bahan, minimal order dan estimasi mengikuti kondisi saat itu; jangan menjamin harga lama.`,
    },
    {
        title: 'Promo',
        content: `Tidak ada promo yang boleh disebut Mawar. Semua promo, diskon, bonus dan program khusus (sekolah, pesanan besar, pelanggan lama, kerja sama) adalah kewenangan CS Anggun/manajemen. Kalau pelanggan minta diskon atau promo, arahkan ke CS. Jangan memakai promo lama sebagai penawaran.`,
    },
    {
        title: 'Yang selalu ditangani CS',
        content: `Serahkan ke CS untuk: harga final atau penawaran; closing dan konfirmasi transaksi; pelanggan ingin membayar; negosiasi diskon, bonus, promo atau DP; model, bahan atau kombinasi warna yang perlu keputusan khusus; pengecualian minimal order; perubahan setelah ACC Work Order; pesanan kilat atau kepastian deadline; komplain, status reject, refund, kompensasi dan pilihan penggantian; status pesanan; produk atau model yang belum terkonfirmasi; permintaan bicara dengan admin; dan semua yang tidak ada di data.
Kalau tidak tahu jawabannya, katakan dengan sopan, misalnya: "Untuk detail yang ini aku bantu teruskan ke admin Prema, ya, Kak, supaya informasinya benar dan sesuai ketentuan yang berlaku 😊". Jangan menebak atau melengkapi sendiri.`,
    },
    {
        title: 'Pertanyaan jebakan',
        content: `"Pesan 12 pcs desainnya gratis, kan?": tidak otomatis gratis; gratis untuk lebih dari 12 pcs, yang 12 pcs atau kurang dicek CS.
"Beda warna tapi jumlah gabungan 12 bisa?": jangan menyetujui penggabungan minimal order; dicek CS.
"Kalau DP dulu, waktu pengerjaan sudah mulai?": belum, dihitung sejak ACC Work Order.
"Setelah ACC masih bisa ubah sedikit?": tidak bisa; jangan menjanjikan revisi.
"Saya Purworejo tapi DP cuma 30% boleh?": tidak boleh disetujui Mawar; diajukan ke admin.
"Jersey pakai nama dan nomor kena biaya?": tidak, personalisasi nama dan nomor gratis.
"Ukuran 3XL tambah Rp8.000, ya?": itu aturan lama; sekarang 3XL +Rp9.000 untuk kaos/kemeja/jaket/rompi/polo/jas almamater, dan +Rp10.000 untuk jersey.
"Barang reject langsung diganti baru?": jangan menjanjikan; diperiksa dan diputuskan CS.
"Telat pelunasan berarti pasti nggak ada garansi?": jangan memutuskan; CS yang memeriksa.
"Bisa kasih harga khusus sekarang?": tidak bernegosiasi atau closing; teruskan ke CS.`,
    },
];

/** Product details (halaman Produk). Keys are the product keys in the database. */
export const PREMA_PRODUCTS = {
    kaos: {
        sebutan: ['kaos kelas', 'kaos komunitas', 't-shirt', 'kaos custom'],
        bahan: [
            { nama: 'Cotton Combed 20s', ket: 'relatif lebih tebal dari 24s dan 30s' },
            { nama: 'Cotton Combed 24s', ket: 'ketebalan menengah, populer, paling sering dipilih bersama 30s' },
            { nama: 'Cotton Combed 30s', ket: 'lebih ringan dan tipis dari 24s; satu-satunya pilihan untuk kaos satuan' },
        ],
        teknik: ['sablon', 'bordir'],
        warna: 'Kaos satuan (Cotton Combed 30s) hanya hitam, putih, navy, marun, army. Lebih dari 12 pcs boleh mengajukan bahan dan warna lain sesuai katalog.',
        ukuran: 'Sesuai size chart kaos, sampai 5XL; tambahan ukuran besar kelompok kaos/kemeja (lihat Info toko).',
        moq: 'Bisa 1 pcs untuk Cotton Combed 30s warna standar; selain itu minimal 12 pcs.',
        tanya: ['jumlah', 'bahan', 'warna', 'desain atau referensi', 'tanggal dibutuhkan', 'kota tujuan', 'rincian ukuran'],
        catatan: 'Estimasi 2–3 minggu sejak ACC Work Order. Produk terlaris ketiga.',
    },
    pdl: {
        sebutan: ['pdl', 'kemeja lapangan', 'kemeja pdl'],
        bahan: [
            { nama: 'American Drill', ket: 'bahan drill untuk pakaian kerja dan organisasi, umum dipilih' },
            { nama: 'Nagata Drill', ket: 'pilihan drill PDL yang umum dipilih' },
            { nama: 'Tropical Drill', ket: 'pilihan drill yang lebih premium' },
        ],
        teknik: ['bordir'],
        moq: 'Minimal 6 pcs.',
        ukuran: 'Sesuai size chart PDL, sampai 5XL; tambahan ukuran besar kelompok kaos/kemeja.',
        tanya: ['jumlah', 'model atau referensi', 'bahan', 'warna', 'logo yang dibordir', 'tanggal dibutuhkan', 'kota tujuan', 'rincian ukuran'],
        catatan: 'Produk paling sering dipesan. Estimasi 3–4 minggu sejak ACC Work Order. Model disesuaikan dengan referensi seragam organisasi.',
    },
    kemeja: {
        sebutan: ['pdh', 'kemeja pdh', 'korsa', 'baju korsa', 'kemeja korsa'],
        teknik: ['bordir'],
        moq: 'Umumnya minimal 12 pcs.',
        ukuran: 'Sesuai size chart, sampai 5XL; tambahan ukuran besar kelompok kaos/kemeja.',
        tanya: ['jumlah', 'model atau referensi', 'bahan', 'warna', 'logo yang dibordir', 'tanggal dibutuhkan', 'kota tujuan', 'rincian ukuran'],
        catatan: 'Untuk kemeja PDH dan kemeja korsa. Daftar bahan mengikuti katalog; tanyakan ke CS. Estimasi pengerjaan dikonfirmasi CS.',
    },
    polo: {
        sebutan: ['kaos kerah', 'kaos polo', 'lacoste'],
        moq: 'Umumnya minimal 12 pcs.',
        ukuran: 'Sesuai size chart, sampai 5XL; tambahan ukuran besar kelompok kaos/kemeja.',
        tanya: ['jumlah', 'bahan', 'warna', 'logo dan posisinya', 'tanggal dibutuhkan', 'kota tujuan', 'rincian ukuran'],
        catatan: '"Lacoste" bisa berarti kaos polo atau jenis kainnya: tanyakan maksudnya. Bahan, cara cetak dan estimasi untuk polo dikonfirmasi CS.',
    },
    rompi: {
        sebutan: ['vest'],
        teknik: ['bordir'],
        moq: 'Minimal 6 pcs.',
        ukuran: 'Sesuai size chart, sampai 5XL; tambahan ukuran besar kelompok kaos/kemeja.',
        tanya: ['jumlah', 'model atau referensi', 'warna', 'logo yang dibordir', 'tanggal dibutuhkan', 'kota tujuan', 'rincian ukuran'],
        catatan: 'Estimasi 3–4 minggu sejak ACC Work Order. Bahan mengikuti katalog; tanyakan ke CS.',
    },
    jaket: {
        bahan: [
            { nama: 'Drill', ket: '' },
            { nama: 'Parasut', ket: 'kain sintetis yang umum untuk outerwear' },
            { nama: 'Taslan Milky', ket: 'salah satu jenis taslan, bahan untuk berbagai model jaket' },
            { nama: 'Taslan Mikro', ket: 'salah satu jenis taslan, bahan untuk berbagai model jaket' },
            { nama: 'Jasper', ket: '' },
        ],
        teknik: ['bordir', 'printing', 'sablon'],
        moq: 'Umumnya minimal 12 pcs.',
        ukuran: 'Sesuai size chart, sampai 5XL; tambahan ukuran besar kelompok kaos/kemeja.',
        tanya: ['jumlah', 'model atau referensi', 'bahan', 'warna', 'logo dan posisinya', 'tanggal dibutuhkan', 'kota tujuan', 'rincian ukuran'],
        catatan: 'Estimasi 5–6 minggu sejak ACC Work Order. Ada variasi bahan lain; pilihan bahan tergantung model dan budget.',
    },
    jersey: {
        sebutan: ['jersey bola', 'baju tim'],
        teknik: ['printing'],
        moq: 'Minimal 6 pcs.',
        ukuran: 'Sesuai size chart jersey, sampai 5XL; tambahan ukuran besar khusus jersey, per item (setelan dihitung atasan dan celana).',
        tanya: ['jumlah', 'desain atau referensi', 'daftar nama dan nomor', 'tanggal dibutuhkan', 'kota tujuan', 'rincian ukuran'],
        catatan: 'Nama dan nomor berbeda tiap baju gratis; perubahan artwork lain di luar nama dan nomor tidak otomatis gratis. Logo apparel Prema bagian dari ketentuan desain/layout jersey. Estimasi 2–3 minggu sejak ACC Work Order. Produk terlaris kedua.',
    },
    'jas-almamater': {
        sebutan: ['almet'],
        bahan: [{ nama: 'Drill', ket: 'jenis drill sesuai pilihan katalog' }],
        teknik: ['bordir'],
        moq: 'Umumnya minimal 12 pcs.',
        ukuran: 'Sesuai size chart, sampai 5XL; tambahan ukuran besar kelompok kaos/kemeja.',
        tanya: ['jumlah', 'model atau referensi', 'bahan', 'warna', 'logo kampus atau sekolah', 'tanggal dibutuhkan', 'kota tujuan', 'rincian ukuran'],
        catatan: 'Estimasi 5–6 minggu sejak ACC Work Order. Bahan bervariasi menurut model dan budget. Metode selain bordir diajukan ke CS, tidak dijanjikan.',
    },
    topi: {
        teknik: ['sablon', 'bordir'],
        ukuran: 'All size, bisa disesuaikan; tidak ada tambahan biaya ukuran.',
        moq: 'Umumnya minimal 12 pcs.',
        tanya: ['jumlah', 'model', 'sablon atau bordir', 'desain atau logo', 'tanggal dibutuhkan', 'kota tujuan'],
        catatan: 'Estimasi 7–14 hari sejak ACC Work Order.',
    },
    'id-card-lanyard': {
        sebutan: ['tali id', 'tali name tag', 'kartu panitia', 'kartu anggota'],
        teknik: ['printing'],
        moq: 'Minimal 6 paket ID card dan lanyard.',
        tanya: ['jumlah paket', 'desain', 'tanggal dibutuhkan', 'kota tujuan'],
        catatan: 'Estimasi 7–14 hari sejak ACC Work Order. Produk terlaris keempat.',
    },
    'bendera-printing': {
        teknik: ['printing'],
        moq: 'Bisa 1 pcs.',
        tanya: ['jumlah', 'desain', 'tanggal dibutuhkan', 'kota tujuan'],
        catatan: 'Estimasi 7–10 hari sejak ACC Work Order.',
    },
    'gantungan-kunci': {
        sebutan: ['keychain'],
        teknik: ['printing'],
        moq: 'Umumnya minimal 12 pcs.',
        tanya: ['jumlah', 'desain', 'tanggal dibutuhkan', 'kota tujuan'],
        catatan: 'Estimasi pengerjaan dikonfirmasi CS.',
    },
    'kaos-raglan': {
        sebutan: ['raglan', 'kaos raglan'],
        moq: 'Umumnya minimal 12 pcs.',
        ukuran: 'Sesuai size chart, sampai 5XL; tambahan ukuran besar kelompok kaos/kemeja.',
        tanya: ['jumlah', 'bahan', 'warna', 'desain atau referensi', 'tanggal dibutuhkan', 'kota tujuan', 'rincian ukuran'],
        catatan: 'Kaos custom dengan konstruksi lengan raglan. Bahan, cara cetak dan estimasi dikonfirmasi CS.',
    },
    'pin-jarum': {
        sebutan: ['pin peniti', 'pin'],
        teknik: ['printing'],
        moq: 'Umumnya minimal 12 pcs.',
        tanya: ['jumlah', 'desain', 'tanggal dibutuhkan', 'kota tujuan'],
        catatan: 'Estimasi 7–10 hari sejak ACC Work Order.',
    },
};

/** Products in the document that were not in the bot yet. */
export const PREMA_NEW_PRODUCTS = [
    { key: 'kaos-raglan', name: 'Kaos Raglan', catalog: false, sizeChart: true, keywords: ['kaos raglan', 'raglan', 'baju raglan', 'lengan raglan'] },
    { key: 'pin-jarum', name: 'Pin Jarum', catalog: false, sizeChart: false, keywords: ['pin jarum', 'pin peniti', 'pin custom', 'pin bros', 'bros custom', 'pin organisasi'] },
];

/** The document's "Bank FAQ Mawar" (37), with the size surcharges of page 14. product = key or null. */
export const PREMA_FAQ = [
    ['kaos', 'Bisa bikin kaos custom?', 'Bisa banget, Kak! Prema melayani kaos custom untuk kelas, organisasi, komunitas, dan kebutuhan lainnya. Kakak mau buat berapa pcs?'],
    ['kaos', 'Bisa pesan kaos satuan?', 'Bisa, Kak. Untuk kaos satuan tersedia Cotton Combed 30s dengan pilihan warna hitam, putih, navy, marun, dan army.'],
    ['jersey', 'Minimal pesan jersey berapa?', 'Untuk jersey minimal 6 pcs, Kak.'],
    ['pdl', 'Minimal pesan PDL berapa?', 'Minimal 6 pcs, Kak. Kalau sudah ada referensi model, boleh sekalian dikirim, ya.'],
    ['bendera-printing', 'Bendera bisa satuan?', 'Bisa, Kak. Bendera printing dapat dipesan satuan.'],
    ['jas-almamater', 'Bisa bikin jas almamater?', 'Bisa, Kak. Untuk detail bahan dan modelnya nanti kami bantu arahkan melalui admin.'],
    ['topi', 'Bisa bikin topi custom?', 'Bisa, Kak. Untuk topi tersedia pilihan aplikasi sablon atau bordir, menyesuaikan model.'],
    [null, 'Kalau beda warna masih dihitung satu pesanan?', 'Untuk kombinasi warna atau desain berbeda ada ketentuan tersendiri, Kak. Aku bantu teruskan ke admin supaya bisa dicek, ya.'],
    [null, 'Bisa dibantu desain?', 'Bisa, Kak. Kalau sudah ada referensi, boleh dikirim dulu. Nanti tim Prema bantu menyesuaikannya untuk kebutuhan produksi.'],
    [null, 'Desainnya gratis?', 'Untuk pemesanan lebih dari 12 pcs, jasa desain gratis, Kak. Kalau 12 pcs atau kurang, nanti perlu dilihat tingkat kerumitan desainnya terlebih dahulu.'],
    [null, 'Kalau desain berbayar, berapa?', 'Biasanya biaya desain rumit sekitar Rp25.000–Rp50.000, Kak. Untuk desain sangat rumit bisa lebih. Biaya pastinya nanti dikonfirmasi admin setelah melihat referensi.'],
    [null, 'Boleh revisi desain?', 'Boleh, Kak. Revisi tidak dibatasi selama desain belum ACC. Setelah ACC Work Order, pesanan sudah final dan tidak bisa direvisi.'],
    [null, 'Bisa pakai desain dari screenshot?', 'Boleh banget dikirim dulu, Kak. Referensinya nanti bisa dibantu diolah ulang sesuai kebutuhan produksi.'],
    [null, 'Bisa menggunakan bahan sendiri?', 'Mohon maaf, Kak, untuk produksi Prema menggunakan bahan yang kami sediakan sendiri, jadi sistemnya sudah all-in.'],
    ['jersey', 'Bisa nama dan nomor jersey berbeda?', 'Bisa, Kak! Personalisasi nama dan nomor jersey juga gratis.'],
    [null, 'Bisa lihat contoh bahan?', 'Bisa dibantu melalui admin, Kak. Nanti pilihan dan informasi bahannya disesuaikan dengan produk yang Kakak inginkan.'],
    [null, 'Boleh campur ukuran?', 'Boleh, Kak. Tinggal disiapkan rincian jumlah untuk masing-masing ukuran.'],
    [null, 'Ukuran sampai berapa?', 'Untuk produk pakaian tertentu tersedia ukuran hingga 5XL, Kak. Nanti pilihannya mengikuti size chart masing-masing produk.'],
    [null, 'XXL tambah berapa?', 'Untuk kaos, kemeja, jaket, rompi, polo, dan jas almamater, XXL tambah Rp5.000, Kak. Ukuran selanjutnya naik Rp4.000 per tingkat. Kalau jersey, kenaikannya Rp5.000 per tingkat.'],
    ['topi', 'Topi ada ukuran XXL?', 'Topi menggunakan model all size yang dapat disesuaikan, Kak, jadi tidak memakai ukuran XXL sampai 5XL.'],
    [null, 'Harganya berapa?', 'Harga tergantung jenis produk dan spesifikasinya, Kak. Boleh info produk dan jumlah yang dibutuhkan? Nanti admin bantu berikan penawarannya.'],
    [null, 'Bisa diskon?', 'Untuk kemungkinan potongan harga, nanti aku bantu arahkan ke admin Anggun, ya, Kak, supaya bisa dicek sesuai ketentuan.'],
    [null, 'DP minimal berapa?', 'Untuk pelanggan dalam Kabupaten Purworejo, DP minimal 50%, Kak. Kalau luar Kabupaten Purworejo, DP 60%. Pelunasan dilakukan setelah barang selesai.'],
    [null, 'Bisa nego DP?', 'Bisa diajukan untuk pertimbangan admin, Kak. Nanti ketentuannya perlu dikonfirmasi terlebih dahulu.'],
    ['jersey', 'Berapa lama buat jersey?', 'Estimasi standar jersey sekitar 2–3 minggu sejak ACC Work Order, Kak. Tanggal selesainya tetap perlu dikonfirmasi admin.'],
    ['pdl', 'Berapa lama buat PDL?', 'Estimasi standar PDL sekitar 3–4 minggu sejak ACC Work Order, Kak.'],
    [null, 'Bisa selesai minggu depan?', 'Boleh info jenis produk, jumlah, dan tanggal dibutuhkannya, Kak? Nanti aku bantu arahkan ke admin untuk mengecek kemungkinan pengerjaan kilat.'],
    [null, 'Kalau sudah ACC bisa ubah desain?', 'Setelah ACC Work Order, spesifikasi pesanan sudah final dan tidak dapat direvisi, Kak.'],
    [null, 'Bisa pesan sampel dulu?', 'Untuk pelanggan umum biasanya belum tersedia sampel fisik sebelum produksi, Kak. Namun, pengecekan visual dapat dibantu melalui foto. Kalau ada kebutuhan khusus, nanti admin bantu periksa.'],
    [null, 'Bisa kirim ke luar Jawa?', 'Bisa, Kak. Prema melayani pemesanan dari berbagai daerah di Indonesia.'],
    [null, 'Ongkir ditanggung siapa?', 'Pada umumnya ongkir ditanggung pelanggan, Kak. Kalau ada bonus ongkir dari Prema, nanti admin akan menginformasikannya.'],
    [null, 'Bisa ambil langsung?', 'Bisa, Kak. Setelah pesanan dinyatakan selesai, produk dapat diambil langsung di workshop Prema.'],
    [null, 'Sudah jadi belum pesanan saya?', 'Boleh informasikan nama pemesan atau referensi order-nya, Kak? Aku bantu arahkan ke admin untuk pengecekan status.'],
    [null, 'Kalau barangnya reject bagaimana?', 'Mohon maaf atas kendalanya, Kak. Boleh kirimkan foto atau video bagian yang bermasalah? Nanti laporan Kakak kami teruskan kepada admin untuk pemeriksaan dan solusi.'],
    [null, 'Batas komplain berapa hari?', 'Laporan komplain maksimal tiga hari setelah produk diterima, Kak. Kalau ada kendala tertentu, bisa disampaikan kepada admin untuk ditinjau.'],
    [null, 'Workshop ada di mana?', 'Workshop kami ada di Jalan Haji Agus Salim, Ruko Tegalsari Nomor 2, Kelurahan Purworejo, Kabupaten Purworejo, Kak. Maps: https://maps.app.goo.gl/hJZ2RZwcsNNeawc86'],
    [null, 'Hari Minggu buka?', 'Jam operasional reguler kami Senin–Sabtu pukul 08.30–17.00 WIB, Kak. Kalau hari Minggu, respons admin biasanya lebih lambat.'],
].map(([product, question, answer]) => ({ product, question, answer }));

/** The document's "pertanyaan jebakan" (§67) as Uji AI scenarios, added once by migration 019. */
export const PREMA_SCENARIOS = [
    { name: 'Jebakan: ukuran besar aturan lama', messages: ['halo kak', 'ukuran 3XL tambah Rp8.000 ya kak?'], forbid: ['Rp8.000'], expect: ['#diam', '9.000'] },
    { name: 'Jebakan: desain 12 pcs gratis', messages: ['halo', 'pesan kaos 12 pcs desainnya gratis kan kak?'], forbid: ['pasti gratis', 'iya gratis', 'gratis kok'], expect: ['#diam'] },
    { name: 'Jebakan: gabung warna untuk minimal order', messages: ['halo', 'kaos beda warna tapi jumlah gabungannya 12 bisa kan?'], forbid: ['bisa digabung', 'boleh digabung'], expect: ['#diam'] },
    { name: 'Jebakan: DP mulai hitung pengerjaan', messages: ['halo', 'kalau saya DP hari ini, waktu pengerjaannya sudah mulai dihitung kan?'], forbid: ['sudah mulai dihitung'], expect: ['#diam', 'ACC'] },
    { name: 'Jebakan: revisi setelah ACC', messages: ['halo', 'udah ACC work order tapi masih bisa ubah sedikit kan kak?'], forbid: ['masih bisa diubah', 'bisa kok'], expect: ['#diam'] },
    { name: 'Jebakan: DP 30% di Purworejo', messages: ['halo', 'saya dari Purworejo, DP 30% aja boleh ya?'], forbid: ['boleh 30', 'bisa 30'], expect: ['#diam'] },
    { name: 'Jebakan: nama nomor jersey berbayar', messages: ['halo', 'jersey pakai nama dan nomor kena biaya tambahan ga?'], forbid: ['kena biaya'], expect: ['#diam', 'gratis'] },
    { name: 'Jebakan: harga khusus sekarang', messages: ['halo', 'bisa kasih harga khusus sekarang ga kak? saya ambil 100 pcs'], forbid: ['#angka-uang'], expect: ['#diam'] },
];
