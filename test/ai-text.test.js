import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { answerQuestion, openingLine, safeAiText, storeFacts } from '../src/bot/ai-text.js';
import { deleteTopic, saveTopic } from '../src/bot/knowledge.js';
import { classify } from '../src/bot/classify.js';
import { decide } from '../src/bot/engine.js';
import { replies } from '../src/bot/replies.js';
import { updateSettings } from '../src/settings.js';
import { config } from '../src/config.js';

const media = { has: () => false, links: () => [] };
const texts = (actions) => actions.filter((a) => a.type === 'text').map((a) => a.text);
const reply = (content) => async () => ({ ok: true, status: 200, json: async () => ({ message: { content } }) });

test('every line the AI writes is checked: no numbers, prices, promises, links', () => {
    assert.equal(safeAiText('Wah, buat acara 17an ya kak 😊'), null, 'a number is never sent');
    assert.equal(safeAiText('Harganya murah kok kak'), null);
    assert.equal(safeAiText('Pasti jadi besok kak'), null);
    assert.equal(safeAiText('Cek di https://contoh.com ya'), null);
    assert.equal(safeAiText('Siap, buat acara reuni ya kak 😊'), 'Siap, buat acara reuni ya kak 😊');
    assert.equal(safeAiText('x'.repeat(500)), null, 'too long');
});

test('the opening line goes before the fixed reply, never instead of it', async () => {
    const line = await openingLine({ text: 'mau bikin kaos buat acara reuni sekolah' }, { fetchImpl: reply('{"kalimat":"Wah, buat reuni sekolah ya kak 😊"}') });
    assert.equal(line, 'Wah, buat reuni sekolah ya kak 😊');

    const blocked = await openingLine({ text: 'mau bikin kaos 50 pcs' }, { fetchImpl: reply('{"kalimat":"Siap, 50 pcs ya kak"}') });
    assert.equal(blocked, null, 'a line with a number is dropped');

    const { actions } = decide({ step: 'awaiting_product' }, { intent: 'product', product: 'kaos', extras: [], patterns: [], opening: 'Wah, buat reuni sekolah ya kak 😊', text: 'x' }, media);
    assert.equal(texts(actions)[0], 'Wah, buat reuni sekolah ya kak 😊');
    assert.equal(texts(actions)[1], replies.askDesign('Kaos'), 'the fixed reply follows, unchanged');
});

test('a question with no fixed text: answered from the shop facts, or "belum tahu" + offer CS', async () => {
    // The shop's facts are Pengetahuan now (2026-10-21), the same the AI chat mode uses.
    const topic = saveTopic({ title: 'Bahan', content: 'Bahan kaos: cotton combed. Sablon: plastisol dan DTF.' });
    assert.match(storeFacts(), /cotton combed/);

    const known = await answerQuestion({ text: 'bahannya apa kak?' }, { fetchImpl: reply('{"jenis":"jawab","jawaban":"Untuk kaos kami pakai bahan cotton combed kak 😊"}') });
    assert.deepEqual(known, { type: 'answer', text: 'Untuk kaos kami pakai bahan cotton combed kak 😊' });

    const priced = await answerQuestion({ text: 'berapa per pcs' }, { fetchImpl: reply('{"jenis":"jawab","jawaban":"Mulai Rp 50.000 kak"}') });
    assert.deepEqual(priced, { type: 'unknown' }, 'an answer with a price is never sent');

    const far = await answerQuestion({ text: 'cuaca disana gimana' }, { fetchImpl: reply('{"jenis":"tidak_tahu","jawaban":""}') });
    assert.deepEqual(far, { type: 'unknown' });

    deleteTopic(topic.id);
});

test('"belum tahu": the bot offers CS; "iya" hands over, anything else carries on', () => {
    const asked = decide({ step: 'awaiting_product' }, { intent: 'other', extras: [], patterns: [], text: 'kalian bisa sablon glow in the dark?', aiAnswer: { type: 'unknown' } }, media);
    assert.deepEqual(texts(asked.actions), [replies.aiUnknown()]);
    assert.equal(asked.patch.offered_cs, 1);
    assert.equal(asked.patch.misses, undefined, 'not counted as a miss');

    const yes = decide({ step: 'awaiting_product', offered_cs: 1 }, { intent: 'ack', extras: [], patterns: [], text: 'iya boleh kak' }, media);
    assert.equal(yes.patch.step, 'handed_over');

    const no = decide({ step: 'awaiting_product', offered_cs: 1 }, { intent: 'product', product: 'kaos', extras: [], patterns: [], text: 'gak usah, saya mau bikin kaos aja' }, media);
    assert.equal(no.patch.step, 'awaiting_design', 'carries on with the flow');
    assert.equal(no.patch.offered_cs, 0);

    // "saya" is not "ya".
    const saya = decide({ step: 'awaiting_product', offered_cs: 1 }, { intent: 'other', extras: [], patterns: [], text: 'saya bingung' }, media);
    assert.notEqual(saya.patch.step, 'handed_over');
});

test('without AI nothing is written by it: the fixed flow as before', async () => {
    assert.equal(config.ollama.apiKey, '');
    const r = await classify({ text: 'mau bikin kaos buat acara reuni', step: 'awaiting_product' });
    assert.equal(r.opening, undefined);
    assert.equal(r.aiAnswer, undefined);
});
