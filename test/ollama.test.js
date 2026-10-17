import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWithOllama, parseJson } from '../src/bot/classify-ollama.js';
import { config } from '../src/config.js';

const reply = (content, status = 200) => async () => ({ ok: status === 200, status, json: async () => (status === 200 ? { message: { content } } : { error: content }) });

test('a valid Ollama answer becomes a label; fences and missing fields are tolerated', async () => {
    const r = await classifyWithOllama({ text: 'kirim ke makassar bisa?' }, { fetchImpl: reply('```json\n{"intent":"shipping"}\n```') });
    assert.equal(r.intent, 'shipping');
    assert.equal(r.source, 'ollama');
    assert.deepEqual(r.extras, []);
});

test('a label outside the list is refused, so the keywords decide', async () => {
    await assert.rejects(classifyWithOllama({ text: 'x' }, { fetchImpl: reply('{"intent":"delivery"}') }), /di luar daftar/);
    await assert.rejects(classifyWithOllama({ text: 'x' }, { fetchImpl: reply('maaf saya tidak tahu') }), /JSON/);
    await assert.rejects(classifyWithOllama({ text: 'x' }, { fetchImpl: reply('model not in plan', 402) }), /Ollama 402/);
});

test('the request carries the key, the model and the label schema', async () => {
    const before = { ...config.ollama };
    Object.assign(config.ollama, { apiKey: 'k-test', model: 'gemma4:31b', host: 'https://ollama.com' });
    let seen;

    try {
        await classifyWithOllama({ text: 'halo' }, { fetchImpl: async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return reply('{"intent":"greeting"}')(); } });
    } finally {
        Object.assign(config.ollama, before);
    }

    assert.equal(seen.url, 'https://ollama.com/api/chat');
    assert.equal(seen.init.headers.Authorization, 'Bearer k-test');
    assert.equal(seen.body.model, 'gemma4:31b');
    assert.ok(seen.body.format.properties.intent.enum.includes('price'));
    assert.match(seen.body.messages[1].content, /<pesan>\nhalo\n<\/pesan>/);
});

test('parseJson finds the object inside prose', () => {
    assert.deepEqual(parseJson('Berikut: {"intent":"ack"} terima kasih'), { intent: 'ack' });
});
