/**
 * Recent errors and warnings, raw, for the console's error pop-up: the client
 * photographs it and the developer reads exactly what failed. Filled by the
 * logger (every warn/error line) and by the HTTP error handler.
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

// What a raw error means for the person at the PC, shown ABOVE the raw text (which
// stays as logged, for the developer). First match wins; no match, no line.
const MEANINGS = [
    [/belum bisa dipulihkan setelah 5 menit|terlalu banyak pesan belum terbaca/i,
        'Pemulihan otomatis belum berhasil. Pastikan HP utama tersambung internet dan buka WhatsApp Business di HP. Bot tetap mencoba; jika belum pulih, kirim detail Log ini ke developer.'],
    [/connection closed|connection lost|connection terminated|timed out.*(ws|websocket)|ECONNRESET|socket hang up/i,
        'Sambungan PC ke WhatsApp putus sebentar (internet putus atau lambat). Bot menyambung ulang sendiri; kalau di Ringkasan WhatsApp tetap "terputus" lebih dari 5 menit, cek internet PC ini.'],
    [/stream errored out|stream:error|code.*515|restart required/i,
        'WhatsApp meminta sambungan disegarkan (restart normal kode 515). Bot menyambung ulang sendiri secara otomatis.'],
    [/dropping spoofed self-only protocolMessage/i,
        'Pesan sinkronisasi internal akun WhatsApp diabaikan oleh Baileys. Ini normal dan tidak mengganggu percakapan pelanggan.'],
    [/ENOTFOUND|EAI_AGAIN|getaddrinfo|ENETUNREACH|EHOSTUNREACH|fetch failed/i,
        'PC ini tidak bisa menjangkau internet (Wi-Fi/kabel LAN putus, modem mati, atau kuota habis). Bot jalan lagi sendiri begitu internet kembali.'],
    [/aborted due to timeout|TimeoutError|operation was aborted/i,
        'AI terlalu lama menjawab, jadi pesan itu tidak dibalas. Biasanya internet lambat atau server AI sibuk. Kalau sering, naikkan "Batas waktu jawaban AI" di Pengaturan > AI.'],
    [/Ollama 401|Ollama 403|unauthori[sz]ed/i,
        'Kunci AI ditolak (salah atau sudah tidak berlaku). Isi ulang kunci di Pengaturan > AI.'],
    [/Ollama 429|rate.?limit|too many requests|batas pemakaian/i,
        'Jatah pemakaian AI habis untuk sementara. Bot diam sampai jatahnya pulih, atau ganti/upgrade akun AI.'],
    [/Ollama 5\d\d/i,
        'Server AI sedang bermasalah (bukan PC ini). Biasanya pulih sendiri dalam beberapa menit.'],
    [/conflict|diambil alih program lain|replaced/i,
        'Nomor ini sedang dipakai bot lain (PC lain atau jendela bot kedua). Satu nomor hanya boleh satu bot: matikan yang lain, lalu sambungkan lagi di kartu WhatsApp.'],
    [/Bad MAC|failed to decrypt|No session|No matching sessions|decrypt/i,
        'Satu pesan tidak bisa dibuka (kunci enkripsi pengirim belum cocok). WhatsApp biasanya mengirim ulang sendiri. Kalau terus muncul dari perangkat yang sama, cek Perangkat tertaut di HP.'],
    [/sudah dipakai: bot lain sedang jalan|EADDRINUSE/i,
        'Bot sudah jalan di jendela lain. Tutup semua jendela bot, lalu klik "Mulai ChatBot Prema" sekali saja.'],
    [/Tidak bisa menghubungi bot/i,
        'Halaman ini tidak bisa menghubungi bot: bot belum jalan atau jendelanya tertutup. Klik "Mulai ChatBot Prema".'],
    [/belum versi terbaru/i,
        'Bukan kerusakan: ada pembaruan. Tutup jendela bot, lalu klik "Mulai ChatBot Prema".'],
];

export const meaningOf = (message, detail = {}) => {
    // Stacks are left out: their file and function names ("decryptMessage") would match anything.
    let extra = '';
    try {
        extra = JSON.stringify(detail ?? {}, (k, v) => (k === 'stack' ? undefined : v instanceof Error ? v.message : v)).slice(0, 2000);
    } catch {}
    const text = `${message ?? ''} ${extra}`;

    return MEANINGS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
};

export function recordError({ level = 'error', source = 'bot', message, detail = {} }) {
    const text = String(message ?? '').slice(0, 1000);
    feed.push({ id: ++lastId, time: stamp(), level, source, message: text, meaning: meaningOf(text, detail), detail: plain(detail) });
    if (feed.length > MAX) feed.shift();
}

/** Entries after a given id (the console keeps the last one it showed). */
export const errorsSince = (id = 0) => feed.filter((e) => e.id > Number(id || 0));

export const latestErrorId = () => lastId;
