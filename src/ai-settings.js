import { config } from './config.js';
import { DEFAULT_ANSWER_PROMPT, DEFAULT_OPENING_PROMPT } from './bot/ai-text.js';
import { getSetting, run, setSetting } from './db.js';

/**
 * Ollama set from the console (Pengaturan > AI), so a client never edits a
 * file. Stored in the database of that PC; .env stays the fallback.
 *
 *   key    Ollama Cloud API key (ollama.com). Empty with a host = local Ollama.
 *   model  e.g. gemma4:31b (free plan) or gpt-oss:20b.
 *   host   https://ollama.com, or http://localhost:11434 for a local Ollama.
 */

const KEYS = {
    key: 'ai:ollama_key',
    model: 'ai:ollama_model',
    host: 'ai:ollama_host',
    // The editable part of the AI's instructions (empty = the default in ai-text.js).
    openingPrompt: 'ai:opening_prompt',
    answerPrompt: 'ai:answer_prompt',
    // How often the AI may be asked (classify.js AI_LIMITS).
    perCustomer: 'ai:limit_customer',
    total: 'ai:limit_total',
};

// What .env said, to fall back to when the console value is cleared.
const fromEnv = { ...config.ollama };

const fail = (message, statusCode = 422) => {
    throw Object.assign(new Error(message), { statusCode });
};

/** Applies the console values over .env (on boot and after every save). */
export function loadAiSettings() {
    const key = getSetting(KEYS.key);
    const model = getSetting(KEYS.model);
    const host = getSetting(KEYS.host);

    config.ollama.apiKey = key || fromEnv.apiKey;
    config.ollama.model = model || fromEnv.model;
    config.ollama.host = host || fromEnv.host;
    config.ollama.hostSet = Boolean(host) || fromEnv.hostSet;
    config.ollama.openingPrompt = getSetting(KEYS.openingPrompt) || '';
    config.ollama.answerPrompt = getSetting(KEYS.answerPrompt) || '';
    config.ollama.limits = {
        perCustomer: Number(getSetting(KEYS.perCustomer)) || DEFAULT_LIMITS.perCustomer,
        total: Number(getSetting(KEYS.total)) || DEFAULT_LIMITS.total,
    };
}

/** AI calls per customer per 10 minutes, and for the whole bot per minute. */
export const DEFAULT_LIMITS = { perCustomer: 40, total: 60 };

const mask = (key) => (key ? `${'•'.repeat(8)}${key.slice(-4)}` : '');

/** What the console shows. The key itself never leaves the server. */
export function aiSettings() {
    const ownKey = getSetting(KEYS.key);

    return {
        enabled: Boolean(config.ollama.apiKey || config.ollama.hostSet),
        keyMasked: mask(config.ollama.apiKey),
        keySource: ownKey ? 'pengaturan' : config.ollama.apiKey ? '.env' : null,
        model: config.ollama.model,
        host: config.ollama.host,
        hostSet: config.ollama.hostSet,
        openingPrompt: config.ollama.openingPrompt || DEFAULT_OPENING_PROMPT,
        answerPrompt: config.ollama.answerPrompt || DEFAULT_ANSWER_PROMPT,
        promptsChanged: Boolean(config.ollama.openingPrompt || config.ollama.answerPrompt),
        perCustomer: config.ollama.limits?.perCustomer ?? DEFAULT_LIMITS.perCustomer,
        total: config.ollama.limits?.total ?? DEFAULT_LIMITS.total,
    };
}

/**
 * Saves what the console sent. key: undefined = unchanged, '' = remove the
 * console key (back to .env). model/host: '' = back to the default.
 */
export function updateAiSettings({ key, model, host, openingPrompt, answerPrompt, perCustomer, total } = {}) {
    // Instructions: the default (or empty) text means "use the default".
    for (const [name, value, fallback] of [['openingPrompt', openingPrompt, DEFAULT_OPENING_PROMPT], ['answerPrompt', answerPrompt, DEFAULT_ANSWER_PROMPT]]) {
        if (value === undefined) continue;
        const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
        if (text.length > 3000) fail('Instruksi AI maksimal 3000 huruf');
        if (!text || text === fallback.trim()) run(`DELETE FROM settings WHERE "key" = ?`, [KEYS[name]]);
        else setSetting(KEYS[name], text);
    }

    for (const [name, value, min, max, label] of [['perCustomer', perCustomer, 1, 500, 'Batas AI per pelanggan'], ['total', total, 1, 1000, 'Batas AI per menit']]) {
        if (value === undefined) continue;
        const n = Number(value);
        if (!Number.isInteger(n) || n < min || n > max) fail(`${label}: ${min}-${max}`);
        setSetting(KEYS[name], String(n));
    }

    if (key !== undefined) {
        const value = String(key ?? '').trim();
        if (value && (value.length < 10 || value.length > 300 || /\s/.test(value))) fail('Kunci API tidak valid: tempel kunci lengkap dari ollama.com (Settings > Keys)');
        if (value) setSetting(KEYS.key, value);
        else run(`DELETE FROM settings WHERE "key" = ?`, [KEYS.key]);
    }

    if (model !== undefined) {
        const value = String(model ?? '').trim();
        if (value && !/^[\w.:/-]{2,80}$/.test(value)) fail('Nama model tidak valid, mis. gemma4:31b');
        if (value) setSetting(KEYS.model, value);
        else run(`DELETE FROM settings WHERE "key" = ?`, [KEYS.model]);
    }

    if (host !== undefined) {
        let value = String(host ?? '').trim().replace(/\/+$/, '');
        if (value && !/^https?:\/\//i.test(value)) value = `http://${value}`;
        if (value) {
            try {
                new URL(value);
            } catch {
                fail('Alamat Ollama tidak valid, mis. http://localhost:11434');
            }
            setSetting(KEYS.host, value);
        } else {
            run(`DELETE FROM settings WHERE "key" = ?`, [KEYS.host]);
        }
    }

    loadAiSettings();

    return aiSettings();
}

/** Models the account/server offers, for the console's model list. */
export async function listOllamaModels({ fetchImpl = fetch } = {}) {
    const headers = config.ollama.apiKey ? { Authorization: `Bearer ${config.ollama.apiKey}` } : {};
    const response = await fetchImpl(`${config.ollama.host}/api/tags`, { headers, signal: AbortSignal.timeout(15000) });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) fail(`Ollama ${response.status}: ${String(body.error ?? '').slice(0, 200)}`, 502);

    return (body.models ?? []).map((m) => m.name).filter(Boolean);
}
