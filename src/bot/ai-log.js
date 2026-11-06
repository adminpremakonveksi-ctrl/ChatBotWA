import { all, now, run } from '../db.js';

export function recordAi({ who = null, message = '', reply = '', problem, outcome }) {
    run('INSERT INTO ai_log (created_at, who, message, reply, problem, outcome) VALUES (?, ?, ?, ?, ?, ?)', [
        now(),
        who,
        String(message ?? '').slice(0, 500),
        String(reply ?? '').slice(0, 1200),
        String(problem ?? '').slice(0, 300),
        outcome,
    ]);
    run('DELETE FROM ai_log WHERE id NOT IN (SELECT id FROM ai_log ORDER BY id DESC LIMIT 500)');
}

export const listAi = (limit = 100) => all('SELECT * FROM ai_log ORDER BY id DESC LIMIT ?', [limit]);

export const clearAi = () => run('DELETE FROM ai_log');
