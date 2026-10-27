import { all, get, now, run } from '../db.js';
import { chatTurn } from './chat.js';
import { wordSet } from './words.js';

/**
 * The team's test chats for the AI (Coba bot > Uji AI), stored in SQLite and
 * editable in the console. Running one plays the chat through the real AI
 * turn (chat.js) in memory: nothing is sent and no customer is touched.
 *
 * A run fails when a bot reply contains a "tidak boleh" entry, misses a
 * "harus ada" entry, or the bot stays silent where #diam forbids it.
 * Special entries: #angka (any number), #angka-uang (an amount of money),
 * #link (any link), #serah (the chat must end with CS), #diam (never silent).
 */

const fail = (message, statusCode = 422) => {
    throw Object.assign(new Error(message), { statusCode });
};

const parseList = (value) => {
    try {
        const list = JSON.parse(value ?? '[]');
        return Array.isArray(list) ? list.map(String) : [];
    } catch {
        return [];
    }
};

const row = (r) => r && { id: r.id, name: r.name, messages: parseList(r.messages), forbid: parseList(r.forbid), expect: parseList(r.expect) };

export const listScenarios = () => all('SELECT * FROM ai_scenarios ORDER BY position, id').map(row);

const items = (value, split) =>
    (Array.isArray(value) ? value : String(value ?? '').split(split)).map((v) => String(v).trim()).filter(Boolean).slice(0, 30);

export function saveScenario({ id = null, name, messages, forbid, expect } = {}) {
    const n = String(name ?? '').trim().slice(0, 80);
    if (!n) fail('Nama skenario wajib diisi');
    const m = items(messages, '\n');
    if (!m.length) fail('Isi minimal satu pesan pelanggan (satu per baris)');
    if (m.length > 10) fail('Maksimal 10 pesan per skenario');
    const values = [n, JSON.stringify(m), JSON.stringify(items(forbid, ',')), JSON.stringify(items(expect, ','))];

    if (id) {
        if (!get('SELECT 1 FROM ai_scenarios WHERE id = ?', [id])) fail('Skenario tidak ditemukan', 404);
        run('UPDATE ai_scenarios SET name = ?, messages = ?, forbid = ?, expect = ?, updated_at = ? WHERE id = ?', [...values, now(), id]);

        return row(get('SELECT * FROM ai_scenarios WHERE id = ?', [id]));
    }

    const position = (get('SELECT MAX(position) AS p FROM ai_scenarios')?.p ?? -1) + 1;
    const { lastInsertRowid } = run('INSERT INTO ai_scenarios (name, messages, forbid, expect, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [...values, position, now(), now()]);

    return row(get('SELECT * FROM ai_scenarios WHERE id = ?', [lastInsertRowid]));
}

export const deleteScenario = (id) => run('DELETE FROM ai_scenarios WHERE id = ?', [id]);

const SPECIAL = {
    '#angka': /\d/,
    '#angka-uang': /\brp\.?\s*\d|\d[\d.,]*\s*(?:rb|ribu|k|jt|juta)\b/i,
    '#link': /https?:\/\/|www\.|\b[\w-]+\.(?:com|id|co|me|net|org|io|ly)\b/i,
};

const found = (entry, text) => (SPECIAL[entry] ? SPECIAL[entry].test(text) : text.toLowerCase().includes(entry.toLowerCase()));

/**
 * A "tidak boleh" phrase said in the negative is no violation: "tidak bisa
 * disablon" does not say "bisa disablon". The two words before each
 * occurrence are checked against Kamus kata_tidak (tidak, belum, gak, ...).
 */
function saidPositively(entry, text) {
    if (SPECIAL[entry]) return SPECIAL[entry].test(text);

    const words = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
    const phrase = ` ${entry.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
    const negations = wordSet('kata_tidak');

    for (let at = words.indexOf(phrase); at >= 0; at = words.indexOf(phrase, at + 1)) {
        const before = words.slice(0, at).trim().split(' ').slice(-2);
        if (!before.some((w) => negations.has(w))) return true;
    }

    return false;
}

/** Plays one scenario through the AI turn. { id, name, pass, problems, transcript }. */
export async function runScenario(id, { media, ask, fetchImpl } = {}) {
    const scenario = row(get('SELECT * FROM ai_scenarios WHERE id = ?', [id])) ?? fail('Skenario tidak ditemukan', 404);
    const transcript = [];
    const problems = [];
    let conv = { step: 'new' };
    let handedOver = false;

    for (const text of scenario.messages) {
        transcript.push({ from: 'pelanggan', text });
        // Only what was said in the chat: the AI's thinking and system lines are not conversation.
        const history = transcript.slice(0, -1).filter((t) => t.from === 'pelanggan' || t.from === 'bot').map((t) => ({ who: t.from, text: t.text })).slice(-12);
        const turn = await chatTurn(conv, { text, history, who: `uji|${id}` }, { media, ...(ask ? { ask } : {}), ...(fetchImpl ? { fetchImpl } : {}) });

        for (const a of turn.actions) {
            if (a.type === 'text') transcript.push({ from: 'bot', text: a.text, ai: Boolean(a.ai) });
            if (a.type === 'media') transcript.push({ from: 'bot', text: `[file ${a.kind} ${a.product ?? ''}]` });
            if (a.type === 'handover') {
                handedOver = true;
                transcript.push({ from: 'sistem', text: `diserahkan ke CS (${a.reason})` });
            }
        }
        if (turn.thought) transcript.push({ from: 'pikir', text: turn.thought });
        if (turn.silent) {
            transcript.push({ from: 'sistem', text: `bot diam: ${turn.silent}` });
            if (scenario.expect.includes('#diam')) problems.push(`bot diam pada "${text}" (${turn.silent})`);
        }

        conv = { ...conv, ...turn.patch, step: handedOver ? 'handed_over' : turn.patch.step ?? conv.step };
        if (handedOver) break;
    }

    // "Tidak boleh" counts in everything the bot sent; "harus ada" only in what the AI wrote (the fixed greeting mentions CS too).
    const said = transcript.filter((t) => t.from === 'bot').map((t) => t.text).join('\n');
    const written = transcript.filter((t) => t.ai).map((t) => t.text).join('\n');
    for (const entry of scenario.forbid) if (saidPositively(entry, said)) problems.push(`muncul yang tidak boleh: ${entry}`);
    for (const entry of scenario.expect) {
        if (entry === '#diam') continue;
        if (entry === '#serah') {
            if (!handedOver) problems.push('tidak diserahkan ke CS');
            continue;
        }
        if (!found(entry, written)) problems.push(`tidak ada yang harus ada: ${entry}`);
    }

    return { id: scenario.id, name: scenario.name, pass: !problems.length, problems, transcript };
}
