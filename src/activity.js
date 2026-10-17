import { all, now, run } from './db.js';

/**
 * The activity log behind the console's Log page: what the team did in the
 * console (pages opened, changes saved), what the bot did with each message,
 * and notes the team writes for the developer ("mas mau tambah fitur ...").
 * A photo of the Log page shows where they were and what they were doing.
 *
 * Only what was changed is logged, never the values (keys and texts stay out).
 *
 * source: 'dashboard' | 'bot' | 'catatan'
 */

const MAX_DETAIL = 500;

export function recordActivity({ source, page = null, action, detail = null }) {
    try {
        run(`INSERT INTO activity_log (at, source, page, action, detail) VALUES (?, ?, ?, ?, ?)`, [
            now(),
            String(source).slice(0, 20),
            page ? String(page).slice(0, 40) : null,
            String(action).slice(0, 200),
            detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, MAX_DETAIL),
        ]);
    } catch {
        /* the log never breaks what it records */
    }
}

/** Newest first. source: one of the sources or null for all; q: text search. */
export function listActivity({ limit = 200, source = null, q = '' } = {}) {
    const where = [];
    const params = [];

    if (source) {
        where.push('source = ?');
        params.push(source);
    }
    if (q) {
        where.push('(action LIKE ? OR detail LIKE ? OR page LIKE ?)');
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    return all(
        `SELECT id, at, source, page, action, detail FROM activity_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`,
        [...params, Math.min(Number(limit) || 200, 1000)],
    );
}

/** Drops entries older than `days` (the daily maintenance job). */
export function pruneActivity(days) {
    return run(`DELETE FROM activity_log WHERE at < datetime('now', ?)`, [`-${Number(days)} days`]).changes;
}

/**
 * What a console request did, in words: "PUT /templates/clarify" -> "Mengubah
 * template clarify". Unknown routes fall back to the method and path.
 */
const ROUTES = [
    [/^PUT \/settings$/, (b) => `Mengubah Pengaturan (${Object.keys(b ?? {}).join(', ')})`],
    [/^PUT \/ai$/, (b) => `Mengubah pengaturan AI (${Object.keys(b ?? {}).filter((k) => k !== 'key').concat(b?.key !== undefined ? ['kunci API'] : []).join(', ')})`],
    [/^POST \/ai\/test$/, () => 'Tes koneksi AI'],
    [/^PUT \/templates\/([\w-]+)$/, (b, m) => `Mengubah template ${m[1]}`],
    [/^DELETE \/templates\/([\w-]+)$/, (b, m) => `Mengembalikan template ${m[1]} ke naskah asli`],
    [/^POST \/products$/, (b) => `Menambah produk "${b?.name ?? ''}"`],
    [/^PUT \/products\/([\w-]+)$/, (b, m) => `Mengubah produk ${m[1]} (${Object.keys(b ?? {}).join(', ')})`],
    [/^DELETE \/products\/([\w-]+)$/, (b, m) => `Menghapus produk ${m[1]}`],
    [/^POST \/patterns$/, (b) => `Membuat pola jawaban "${b?.name ?? ''}"`],
    [/^PUT \/patterns\/(\d+)$/, (b, m) => `Mengubah pola jawaban #${m[1]} (${Object.keys(b ?? {}).join(', ')})`],
    [/^DELETE \/patterns\/(\d+)$/, (b, m) => `Menghapus pola jawaban #${m[1]}`],
    [/^POST \/patterns\/(\d+)\/reset$/, (b, m) => `Mengembalikan pola #${m[1]} ke bawaan`],
    [/^POST \/patterns\/restore\/([\w-]+)$/, (b, m) => `Memulihkan pola bawaan ${m[1]}`],
    [/^POST \/patterns\/(\d+)\/photos$/, (b, m) => `Mengunggah foto pola #${m[1]}`],
    [/^POST \/keywords$/, (b) => `Mengajarkan kata kunci "${b?.phrase ?? ''}" → ${b?.intent ?? ''}`],
    [/^PUT \/keywords\/(\d+)$/, (b, m) => `Mengubah kata kunci #${m[1]}`],
    [/^DELETE \/keywords\/(\d+)$/, (b, m) => `Menghapus kata kunci #${m[1]}`],
    [/^POST \/words$/, (b) => `Menambah kata "${b?.word ?? ''}" ke kamus ${b?.list ?? ''}`],
    [/^PUT \/words\/(\d+)$/, (b, m) => `Mengubah kata kamus #${m[1]}`],
    [/^DELETE \/words\/(\d+)$/, (b, m) => `Menghapus kata kamus #${m[1]}`],
    [/^POST \/unrecognised\/dismiss$/, (b) => (b?.undo ? 'Memulihkan pesan ke Latih bot' : 'Mengabaikan pesan di Latih bot')],
    [/^POST \/media\/([^/]+)$/, (b, m) => `Mengunggah file ke ${decodeURIComponent(m[1])}`],
    [/^PUT \/media\/([^/]+)\/link$/, (b, m) => `Mengubah link ${decodeURIComponent(m[1])}`],
    [/^DELETE \/media\/file$/, () => 'Menghapus file media'],
    [/^POST \/catalog\/sync$/, () => 'Sinkron katalog WhatsApp Business'],
    [/^PUT \/catalog\/([^/]+)$/, (b, m) => `Mengubah pemetaan item katalog ${m[1]}`],
    [/^POST \/conversations\/[^/]+\/[^/]+\/reset$/, () => 'Mengembalikan percakapan ke bot'],
    [/^POST \/conversations\/[^/]+\/[^/]+\/handover$/, () => 'CS mengambil alih percakapan'],
    [/^POST \/simulate$/, (b) => `Coba bot: "${String(b?.text ?? '').slice(0, 80)}"`],
    [/^POST \/simulate\/reset$/, () => 'Coba bot: mulai ulang'],
    [/^POST \/patterns\/test$/, (b) => `Coba kalimat pola: "${String(b?.text ?? '').slice(0, 80)}"`],
    [/^POST \/sessions$/, () => 'Menambah nomor WhatsApp'],
    [/^DELETE \/sessions\/([^/]+)$/, (b, m) => `Menghapus nomor WhatsApp ${m[1]}`],
    [/^POST \/sessions\/([^/]+)\/(connect|disconnect|logout|rescan)$/, (b, m) => `Nomor WhatsApp ${m[1]}: ${{ connect: 'sambungkan', disconnect: 'putuskan', logout: 'lepas perangkat', rescan: 'scan ulang QR' }[m[2]]}`],
    [/^POST \/backup\/now$/, () => 'Backup sekarang'],
    [/^POST \/recap\/test$/, () => 'Kirim rekap uji'],
];

export function describeRequest(method, path, body) {
    const line = `${method} ${path.split('?')[0]}`;

    for (const [pattern, describe] of ROUTES) {
        const match = line.match(pattern);
        if (match) return describe(body, match);
    }

    return line;
}
