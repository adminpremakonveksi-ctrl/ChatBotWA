import { all, get, now, run } from '../db.js';

const KEEP = 200;

const fingerprint = (question) => String(question ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 120);

export function recordUnanswered({ question, missing = '', product = null } = {}) {
    const text = String(question ?? '').trim().slice(0, 300);
    const key = fingerprint(text);
    if (!key) return null;

    const stamp = now();
    const hint = String(missing ?? '').trim().slice(0, 200);
    const existing = get('SELECT id, status FROM unanswered WHERE fingerprint = ?', [key]);

    if (existing) {
        run(
            `UPDATE unanswered SET times = times + 1, last_at = ?, missing = CASE WHEN ? <> '' THEN ? ELSE missing END,
             status = CASE WHEN status = 'done' THEN 'open' ELSE status END WHERE id = ?`,
            [stamp, hint, hint, existing.id],
        );

        return existing.id;
    }

    const { lastInsertRowid } = run(
        'INSERT INTO unanswered (fingerprint, question, missing, product, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?)',
        [key, text, hint, product || null, stamp, stamp],
    );
    run(`DELETE FROM unanswered WHERE status <> 'open' AND id NOT IN (SELECT id FROM unanswered ORDER BY last_at DESC LIMIT ?)`, [KEEP]);

    return Number(lastInsertRowid);
}

export const listUnanswered = (limit = 50) =>
    all(`SELECT id, question, missing, product, times, first_at, last_at FROM unanswered WHERE status = 'open' ORDER BY times DESC, last_at DESC LIMIT ?`, [limit]);

export const openUnansweredCount = () => get(`SELECT COUNT(*) AS n FROM unanswered WHERE status = 'open'`).n;

export function closeUnanswered(id, status) {
    if (!['done', 'dismissed'].includes(status)) throw Object.assign(new Error('Status tidak dikenal'), { statusCode: 422 });
    if (!get('SELECT 1 FROM unanswered WHERE id = ?', [id])) throw Object.assign(new Error('Pertanyaan tidak ditemukan'), { statusCode: 404 });

    run('UPDATE unanswered SET status = ? WHERE id = ?', [status, id]);
}
