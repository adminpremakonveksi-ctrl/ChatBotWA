import { z } from 'zod';

import { config } from '../config.js';
import { normaliseResult } from './intents.js';
import { productKeys } from './products.js';
import { resultSchema, systemPrompt, userTurn } from './classify-ai.js';

/**
 * Intent recognition through Ollama: Ollama Cloud (ollama.com, API key) or a
 * local Ollama (OLLAMA_HOST, no key). Same prompt and same labels as the
 * Claude classifier; the model only labels, it never writes a reply.
 *
 * Open models do not always keep to the schema (they answer "delivery" or
 * "shipping_inquiry" for a label that does not exist), so every answer is
 * validated; anything invalid is an error and the keywords decide instead.
 */

export const ollamaEnabled = () => Boolean(config.ollama.apiKey || config.ollama.hostSet);

/** The JSON object in a reply, also when the model wraps it in ```json fences or prose. */
export function parseJson(content) {
    const text = String(content ?? '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start < 0 || end <= start) throw new Error('Ollama tidak membalas JSON');

    return JSON.parse(text.slice(start, end + 1));
}

export async function classifyWithOllama(input, { fetchImpl = fetch } = {}) {
    const schema = resultSchema();
    const headers = { 'Content-Type': 'application/json' };
    if (config.ollama.apiKey) headers.Authorization = `Bearer ${config.ollama.apiKey}`;

    const response = await fetchImpl(`${config.ollama.host}/api/chat`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(config.ollama.timeoutMs),
        body: JSON.stringify({
            model: config.ollama.model,
            stream: false,
            think: false,
            format: z.toJSONSchema(schema),
            options: { temperature: 0 },
            messages: [
                { role: 'system', content: `${systemPrompt()}\n\nJawab HANYA dengan satu objek JSON sesuai skema. Pakai label persis dari daftar, jangan membuat label baru.` },
                { role: 'user', content: userTurn(input) },
            ],
        }),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(`Ollama ${response.status}: ${String(body.error ?? '').slice(0, 160)}`);
    }

    // Fields a small model leaves out get their neutral value; the labels themselves must be valid.
    const answer = parseJson(body.message?.content);
    const parsed = schema.safeParse({ extras: [], product: null, name: null, origin: null, sizeVariant: 'reguler', ...answer });

    if (!parsed.success) {
        throw new Error(`Ollama memberi label di luar daftar: ${String(body.message?.content).slice(0, 120)}`);
    }

    return normaliseResult({ ...parsed.data, source: 'ollama' }, productKeys());
}
