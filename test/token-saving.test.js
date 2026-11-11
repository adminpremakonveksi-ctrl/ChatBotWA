import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { updateAiSettings } from '../src/ai-settings.js';
import { askChat } from '../src/bot/chat.js';
import { deleteFaq, knowledgeParts, listFaq, listTopics, saveFaq, saveTopic } from '../src/bot/knowledge.js';
import { relevanceQuery, scoreOf, tokensOf } from '../src/bot/relevance.js';
import { config } from '../src/config.js';

const withKey = async (fn) => {
    const before = config.ollama.apiKey;
    config.ollama.apiKey = 'test-key-1234567890';
    try {
        return await fn();
    } finally {
        config.ollama.apiKey = before;
    }
};

const body = (over = {}) => ({
    pikir: { maksud: 'tanya', fakta: 'ada di data', belum_tahu: '', langkah: 'jawab' },
    balasan: 'Siap, Kak 😊',
    kirim: [],
    serahkan_cs: false,
    alasan: '',
    catatan_cs: '',
    nama_pelanggan: '',
    produk: '',
    terjawab: [],
    ...over,
});

const scripted = (answers) => {
    const prompts = [];
    const fetchImpl = async (url, options) => {
        prompts.push(JSON.parse(options.body).messages.map((m) => m.content).join('\n'));
        return { ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify(answers[Math.min(prompts.length, answers.length) - 1]) } }) };
    };

    return { fetchImpl, prompts };
};

const LONG = 'kalimat panjang pengisi. '.repeat(20);

const addDeposit = () => saveTopic({ title: 'Pembayaran dan DP', content: `DP lima puluh persen lewat transfer rekening toko. ${LONG}` });
const addShipping = () => saveTopic({ title: 'Pengiriman luar kota', content: `Pengiriman memakai ekspedisi pilihan pelanggan. ${LONG}` });
const clean = () => {
    listTopics().filter((t) => ['Pembayaran dan DP', 'Pengiriman luar kota'].includes(t.title)).forEach((t) => saveTopic({ id: t.id, title: t.title, content: '' }));
};

test('word matching tolerates prefixes and ignores filler words', () => {
    assert.deepEqual(tokensOf('Kak, mau tanya DP dan pengiriman ke Makassar'), ['tanya', 'pengiriman', 'makassar']);
    assert.ok(scoreOf('Pembayaran dan DP lewat transfer', tokensOf('cara bayar')) > 0);
    assert.equal(scoreOf('Lokasi toko di Purworejo', tokensOf('cara bayar')), 0);
    assert.deepEqual(relevanceQuery({ text: 'oke', history: [{ who: 'pelanggan', text: 'bayarnya gimana' }, { who: 'bot', text: 'lewat transfer' }] }), ['bayarnya']);
});

test('lean knowledge keeps related topics in full and shortens the unrelated long ones', () => {
    addDeposit();
    addShipping();

    const full = knowledgeParts(null, { focus: [] });
    const lean = knowledgeParts(null, { focus: [], query: tokensOf('bagaimana cara bayar DP') });

    assert.equal(full.trimmed, 0);
    assert.ok(lean.trimmed > 0);
    assert.ok(lean.text.length < full.text.length);
    assert.match(lean.text, /DP lima puluh persen/);
    assert.match(lean.text, /Pengiriman luar kota: \(isi ada, tidak ditampilkan/);
    assert.doesNotMatch(lean.text, /ekspedisi pilihan pelanggan/);
});

test('a topic pinned by title always stays, and a short topic always stays', () => {
    saveTopic({ title: 'Jam kerja CS', content: `Senin sampai Sabtu pukul 08.30. ${LONG}` });
    saveTopic({ title: 'Nama toko', content: 'Prema Konveksi' });

    const lean = knowledgeParts(null, { focus: [], query: tokensOf('cara bayar'), keep: ['jam kerja'] });

    assert.match(lean.text, /Senin sampai Sabtu pukul 08\.30/);
    assert.match(lean.text, /Nama toko: Prema Konveksi/);
});

test('tanya-jawab is filtered by the message too', () => {
    const faq = saveFaq({ question: 'Apakah ada garansi jahitan?', answer: 'Ada perbaikan jahitan gratis.' });
    const other = saveFaq({ question: 'Apakah bisa kirim ke luar pulau?', answer: 'Bisa lewat ekspedisi.' });

    const lean = knowledgeParts(null, { focus: [], query: tokensOf('garansi jahitan gimana') });

    assert.match(lean.text, /garansi jahitan/);
    assert.doesNotMatch(lean.text, /luar pulau/);

    deleteFaq(faq.id);
    deleteFaq(other.id);
    assert.equal(listFaq().some((f) => f.id === faq.id), false);
});

test('the AI call carries less data when the saving is on, and full data when it is off', async () => {
    addDeposit();
    addShipping();

    const lean = scripted([body()]);
    await withKey(() => askChat({ text: 'cara bayar DP gimana?', history: [] }, { fetchImpl: lean.fetchImpl }));

    updateAiSettings({ trimKnowledge: false });
    const full = scripted([body()]);
    await withKey(() => askChat({ text: 'cara bayar DP gimana?', history: [] }, { fetchImpl: full.fetchImpl }));
    updateAiSettings({ trimKnowledge: true });

    assert.equal(lean.prompts.length, 1);
    assert.equal(full.prompts.length, 1);
    assert.ok(lean.prompts[0].length < full.prompts[0].length);
    assert.match(full.prompts[0], /ekspedisi pilihan pelanggan/);
    assert.doesNotMatch(lean.prompts[0], /ekspedisi pilihan pelanggan/);
    assert.equal(config.ollama.trimKnowledge, true);
});

test('when the AI gives up after data was left out, it asks once more with the full data', async () => {
    addDeposit();
    addShipping();

    const calls = scripted([
        body({ balasan: 'Untuk detail ini aku teruskan ke admin ya, Kak', serahkan_cs: true, alasan: 'tidak_bisa_bantu', pikir: { maksud: 'tanya kirim', fakta: 'tidak ada di data', belum_tahu: 'ekspedisi', langkah: 'serahkan' } }),
        body({ balasan: 'Pakai ekspedisi pilihan Kakak ya 😊' }),
    ]);
    const result = await withKey(() => askChat({ text: 'cara bayar DP gimana?', history: [] }, { fetchImpl: calls.fetchImpl }));

    assert.equal(calls.prompts.length, 2);
    assert.doesNotMatch(calls.prompts[0], /ekspedisi pilihan pelanggan/);
    assert.match(calls.prompts[1], /ekspedisi pilihan pelanggan/);
    assert.equal(result.reply, 'Pakai ekspedisi pilihan Kakak ya 😊');
});

test('when the guard refuses a reply that used trimmed data, it asks once more with the full data', async () => {
    saveTopic({ title: 'Garansi retur', content: `Retur diterima sampai 14 hari setelah barang sampai. ${LONG}` });

    const calls = scripted([
        body({ balasan: 'Retur sampai 14 hari ya, Kak.' }),
        body({ balasan: 'Retur diterima sampai 14 hari ya, Kak.' }),
    ]);
    const result = await withKey(() => askChat({ text: 'cara bayar DP gimana?', history: [] }, { fetchImpl: calls.fetchImpl }));

    assert.equal(calls.prompts.length, 3);
    assert.match(calls.prompts[2], /Retur diterima sampai 14 hari/);
    assert.equal(result.reply, 'Retur diterima sampai 14 hari ya, Kak.');
});

test('a plain answer does not trigger a second call', async () => {
    const calls = scripted([body()]);
    await withKey(() => askChat({ text: 'cara bayar DP gimana?', history: [] }, { fetchImpl: calls.fetchImpl }));

    assert.equal(calls.prompts.length, 1);
    clean();
});
