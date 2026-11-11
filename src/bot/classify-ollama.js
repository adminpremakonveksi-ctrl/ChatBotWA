import { z } from 'zod';

import { MAX_KEYS, allRestingError, hasKeys, markKey, pickKey } from '../ai-keys.js';
import { config } from '../config.js';
import { normaliseResult } from './intents.js';
import { productKeys } from './products.js';
import { resultSchema, systemPrompt, userTurn } from './classify-ai.js';


export const ollamaEnabled = () => Boolean(hasKeys() || config.ollama.hostSet);

let lastCall = null;
export const lastOllamaCall = () => lastCall;

export function parseJson(content) {
    const text = String(content ?? '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start < 0 || end <= start) throw new Error('Ollama tidak membalas JSON');

    return JSON.parse(text.slice(start, end + 1));
}

async function post(fetchImpl, options, slot) {
    const started = Date.now();
    try {
        return await fetchImpl(`${config.ollama.host}/api/chat`, options);
    } catch (error) {
        lastCall = { ok: false, at: new Date().toISOString(), ms: Date.now() - started, error: error.message, slot };
        throw error;
    }
}

const KEY_FAILURES = [401, 403, 429];

export async function ollamaJson({ system, user, schema, temperature = 0, messages = null }, { fetchImpl = fetch } = {}) {
    const requestBody = JSON.stringify({
        model: config.ollama.model,
        stream: false,
        think: false,
        format: z.toJSONSchema(schema),
        options: { temperature, num_ctx: config.ollama.numCtx },
        messages: [
            { role: 'system', content: `${system}\n\nJawab HANYA dengan satu objek JSON sesuai skema.` },
            ...(messages ?? [{ role: 'user', content: user }]),
        ],
    });

    const started = Date.now();
    let response;
    let slot = 0;
    let lastKeyWasRefused = false;
    for (let tried = 0; tried < MAX_KEYS; tried++) {
        const picked = pickKey();
        if (!picked) throw allRestingError();

        lastKeyWasRefused = false;
        slot = picked.slot;
        const headers = { 'Content-Type': 'application/json' };
        if (picked.key) headers.Authorization = `Bearer ${picked.key}`;
        response = await post(fetchImpl, { method: 'POST', headers, signal: AbortSignal.timeout(config.ollama.timeoutMs), body: requestBody }, slot);

        if (!picked.key || !KEY_FAILURES.includes(response.status)) break;

        const refusal = await response.json().catch(() => ({}));
        markKey(picked.key, response.status, refusal.error);
        lastKeyWasRefused = true;
    }

    if (lastKeyWasRefused) throw allRestingError();

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(`Ollama ${response.status}: ${String(body.error ?? '').slice(0, 160)}`);
        lastCall = { ok: false, at: new Date().toISOString(), ms: Date.now() - started, error: error.message, slot };
        throw error;
    }
    lastCall = { ok: true, at: new Date().toISOString(), ms: Date.now() - started, error: null, slot };

    const raw = String(body.message?.content ?? '');
    try {
        return { answer: parseJson(raw), raw };
    } catch (error) {
        throw Object.assign(new Error(`Ollama membalas JSON rusak: ${error.message}`), { raw, badJson: true });
    }
}

export async function classifyWithOllama(input, { fetchImpl = fetch } = {}) {
    const schema = resultSchema();
    const { answer, raw } = await ollamaJson(
        { system: `${systemPrompt()}\n\nPakai label persis dari daftar, jangan membuat label baru.`, user: userTurn(input), schema },
        { fetchImpl },
    );

    const parsed = schema.safeParse({ extras: [], product: null, name: null, origin: null, sizeVariant: 'reguler', ...answer });

    if (!parsed.success) {
        throw new Error(`Ollama memberi label di luar daftar: ${raw.slice(0, 120)}`);
    }

    return normaliseResult({ ...parsed.data, source: 'ollama' }, productKeys());
}
