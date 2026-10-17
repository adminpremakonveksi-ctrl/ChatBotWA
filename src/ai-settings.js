import { config } from './config.js';
import { getSetting, run, setSetting } from './db.js';

/**
 * Ollama set from the console (Pengaturan > AI), so a client never edits a
 * file. Stored in the database of that PC; .env stays the fallback.
 *
 *   key    Ollama Cloud API key (ollama.com). Empty with a host = local Ollama.
 *   model  e.g. gemma4:31b (free plan) or gpt-oss:20b.
 *   host   https://ollama.com, or http://localhost:11434 for a local Ollama.
 */

const KEYS = { key: 'ai:ollama_key', model: 'ai:ollama_model', host: 'ai:ollama_host' };

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
}

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
    };
}

/**
 * Saves what the console sent. key: undefined = unchanged, '' = remove the
 * console key (back to .env). model/host: '' = back to the default.
 */
export function updateAiSettings({ key, model, host } = {}) {
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
