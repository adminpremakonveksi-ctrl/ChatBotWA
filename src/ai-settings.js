import { currentKey, hasKeys, keySlots, keyStatus } from './ai-keys.js';
import { config } from './config.js';
import { DEFAULT_ANSWER_PROMPT, DEFAULT_OPENING_PROMPT } from './bot/ai-text.js';
import { DEFAULT_CHAT_EXAMPLES, DEFAULT_CHAT_PROMPT } from './bot/chat.js';
import { getSetting, run, setSetting } from './db.js';


const KEYS = {
    key: 'ai:ollama_key',
    key2: 'ai:ollama_key_2',
    key3: 'ai:ollama_key_3',
    key4: 'ai:ollama_key_4',
    keyCooldown: 'ai:key_cooldown_min',
    model: 'ai:ollama_model',
    host: 'ai:ollama_host',
    chatPrompt: 'ai:chat_prompt',
    chatExamples: 'ai:chat_examples',
    openingPrompt: 'ai:opening_prompt',
    answerPrompt: 'ai:answer_prompt',
    perCustomer: 'ai:limit_customer',
    total: 'ai:limit_total',
    timeout: 'ai:timeout_s',
    trim: 'ai:trim_knowledge',
};

const fromEnv = { ...config.ollama };

const fail = (message, statusCode = 422) => {
    throw Object.assign(new Error(message), { statusCode });
};

export function loadAiSettings() {
    const key = getSetting(KEYS.key);
    const model = getSetting(KEYS.model);
    const host = getSetting(KEYS.host);

    config.ollama.apiKey = key || fromEnv.apiKey;
    config.ollama.extraKeys = [2, 3, 4].map((slot) => getSetting(KEYS[`key${slot}`]) || fromEnv.extraKeys?.[slot - 2] || '');
    config.ollama.keyCooldownMinutes = Number(getSetting(KEYS.keyCooldown)) || fromEnv.keyCooldownMinutes;
    config.ollama.model = model || fromEnv.model;
    config.ollama.host = host || fromEnv.host;
    config.ollama.hostSet = Boolean(host) || fromEnv.hostSet;
    config.ollama.chatPrompt = getSetting(KEYS.chatPrompt) || '';
    config.ollama.chatExamples = getSetting(KEYS.chatExamples) || '';
    config.ollama.openingPrompt = getSetting(KEYS.openingPrompt) || '';
    config.ollama.answerPrompt = getSetting(KEYS.answerPrompt) || '';
    config.ollama.limits = {
        perCustomer: Number(getSetting(KEYS.perCustomer)) || DEFAULT_LIMITS.perCustomer,
        total: Number(getSetting(KEYS.total)) || DEFAULT_LIMITS.total,
    };
    config.ollama.timeoutMs = (Number(getSetting(KEYS.timeout)) || 0) * 1000 || fromEnv.timeoutMs;
    config.ollama.trimKnowledge = getSetting(KEYS.trim) !== '0';
}

export const DEFAULT_LIMITS = { perCustomer: 40, total: 60 };

const mask = (key) => (key ? `${'•'.repeat(8)}${key.slice(-4)}` : '');

const SLOT_NAMES = ['key', 'key2', 'key3', 'key4'];

const keySource = (name, slotKey) => (getSetting(KEYS[name]) ? 'pengaturan' : slotKey ? '.env' : null);

export function aiSettings() {
    const ownKey = getSetting(KEYS.key);

    return {
        enabled: Boolean(hasKeys() || config.ollama.hostSet),
        keyMasked: mask(config.ollama.apiKey),
        keySource: ownKey ? 'pengaturan' : config.ollama.apiKey ? '.env' : null,
        keys: keyStatus().map((entry) => ({ ...entry, masked: mask(keySlots()[entry.slot - 1]), source: keySource(SLOT_NAMES[entry.slot - 1], keySlots()[entry.slot - 1]) })),
        keyCooldownMinutes: config.ollama.keyCooldownMinutes,
        model: config.ollama.model,
        host: config.ollama.host,
        hostSet: config.ollama.hostSet,
        chatPrompt: config.ollama.chatPrompt || DEFAULT_CHAT_PROMPT,
        chatPromptChanged: Boolean(config.ollama.chatPrompt || config.ollama.chatExamples),
        chatExamples: config.ollama.chatExamples || DEFAULT_CHAT_EXAMPLES,
        openingPrompt: config.ollama.openingPrompt || DEFAULT_OPENING_PROMPT,
        answerPrompt: config.ollama.answerPrompt || DEFAULT_ANSWER_PROMPT,
        promptsChanged: Boolean(config.ollama.openingPrompt || config.ollama.answerPrompt),
        perCustomer: config.ollama.limits?.perCustomer ?? DEFAULT_LIMITS.perCustomer,
        total: config.ollama.limits?.total ?? DEFAULT_LIMITS.total,
        timeoutSeconds: Math.round(config.ollama.timeoutMs / 1000),
        trimKnowledge: config.ollama.trimKnowledge !== false,
    };
}

const cleanKey = (value) => {
    const text = String(value ?? '').trim();
    if (text && (text.length < 10 || text.length > 300 || /\s/.test(text))) fail('Kunci API tidak valid: tempel kunci lengkap dari ollama.com (Settings > Keys)');

    return text;
};

export function updateAiSettings({ key, key2, key3, key4, keyCooldownMinutes, model, host, chatPrompt, chatExamples, openingPrompt, answerPrompt, perCustomer, total, timeoutSeconds, trimKnowledge } = {}) {
    const incoming = { key, key2, key3, key4 };
    const nextKeys = SLOT_NAMES.map((name, index) => (incoming[name] === undefined ? keySlots()[index] : cleanKey(incoming[name])));
    const used = nextKeys.filter(Boolean);
    if (new Set(used).size !== used.length) fail('Kunci yang sama tidak boleh dipakai dua kali: isi tiap kolom dengan kunci yang berbeda');

    for (const [name, value, fallback] of [['chatPrompt', chatPrompt, DEFAULT_CHAT_PROMPT], ['chatExamples', chatExamples, DEFAULT_CHAT_EXAMPLES], ['openingPrompt', openingPrompt, DEFAULT_OPENING_PROMPT], ['answerPrompt', answerPrompt, DEFAULT_ANSWER_PROMPT]]) {
        if (value === undefined) continue;
        const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
        if (text.length > 6000) fail('Instruksi AI maksimal 6000 huruf');
        if (!text || text === fallback.trim()) run(`DELETE FROM settings WHERE "key" = ?`, [KEYS[name]]);
        else setSetting(KEYS[name], text);
    }

    for (const [name, value, min, max, label] of [['perCustomer', perCustomer, 1, 500, 'Batas AI per pelanggan'], ['total', total, 1, 1000, 'Batas AI per menit'], ['timeout', timeoutSeconds, 10, 180, 'Batas waktu jawaban AI (detik)'], ['keyCooldown', keyCooldownMinutes, 1, 720, 'Jeda kunci yang habis jatah (menit)']]) {
        if (value === undefined) continue;
        const n = Number(value);
        if (!Number.isInteger(n) || n < min || n > max) fail(`${label}: ${min}-${max}`);
        setSetting(KEYS[name], String(n));
    }

    if (trimKnowledge !== undefined) setSetting(KEYS.trim, trimKnowledge === false || trimKnowledge === 'false' || trimKnowledge === '0' ? '0' : '1');

    SLOT_NAMES.forEach((name, index) => {
        if (incoming[name] === undefined) return;
        if (nextKeys[index]) setSetting(KEYS[name], nextKeys[index]);
        else run(`DELETE FROM settings WHERE "key" = ?`, [KEYS[name]]);
    });

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

export async function listOllamaModels({ fetchImpl = fetch } = {}) {
    const key = currentKey();
    const headers = key ? { Authorization: `Bearer ${key}` } : {};
    const response = await fetchImpl(`${config.ollama.host}/api/tags`, { headers, signal: AbortSignal.timeout(15000) });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) fail(`Ollama ${response.status}: ${String(body.error ?? '').slice(0, 200)}`, 502);

    return (body.models ?? []).map((m) => m.name).filter(Boolean);
}
