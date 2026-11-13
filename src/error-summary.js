import { all, get, now, run } from './db.js';
import { setErrorSink } from './errors.js';

const MERGE_WITHIN_MINUTES = 10;
const MAX_GROUPS = 60;

const clip = (value, max) => String(value ?? '').slice(0, max);

export function saveError(entry) {
    const message = clip(entry.message, 300);
    const recent = get(
        `SELECT id FROM error_log WHERE message = ? AND last_at >= datetime('now', ?) ORDER BY id DESC LIMIT 1`,
        [message, `-${MERGE_WITHIN_MINUTES} minutes`],
    );

    if (recent) {
        run('UPDATE error_log SET count = count + 1, last_at = ? WHERE id = ?', [now(), recent.id]);

        return;
    }

    run(
        `INSERT INTO error_log (at, last_at, level, source, message, meaning, todo, guide_level, known, code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [now(), now(), clip(entry.level, 20), clip(entry.source, 40), message, clip(entry.guide?.meaning, 600), clip(entry.guide?.todo, 900), entry.guide?.level ?? 'cek', entry.guide?.known ? 1 : 0, clip(entry.code ?? '?', 40)],
    );
}

setErrorSink(saveError);

export function errorSummary(hours = 24) {
    const since = `-${Math.min(24 * 14, Math.max(1, Number(hours) || 24))} hours`;
    const rows = all(
        `SELECT at, last_at, message, meaning, todo, guide_level, known, code, count FROM error_log WHERE last_at >= datetime('now', ?) ORDER BY id DESC`,
        [since],
    );

    const groups = new Map();
    for (const row of rows) {
        const key = row.known ? row.meaning : row.message;
        const group = groups.get(key) ?? { code: row.code, meaning: row.meaning, todo: row.todo, level: row.guide_level, known: Boolean(row.known), message: row.message, count: 0, lastAt: row.last_at, firstAt: row.at };
        group.count += row.count;
        group.firstAt = row.at;
        groups.set(key, group);
    }

    const rank = { tindak: 0, cek: 1, info: 2 };
    const list = [...groups.values()].sort((a, b) => (rank[a.level] ?? 2) - (rank[b.level] ?? 2) || b.lastAt.localeCompare(a.lastAt));

    return { hours: Number(hours) || 24, total: list.reduce((sum, g) => sum + g.count, 0), groups: list.slice(0, MAX_GROUPS), more: Math.max(0, list.length - MAX_GROUPS) };
}

export const pruneErrors = (days) => run(`DELETE FROM error_log WHERE last_at < datetime('now', ?)`, [`-${Number(days)} days`]).changes;
