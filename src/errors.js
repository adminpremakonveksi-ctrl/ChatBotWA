/**
 * Recent errors and warnings, raw, for the console's error pop-up: the client
 * photographs it and the developer reads exactly what failed. Filled by the
 * logger (every warn/error line) and by the HTTP error handler.
 *
 * Every entry also carries a guide for the person at the PC: whether anything
 * has to be done at all, what it means, and what to do, step by step. The raw
 * text stays as logged, beside it. An error nobody wrote a guide for still gets
 * the fallback guide, and test/error-guides.test.js fails when a warn/error in
 * src/ has no guide of its own, so a new error cannot ship without one.
 *
 * In memory only (the full history is in logs/bot.log). No imports, so the
 * logger can use it without a cycle.
 */

const MAX = 100;
const feed = [];
let lastId = 0;

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** Plain-JSON copy of whatever was logged, Error objects included (message + stack). */
function plain(value, depth = 0) {
    if (value instanceof Error) return { name: value.name, message: value.message, code: value.code, stack: value.stack };
    if (!value || typeof value !== 'object' || depth > 3) return value;
    if (Array.isArray(value)) return value.slice(0, 20).map((v) => plain(v, depth + 1));

    return Object.fromEntries(Object.entries(value).slice(0, 30).map(([k, v]) => [k, plain(v, depth + 1)]));
}

/**
 * level: 'info'   = nothing to do, the bot repairs itself;
 *        'cek'    = look only if it keeps coming back;
 *        'tindak' = something must be done now.
 * todo: numbered steps in plain words, using the names on screen.
 */
export const LEVELS = ['info', 'cek', 'tindak'];

const MULAI = 'tutup jendela bot, lalu klik "Mulai ChatBot Prema"';
const TIDAK = 'Tidak perlu melakukan apa-apa.';
const KIRIM = 'Kalau terus berulang, tekan "Salin teks" dan kirim ke developer.';
const DISK = 'Windows menolak menulis ke disk. 1) Cek ruang disk PC (kosongkan file besar dan Recycle Bin). 2) Pastikan folder bot tidak dibuka program lain. 3) Lalu ' + MULAI + '.';

// First match wins. Each pattern is tried against the message alone first, then against the
// message plus its details, so a detail cannot take over an error that names itself.
// The order is the order of importance: our own alerts, then WhatsApp, AI, the PC, the rest.
export const GUIDE = [
    // --- our own alerts (message-healing.js, update-check.js) ---
    { match: /belum versi terbaru/i, level: 'tindak',
        meaning: 'Ada versi bot yang lebih baru di GitHub.',
        todo: `1) ${MULAI[0].toUpperCase()}${MULAI.slice(1)}. 2) Pembaruan terpasang otomatis; data dan chat tidak hilang.` },
    { match: /perangkat bot ini sendiri/i, level: 'tindak',
        meaning: 'Ada salinan bot lain yang memakai kunci tautan WhatsApp yang sama (biasanya folder bot yang disalin ke tempat lain). Dua bot dengan kunci sama saling merusak enkripsi.',
        todo: '1) Tutup semua salinan bot lain, di PC ini dan PC lain. 2) Klik "Mulai ChatBot Prema": salinan dari folder lain dimatikan otomatis. 3) Di kartu WhatsApp klik "Scan ulang (kunci baru)", lalu scan dari HP toko. Chat dan pengaturan tidak hilang.' },
    { match: /perangkat tertaut lain/i, level: 'info',
        meaning: 'Ada perangkat lain di nomor ini (misalnya WhatsApp Web atau Desktop yang dipakai CS) yang pesannya belum bisa dibuka bot. Bot tetap melayani pelanggan; yang tidak terbaca hanya balasan CS dari perangkat itu.',
        todo: 'Tidak perlu melakukan apa-apa, dan JANGAN melepas perangkat yang dipakai CS. Kalau diminta developer, tekan "Salin teks" dan kirim. Perangkat yang tidak dikenal boleh dilepas lewat HP toko (WhatsApp Business > titik tiga > Perangkat tertaut); jangan lepas "ChatBot Prema".' },
    { match: /kunci enkripsi bot dan HP sudah tidak cocok/i, level: 'tindak',
        meaning: 'Bot tidak bisa membuka pesan yang dikirim dari HP toko, dan perbaikan otomatis selama 30 menit belum berhasil.',
        todo: '1) Pastikan hanya satu bot yang jalan (tutup bot di folder atau PC lain). 2) Di kartu WhatsApp klik "Scan ulang (kunci baru)", lalu scan dari HP toko. Chat dan pengaturan tidak hilang.' },
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

    // --- the connection to WhatsApp (messages from Baileys and from session.js) ---
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

    // --- messages that cannot be opened (WhatsApp encryption) ---
    { match: /failed to decrypt message|Bad MAC|No session|No matching sessions|Key used already|Invalid PreKey/i, level: 'cek',
        meaning: 'Satu pesan tidak bisa dibuka (kunci enkripsi pengirim belum cocok). WhatsApp biasanya mengirim ulang sendiri, dan bot memperbaikinya otomatis.',
        todo: '1) Tidak perlu apa-apa dulu. 2) Kalau tidak pulih, bot memberi peringatan sendiri setelah 5 menit dengan langkah yang tepat. 3) Kalau muncul terus untuk banyak pesan dan tidak ada peringatan lain, ' + KIRIM.toLowerCase() },

    // --- the AI ---
    { match: /mode AI aktif tetapi AI belum diatur/i, level: 'tindak',
        meaning: 'Mode AI menyala tetapi kunci AI belum diisi, jadi bot diam setelah sapaan.',
        todo: '1) Buka Pengaturan > AI. 2) Isi kunci Ollama. 3) Simpan.' },
    { match: /batas panggilan AI tercapai/i, level: 'cek',
        meaning: 'Pelanggan ini sudah memakai batas jumlah balasan AI. Pesannya menunggu dicoba lagi.',
        todo: 'Tidak perlu apa-apa. Kalau batasnya terlalu kecil, naikkan di Pengaturan > AI.' },
    { match: /AI gagal membalas/i, level: 'cek',
        meaning: 'AI belum menghasilkan balasan yang lolos pemeriksaan (atau AI sedang gangguan), jadi bot diam untuk pesan itu.',
        todo: '1) Bot mencoba lagi sendiri. 2) Kalau tetap gagal, pelanggan masuk ke "Perlu ditindaklanjuti CS" di Ringkasan: balas lewat WhatsApp Business di HP. 3) Kalau sering, cek kunci dan jatah AI di Pengaturan > AI.' },
    { match: /AI gagal(?: menulis|, memakai)/i, level: 'info',
        meaning: 'AI gagal, jadi bot memakai cara cadangan (kata kunci).',
        todo: TIDAK },
    { match: /Ollama 401|Ollama 403|unauthori[sz]ed/i, level: 'tindak',
        meaning: 'Kunci AI ditolak (salah atau sudah tidak berlaku).',
        todo: '1) Buka Pengaturan > AI. 2) Isi ulang kunci Ollama yang benar. 3) Simpan.' },
    { match: /Ollama 429|rate.?limit|too many requests|batas pemakaian/i, level: 'cek',
        meaning: 'Jatah pemakaian AI habis untuk sementara. Bot diam sampai jatahnya pulih.',
        todo: '1) Tunggu; jatah pulih sendiri. 2) Kalau sering, ganti atau upgrade akun AI di Pengaturan > AI.' },
    { match: /Ollama 5\d\d/i, level: 'info',
        meaning: 'Server AI sedang bermasalah (bukan PC ini).',
        todo: `${TIDAK} Biasanya pulih sendiri dalam beberapa menit.` },
    { match: /aborted due to timeout|TimeoutError|operation was aborted/i, level: 'cek',
        meaning: 'AI terlalu lama menjawab, jadi pesan itu tidak dibalas. Biasanya internet lambat atau server AI sibuk.',
        todo: '1) Tidak perlu apa-apa kalau jarang. 2) Kalau sering, naikkan "Batas waktu jawaban AI" di Pengaturan > AI.' },

    // --- customers waiting ---
    { match: /pesan tertunda perlu ditindaklanjuti CS|balasan tertunda terlalu lama/i, level: 'tindak',
        meaning: 'Ada pelanggan yang belum menerima balasan dari bot.',
        todo: '1) Buka Ringkasan > "Perlu ditindaklanjuti CS". 2) Balas pelanggan itu lewat WhatsApp Business di HP.' },
    { match: /balasan tertunda, akan dikirim ulang otomatis/i, level: 'info',
        meaning: 'Satu balasan belum terkirim (biasanya karena sambungan putus sebentar). Bot mengirim ulang sendiri.',
        todo: TIDAK },
    { match: /gagal melanjutkan pesan masuk tertunda|gagal memproses (pesan|status)/i, level: 'cek',
        meaning: 'Satu pesan gagal diproses. Pesannya tersimpan dan dicoba lagi otomatis; bot tetap jalan.',
        todo: `Tidak perlu apa-apa kalau tidak berulang. ${KIRIM}` },

    // --- the PC itself (disk, database, files, port) ---
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

    // --- the dashboard ---
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
    // Stacks are left out: their file and function names ("decryptMessage") would match anything.
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

/** What to tell the person at the PC: { level, meaning, todo, known }; never empty. */
export const guideOf = (message, detail = {}) => {
    const found = find(message, detail);

    return found
        ? { level: found.level, meaning: found.meaning, todo: found.todo, known: true }
        : { ...FALLBACK, known: false };
};

/** Just the meaning, or null when no guide of its own matches. */
export const meaningOf = (message, detail = {}) => find(message, detail)?.meaning ?? null;

export function recordError({ level = 'error', source = 'bot', message, detail = {} }) {
    const text = String(message ?? '').slice(0, 1000);
    feed.push({ id: ++lastId, time: stamp(), level, source, message: text, meaning: meaningOf(text, detail), guide: guideOf(text, detail), detail: plain(detail) });
    if (feed.length > MAX) feed.shift();
}

/** Entries after a given id (the console keeps the last one it showed). */
export const errorsSince = (id = 0) => feed.filter((e) => e.id > Number(id || 0));

export const latestErrorId = () => lastId;
