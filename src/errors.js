
const MAX = 100;
const feed = [];
let lastId = 0;

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function plain(value, depth = 0) {
    if (value instanceof Error) return { name: value.name, message: value.message, code: value.code, stack: value.stack };
    if (!value || typeof value !== 'object' || depth > 3) return value;
    if (Array.isArray(value)) return value.slice(0, 20).map((v) => plain(v, depth + 1));

    return Object.fromEntries(Object.entries(value).slice(0, 30).map(([k, v]) => [k, plain(v, depth + 1)]));
}

export const LEVELS = ['info', 'cek', 'tindak'];

const MULAI = 'tutup jendela bot, lalu klik "Mulai ChatBot Prema"';
const TIDAK = 'Tidak perlu melakukan apa-apa.';
const KIRIM = 'Kalau terus berulang, tekan "Salin teks" dan kirim ke developer.';
const DISK = 'Windows menolak menulis ke disk. 1) Cek ruang disk PC (kosongkan file besar dan Recycle Bin). 2) Pastikan folder bot tidak dibuka program lain. 3) Lalu ' + MULAI + '.';

export const GUIDE = [
    { match: /belum versi terbaru/i, level: 'tindak', push: false,
        meaning: 'Ada versi bot yang lebih baru di GitHub.',
        todo: `1) ${MULAI[0].toUpperCase()}${MULAI.slice(1)}. 2) Pembaruan terpasang otomatis; data dan chat tidak hilang.` },
    { match: /perangkat bot ini sendiri/i, level: 'tindak',
        meaning: 'Pesan atas nama perangkat bot belum bisa dibuka. Pesan kiriman ulang atau konflik sesi perlu diperiksa; ini belum membuktikan ada bot ganda.',
        todo: '1) Simpan detail pengirim dan ID pesan untuk developer. 2) Jangan lepas perangkat admin atau scan ulang hanya berdasarkan peringatan ini.' },
    { match: /perangkat tertaut lain/i, level: 'info',
        meaning: 'Pesan dari salah satu perangkat toko belum terbaca. Chat terkait ditahan lalu diserahkan ke CS jika belum pulih; chat lain tetap berjalan.',
        todo: '1) Jangan lepas perangkat pemilik atau admin. 2) Periksa dan tangani chat terkait lewat WhatsApp. 3) Salin detail perangkat dan ID pesan untuk developer jika berulang.' },
    { match: /pemulihan sesi HP utama belum berhasil|kunci enkripsi bot dan HP sudah tidak cocok/i, level: 'tindak',
        meaning: 'Bot tidak bisa membuka pesan yang dikirim dari HP toko, dan perbaikan otomatis selama 30 menit belum berhasil.',
        todo: '1) Pastikan HP utama online dan buka WhatsApp Business. 2) Periksa detail perangkat bersama developer; jangan lepas perangkat admin. 3) Scan ulang menjadi pilihan terakhir setelah pemeriksaan.' },
    { match: /dilepas dari pemulihan/i, level: 'cek',
        meaning: 'Beberapa pesan WhatsApp tidak pernah bisa dibuka, jadi dilepas dari antrean pemulihan.',
        todo: '1) Lihat Detail: kalau "customerChats" berisi chat pelanggan, buka chat itu di WhatsApp Business di HP toko dan balas manual kalau perlu. 2) Kalau "customerChats" kosong, pesannya dari perangkat CS dan tidak ada yang perlu dilakukan. 3) Kalau diminta developer, tekan "Salin teks" dan kirim.' },
    { match: /belum bisa dipulihkan setelah 5 menit|terlalu banyak pesan belum terbaca/i, level: 'cek',
        meaning: 'Beberapa pesan WhatsApp belum bisa dibuka; pemulihan otomatis masih berjalan.',
        todo: '1) Pastikan HP toko menyala dan terhubung internet, lalu buka WhatsApp Business di HP. 2) Tunggu sekitar 30 menit; bot memperbaiki sendiri. 3) Kalau muncul peringatan lain yang menyebut "Scan ulang" atau "perangkat tertaut", ikuti peringatan itu.' },
    { match: /WhatsApp belum tersambung lagi setelah/i, level: 'tindak',
        meaning: 'Bot sudah beberapa kali mencoba menyambung ke WhatsApp tetapi belum berhasil.',
        todo: '1) Cek internet PC (buka situs lain). 2) Lihat kartu "Siap mulai": jam PC harus benar. 3) Kalau internet normal dan tetap gagal, ' + MULAI + '. 4) Kalau dashboard menampilkan QR, scan dari HP toko.' },
    { match: /sesi dilepas dari HP/i, level: 'tindak',
        meaning: 'Bot dilepas dari HP (lewat menu Perangkat tertaut), atau WhatsApp memutus tautannya.',
        todo: '1) Di dashboard muncul QR baru. 2) Di HP toko: WhatsApp Business > Perangkat tertaut > Tautkan perangkat, lalu scan QR itu. 3) Kalau tidak sengaja dilepas, jangan lepas lagi.' },
    { match: /nomor ini diambil alih program lain|diambil alih/i, level: 'tindak',
        meaning: 'Nomor ini dipakai bot lain yang memakai kunci WhatsApp yang sama (PC lain atau jendela bot kedua). Bot ini berhenti supaya tidak saling merusak.',
        todo: '1) Matikan bot lain yang memakai nomor ini; satu nomor hanya boleh satu bot. 2) Klik "Mulai ChatBot Prema" (salinan dari folder lain dimatikan otomatis). 3) Di kartu WhatsApp klik "Scan ulang (kunci baru)" dan scan dari HP toko.' },

    { match: /spoofed self-only protocolMessage/i, level: 'info',
        meaning: 'Pesan sinkronisasi internal akun WhatsApp diabaikan. Ini normal.',
        todo: TIDAK },
    { match: /error in sending keep alive|error in validating connection|connection closed|connection lost|connection terminated|ECONNRESET|socket hang up|timed out.*(ws|websocket)/i, level: 'info',
        meaning: 'Sambungan PC ke WhatsApp putus sebentar (internet putus atau lambat). Bot menyambung ulang sendiri.',
        todo: `${TIDAK} Kalau status WhatsApp di Ringkasan tetap "terputus" lebih dari 5 menit, cek internet PC ini.` },
    { match: /stream errored out|stream:error|restart required|code.{0,10}515/i, level: 'info',
        meaning: 'WhatsApp meminta sambungan disegarkan (restart normal, kode 515). Bot menyambung ulang sendiri.',
        todo: TIDAK },
    { match: /unexpected error in '(init queries|processing offline nodes|handling notification)'|error in sending (presence update|message again)|no name present|url generation failed/i, level: 'info',
        meaning: 'Gangguan kecil dari WhatsApp saat sinkronisasi (biasanya karena internet putus-nyambung). Tidak mengganggu balasan ke pelanggan.',
        todo: `${TIDAK} Kalau ada pelanggan melapor chat tidak dibalas, lihat kartu "Siap mulai" di Ringkasan.` },
    { match: /error in handling message/i, level: 'cek',
        meaning: 'Satu pesan dari WhatsApp gagal diproses oleh pustaka WhatsApp. Pesan lainnya tidak terpengaruh.',
        todo: `Biasanya tidak perlu apa-apa. ${KIRIM}` },
    { match: /ENOTFOUND|EAI_AGAIN|getaddrinfo|ENETUNREACH|EHOSTUNREACH|fetch failed/i, level: 'cek',
        meaning: 'PC ini tidak bisa menjangkau internet (Wi-Fi atau kabel LAN putus, modem mati, atau kuota habis).',
        todo: '1) Cek Wi-Fi atau kabel LAN, modem, dan kuota. 2) Bot jalan lagi sendiri begitu internet kembali; tidak perlu menyalakan ulang.' },

    { match: /failed to decrypt message|Bad MAC|No session|No matching sessions|Key used already|Invalid PreKey/i, level: 'cek',
        meaning: 'Satu pesan tidak bisa dibuka (kunci enkripsi pengirim belum cocok). WhatsApp biasanya mengirim ulang sendiri, dan bot memperbaikinya otomatis.',
        todo: '1) Tidak perlu apa-apa dulu. 2) Kalau tidak pulih, bot memberi peringatan sendiri setelah 5 menit dengan langkah yang tepat. 3) Kalau muncul terus untuk banyak pesan dan tidak ada peringatan lain, ' + KIRIM.toLowerCase() },

    { match: /mode AI aktif tetapi AI belum diatur/i, level: 'tindak',
        meaning: 'Mode AI menyala tetapi kunci AI belum diisi, jadi bot diam setelah sapaan.',
        todo: '1) Buka Atur AI. 2) Isi kunci Ollama. 3) Simpan.' },
    { match: /batas panggilan AI tercapai/i, level: 'cek',
        meaning: 'Pelanggan ini sudah memakai batas jumlah balasan AI. Pesannya menunggu dicoba lagi.',
        todo: 'Tidak perlu apa-apa. Kalau batasnya terlalu kecil, naikkan di Atur AI.' },
    { match: /AI gagal membalas/i, level: 'cek',
        meaning: 'AI belum menghasilkan balasan yang lolos pemeriksaan (atau AI sedang gangguan), jadi bot diam untuk pesan itu.',
        todo: '1) Bot mencoba lagi sendiri. 2) Kalau tetap gagal, pelanggan masuk ke "Perlu ditindaklanjuti CS" di Ringkasan: balas lewat WhatsApp Business di HP. 3) Kalau sering, cek kunci dan jatah AI di Atur AI.' },
    { match: /AI gagal(?: menulis|, memakai)/i, level: 'info',
        meaning: 'AI gagal, jadi bot memakai cara cadangan (kata kunci).',
        todo: TIDAK },
    { match: /semua kunci AI sudah dicek satu per satu/i, level: 'tindak',
        meaning: 'Semua kunci Ollama yang terpasang sedang habis jatahnya (atau ditolak), jadi bot diam untuk pesan pelanggan.',
        todo: '1) Buka Atur AI dan lihat status tiap kunci. 2) Tambahkan kunci Ollama lain (sampai 4 kunci) atau upgrade paket. 3) Jatah pulih sendiri dan bot mencoba lagi otomatis. 4) Sementara itu, balas pelanggan lewat WhatsApp Business di HP.' },
    { match: /kunci AI \S+ ditolak Ollama/i, level: 'tindak',
        meaning: 'Ollama menolak salah satu kunci (salah, dihapus, atau sudah tidak berlaku). Bot melewatinya dan memakai kunci lain.',
        todo: '1) Buka Atur AI dan cari kunci yang berstatus "ditolak". 2) Tempel kunci yang benar dari ollama.com (Settings > Keys), atau hapus kolom itu. 3) Simpan.' },
    { match: /Ollama 401|Ollama 403|unauthori[sz]ed/i, level: 'tindak',
        meaning: 'Kunci AI ditolak (salah atau sudah tidak berlaku).',
        todo: '1) Buka Atur AI. 2) Isi ulang kunci Ollama yang benar. 3) Simpan.' },
    { match: /Ollama 429|rate.?limit|too many requests|batas pemakaian/i, level: 'cek',
        meaning: 'Jatah pemakaian AI habis untuk sementara. Bot diam sampai jatahnya pulih.',
        todo: '1) Tunggu; jatah pulih sendiri. 2) Kalau sering, ganti atau upgrade akun AI di Atur AI.' },
    { match: /Ollama 5\d\d/i, level: 'info',
        meaning: 'Server AI sedang bermasalah (bukan PC ini).',
        todo: `${TIDAK} Biasanya pulih sendiri dalam beberapa menit.` },
    { match: /aborted due to timeout|TimeoutError|operation was aborted/i, level: 'cek',
        meaning: 'AI terlalu lama menjawab, jadi pesan itu tidak dibalas. Biasanya internet lambat atau server AI sibuk.',
        todo: '1) Tidak perlu apa-apa kalau jarang. 2) Kalau sering, naikkan "Batas waktu jawaban AI" di Atur AI.' },

    { match: /pesan tertunda perlu ditindaklanjuti CS|balasan tertunda terlalu lama/i, level: 'tindak',
        meaning: 'Ada pelanggan yang belum menerima balasan dari bot.',
        todo: '1) Buka Ringkasan > "Perlu ditindaklanjuti CS". 2) Balas pelanggan itu lewat WhatsApp Business di HP.' },
    { match: /balasan tertunda, akan dikirim ulang otomatis/i, level: 'info',
        meaning: 'Satu balasan belum terkirim (biasanya karena sambungan putus sebentar). Bot mengirim ulang sendiri.',
        todo: TIDAK },
    { match: /gagal melanjutkan pesan masuk tertunda|gagal memproses (pesan|status)/i, level: 'cek',
        meaning: 'Satu pesan gagal diproses. Pesannya tersimpan dan dicoba lagi otomatis; bot tetap jalan.',
        todo: `Tidak perlu apa-apa kalau tidak berulang. ${KIRIM}` },

    { match: /SQLITE_FULL|ENOSPC|no space left|disk full/i, level: 'tindak',
        meaning: 'Disk PC penuh, jadi bot tidak bisa menyimpan data.',
        todo: '1) Kosongkan ruang disk (hapus file besar, kosongkan Recycle Bin). 2) Lalu ' + MULAI + '.' },
    { match: /database disk image is malformed|SQLITE_CORRUPT|SQLITE_NOTADB|file is not a database/i, level: 'tindak',
        meaning: 'Database bot rusak.',
        todo: '1) Tutup bot dan JANGAN hapus folder data. 2) Hubungi developer; cadangan harian ada di data\\backups.' },
    { match: /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i, level: 'cek',
        meaning: 'Database sedang dipakai proses lain, biasanya karena dua bot jalan dari folder yang sama.',
        todo: '1) Tutup semua jendela bot. 2) Klik "Mulai ChatBot Prema" sekali saja.' },
    { match: /EPERM|EACCES|permission denied|operation not permitted/i, level: 'tindak',
        meaning: 'Windows menolak akses ke file atau folder bot.',
        todo: '1) Klik kanan "Mulai ChatBot Prema" > Run as administrator. 2) Pastikan folder bot tidak sedang dibuka program lain atau diblokir antivirus.' },
    { match: /gagal menyimpan (sesi WhatsApp|status pemulihan|error katalog)/i, level: 'tindak',
        meaning: 'Bot gagal menulis ke database.',
        todo: DISK },
    { match: /sudah dipakai: bot lain sedang jalan|EADDRINUSE/i, level: 'tindak',
        meaning: 'Bot sudah jalan di jendela lain, jadi bot yang baru tidak bisa menyala.',
        todo: '1) Tutup semua jendela bot. 2) Klik "Mulai ChatBot Prema" sekali saja.' },
    { match: /bot gagal start/i, level: 'tindak',
        meaning: 'Bot gagal menyala.',
        todo: '1) Baca pesan di Detail: biasanya port dipakai program lain atau ada file rusak. 2) ' + MULAI[0].toUpperCase() + MULAI.slice(1) + ' sekali lagi. 3) Kalau tetap gagal, tekan "Salin teks" dan kirim ke developer.' },
    { match: /gagal memulai sesi|gagal menyambung ulang/i, level: 'cek',
        meaning: 'Bot gagal memulai sambungan WhatsApp dan akan mencoba lagi.',
        todo: '1) Cek internet PC. 2) Kalau berulang lebih dari 5 menit, ' + MULAI + '.' },
    { match: /tugas harian gagal/i, level: 'cek',
        meaning: 'Tugas otomatis harian (backup, bersih-bersih data, rekap pagi) gagal dan dicoba lagi nanti.',
        todo: '1) Cek folder backup di Pengaturan: folder itu harus ada dan bisa ditulis. 2) Cek ruang disk PC.' },
    { match: /katalog WhatsApp gagal dibaca/i, level: 'cek',
        meaning: 'Bot belum bisa membaca katalog WhatsApp Business (nomor belum memakai WhatsApp Business, katalog kosong, atau internet lambat). Bot tetap membalas pelanggan; hanya tautan produk dari katalog yang belum bisa dipakai.',
        todo: '1) Tidak perlu apa-apa kalau toko memang belum punya katalog. 2) Kalau punya, pastikan katalog terisi di aplikasi WhatsApp Business. Bot mencoba lagi sendiri.' },
    { match: /file media belum ada/i, level: 'cek',
        meaning: 'Ada file katalog atau size chart yang belum diunggah.',
        todo: '1) Buka tab Media di dashboard. 2) Unggah file yang masih kurang.' },
    { match: /logout gagal, tetap membersihkan kredensial|status pemulihan lama/i, level: 'info',
        meaning: 'Pembersihan data tautan lama sempat gagal sebagian, dan bot melanjutkan.',
        todo: TIDAK },
    { match: /pemulihan pesan tertunda, dicoba lagi otomatis/i, level: 'info',
        meaning: 'Satu langkah pemulihan pesan tertunda dan dicoba lagi otomatis.',
        todo: TIDAK },

    { match: /error tak tertangani/i, level: 'cek',
        meaning: 'Terjadi kesalahan tak terduga di dalam bot. Bot menyalakan ulang dirinya sendiri supaya tidak setengah rusak.',
        todo: `1) Tunggu satu menit; bot menyala sendiri. 2) Kalau status di dashboard belum hijau setelah 2 menit, ${MULAI}. 3) ${KIRIM}` },

    { match: /Tidak bisa menghubungi bot/i, level: 'tindak',
        meaning: 'Halaman ini tidak bisa menghubungi bot: bot belum jalan atau jendelanya tertutup.',
        todo: '1) Klik "Mulai ChatBot Prema". 2) Tunggu 20 detik, lalu muat ulang halaman (F5).' },
    { match: /^request gagal$/i, level: 'cek',
        meaning: 'Dashboard meminta sesuatu ke bot dan bot gagal menjawabnya.',
        todo: `1) Muat ulang halaman (F5) dan coba lagi. 2) ${KIRIM}` },
];

export const FALLBACK = {
    level: 'cek',
    meaning: 'Bot mencatat kesalahan yang belum dikenali.',
    todo: '1) Tekan "Salin teks" dan kirim ke developer. 2) Lihat kartu "Siap mulai" di Ringkasan. 3) Kalau bot berhenti membalas pelanggan, ' + MULAI + '.',
};

const detailText = (detail) => {
    try {
        return JSON.stringify(detail ?? {}, (k, v) => (k === 'stack' ? undefined : v instanceof Error ? v.message : v)).slice(0, 2000);
    } catch {
        return '';
    }
};

const find = (message, detail) => {
    const text = String(message ?? '');

    return GUIDE.find((g) => g.match.test(text)) ?? GUIDE.find((g) => g.match.test(`${text} ${detailText(detail)}`)) ?? null;
};

export const guideOf = (message, detail = {}) => {
    const found = find(message, detail);

    return found
        ? { level: found.level, meaning: found.meaning, todo: found.todo, known: true, push: found.push !== false }
        : { ...FALLBACK, known: false };
};

export const meaningOf = (message, detail = {}) => find(message, detail)?.meaning ?? null;

export function recordError({ level = 'error', source = 'bot', message, detail = {} }) {
    const text = String(message ?? '').slice(0, 1000);
    feed.push({ id: ++lastId, time: stamp(), level, source, message: text, meaning: meaningOf(text, detail), guide: guideOf(text, detail), detail: plain(detail) });
    if (feed.length > MAX) feed.shift();
}

export const errorsSince = (id = 0) => feed.filter((e) => e.id > Number(id || 0));

export const latestErrorId = () => lastId;
