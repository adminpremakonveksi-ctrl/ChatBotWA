import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { askChat, chatTurn, checkReply } from '../src/bot/chat.js';
import { deleteFaq, deleteTopic, knowledgeBlock, listFaq, listTopics, moveTopic, saveFaq, saveTopic } from '../src/bot/knowledge.js';
import { getProduct, updateProduct } from '../src/bot/products.js';
import { replies } from '../src/bot/replies.js';
import { config } from '../src/config.js';
import { PREMA_PRODUCTS } from '../src/seeds-prema.js';

/**
 * AI chat mode (2026-10-21): after the fixed greeting the AI writes the
 * replies from the shop's data; the guards stay in code.
 */

const texts = (actions) => actions.filter((a) => a.type === 'text').map((a) => a.text);
const media = { has: (kind, product) => (kind === 'size-chart' && product === 'kaos') || (kind === 'katalog' && product === 'jersey') };
const withAi = async (fn) => {
    const before = config.ollama.apiKey;
    config.ollama.apiKey = 'test-key-1234567890';
    try {
        return await fn();
    } finally {
        config.ollama.apiKey = before;
    }
};
const answer = (over = {}) => ({ reply: 'Siap kak, kaosnya mau bahan apa?', send: [], handover: false, reason: '', note: '', name: '', ...over });

test('a reply is checked before it is sent: no money, no forbidden word, numbers and links only from the data', () => {
    const data = 'Cotton combed 24s: adem. Minimal order 24 pcs. Portofolio: t.me/portofolioprema';

    assert.equal(checkReply('Bahannya cotton combed 24s kak, adem 😊', data), null);
    assert.equal(checkReply('Minimal 24 pcs ya kak', data), null);
    assert.equal(checkReply('Bisa lihat di t.me/portofolioprema kak', data), null);
    assert.equal(checkReply('Untuk 50 pcs kami catat ya kak', `${data}\n<pesan>mau 50 pcs</pesan>`), null, 'the customer said 50');

    assert.match(checkReply('Harganya Rp 45.000 kak', data), /uang/);
    assert.match(checkReply('Sekitar 45rb kak', data), /uang/);
    assert.match(checkReply('Jadi 3 hari kak', data), /angka "3"/);
    assert.match(checkReply('Dijamin rapi kak', data), /terlarang/);
    assert.match(checkReply('Cek di instagram.com/premakonveksi', data), /link/);
    assert.match(checkReply('', data), /kosong/);
});

test('the first message gets the fixed greeting; a plain hello does not call the AI', async () => {
    let asked = 0;
    const ask = async () => (asked++, answer());

    const hello = await withAi(() => chatTurn({ step: 'new' }, { text: 'halo kak', who: 't1' }, { media, ask }));
    assert.deepEqual(texts(hello.actions), [replies.greetUnknown()]);
    assert.equal(hello.patch.step, 'chat');
    assert.equal(asked, 0);

    const known = await withAi(() => chatTurn({ step: 'new' }, { text: 'saya Budi dari Jogja', who: 't1' }, { media, ask }));
    assert.deepEqual(texts(known.actions), [replies.greetKnown('Budi')]);
    assert.equal(known.patch.name, 'Budi');

    // A request in the first message: the greeting, then the AI answers it.
    const asks = await withAi(() => chatTurn({ step: 'new' }, { text: 'halo kak mau bikin kaos 50 pcs', who: 't1' }, { media, ask }));
    assert.deepEqual(texts(asks.actions), [replies.greetUnknown(), answer().reply]);

    // The WhatsApp Business Salam already greeted: no second greeting.
    const salam = await withAi(() => chatTurn({ step: 'new' }, { text: 'mau tanya jaket', who: 't1', autoGreeted: true }, { media, ask }));
    assert.deepEqual(texts(salam.actions), [answer().reply]);
});

test('asking for a person and voice notes are answered by code, not the AI', async () => {
    const ask = async () => assert.fail('the AI is not asked');

    const human = await withAi(() => chatTurn({ step: 'chat' }, { text: 'mau ngobrol sama admin aja', who: 't2' }, { media, ask }));
    assert.deepEqual(texts(human.actions), [replies.waitForCs()]);
    assert.equal(human.actions.at(-1).type, 'handover');

    const voice = await withAi(() => chatTurn({ step: 'chat' }, { text: '', hasAudio: true, attachments: [{ kind: 'suara' }], who: 't2' }, { media, ask }));
    assert.deepEqual(texts(voice.actions), [replies.voiceNote()]);
});

test('AI down, not set up, or its reply refused: the bot stays silent and says why (client choice)', async () => {
    const down = await withAi(() => chatTurn({ step: 'chat' }, { text: 'bahan kaos apa saja?', who: 't3' }, { media, ask: async () => { throw new Error('Ollama 503: busy'); } }));
    assert.deepEqual(down.actions, []);
    assert.match(down.silent, /503/);

    const off = await chatTurn({ step: 'chat' }, { text: 'bahan kaos apa saja?', who: 't3' }, { media, ask: async () => answer() });
    assert.deepEqual(off.actions, []);
    assert.equal(off.silent, 'AI belum diatur');
});

test('a refused reply is sent back once with the reason; refused twice it is not sent', async () => {
    const calls = [];
    const reply = (balasan) => ({ ok: true, json: async () => ({ message: { content: JSON.stringify({ balasan, kirim: [], serahkan_cs: false, alasan: '', catatan_cs: '', nama_pelanggan: '' }) } }) });
    const fetchImpl = async (url, options) => {
        calls.push(JSON.parse(options.body));
        return calls.length === 1 ? reply('Harganya Rp 45.000 kak') : reply('Untuk harga nanti dihitung CS ya kak. Mau berapa pcs?');
    };

    const ok = await withAi(() => askChat({ text: 'harga kaos berapa?' }, { media, fetchImpl }));
    assert.equal(ok.reply, 'Untuk harga nanti dihitung CS ya kak. Mau berapa pcs?');
    assert.equal(calls.length, 2);
    assert.match(calls[1].messages.at(-1).content, /nominal uang/, 'the retry says what was wrong');
    assert.equal(calls[0].options.num_ctx, config.ollama.numCtx, 'the context size is asked explicitly');

    const always = async () => reply('Dijamin jadi kak');
    await assert.rejects(withAi(() => askChat({ text: 'cepat jadi?' }, { media, fetchImpl: always })), /ditolak.*terlarang/);
});

test('handover: the AI reply, then the fixed [7] (and [8] when the order is complete); the summary is kept for CS', async () => {
    const ask = async () => answer({ reply: 'Siap kak, sudah lengkap. Saya teruskan ke CS ya.', handover: true, reason: 'pesanan_lengkap', note: 'Kaos 50 pcs, combed 24s, sablon depan' });
    // A product the team gave no question list: the AI's 'complete' is taken (code decides when there is a list, see below).
    const r = await withAi(() => chatTurn({ step: 'chat', order_info: JSON.stringify({ produk: 'hoodie', jawaban: {} }) }, { text: 'ukurannya S 10 M 20 L 20', who: 't4' }, { media, ask }));

    assert.deepEqual(texts(r.actions), ['Siap kak, sudah lengkap. Saya teruskan ke CS ya.', replies.waitForCs(), replies.socials()]);
    assert.equal(r.actions.at(-1).type, 'handover');
    assert.deepEqual(JSON.parse(r.patch.notes), ['Pesanan Hoodie', 'Kaos 50 pcs, combed 24s, sablon depan']);

    // Without a product the AI cannot call the order complete.
    const early = await withAi(() => chatTurn({ step: 'chat' }, { text: 'udah itu aja', who: 't4' }, { media, ask }));
    assert.ok(!early.actions.some((x) => x.type === 'handover'));

    const complaint = await withAi(() => chatTurn({ step: 'chat' }, { text: 'kok belum dikirim sih', who: 't4' }, { media, ask: async () => answer({ reply: 'Mohon maaf kak 🙏', handover: true, reason: 'keluhan' }) }));
    assert.deepEqual(texts(complaint.actions), ['Mohon maaf kak 🙏', replies.waitForCs()]);
});

test('files the AI asks to send go out only when they exist', async () => {
    const ask = async () => answer({ reply: 'Ini size chart dan katalognya kak', send: [{ jenis: 'size_chart', produk: 'kaos' }, { jenis: 'katalog', produk: 'kaos' }, { jenis: 'katalog', produk: 'jersey' }, { jenis: 'size_chart', produk: 'tidak-ada' }] });
    const r = await withAi(() => chatTurn({ step: 'chat' }, { text: 'boleh lihat contohnya?', who: 't5' }, { media, ask }));

    assert.deepEqual(r.actions.filter((a) => a.type === 'media').map((a) => `${a.kind}:${a.product}`), ['size-chart:kaos', 'katalog:jersey']);
});

test('the shop data: topics and Q&A are editable, product details hold what is and is not done', () => {
    const titles = listTopics().map((t) => t.title);
    // Seeded from the owner's answers (2026-10-24), editable like any topic.
    assert.ok(titles.includes('Pembayaran & DP'));
    assert.match(listTopics().find((t) => t.title === 'Pembayaran & DP').content, /Kabupaten Purworejo minimal 50%/);
    const blank = saveTopic({ title: 'Topik baru kosong', content: '' });

    const topic = saveTopic({ title: 'Pembayaran & DP 2', content: 'DP 50% saat desain ACC' });
    assert.equal(saveTopic({ id: topic.id, title: 'Pembayaran & DP 2', content: 'DP 50%, pelunasan sebelum kirim' }).content, 'DP 50%, pelunasan sebelum kirim');
    moveTopic(topic.id, -1);
    assert.throws(() => saveTopic({ title: '' }), /Judul/);

    const faq = saveFaq({ product: 'kaos', question: 'Sablonnya awet?', answer: 'Awet kak, jangan disetrika di atas sablon' });
    assert.equal(listFaq().find((f) => f.id === faq.id).product, 'kaos');

    updateProduct('jas-almamater', { info: { bahan: 'High twist: tidak gampang kusut', teknik: 'bordir komputer', tidak: 'sablon: logo dibordir', tanya: 'warna\nlogo kampus\njumlah' } });
    const info = getProduct('jas-almamater').info;
    assert.deepEqual(info.bahan, [{ nama: 'High twist', ket: 'tidak gampang kusut' }]);
    assert.deepEqual(info.tidak, [{ nama: 'sablon', ganti: 'logo dibordir' }]);

    const block = knowledgeBlock(media);
    assert.match(block, /DP 50%, pelunasan sebelum kirim/);
    assert.match(block, /teknik yang TIDAK dilayani.*sablon → ganti dengan logo dibordir/);
    assert.match(block, /Sablonnya awet\?/);
    assert.match(block, /Kaos[^\n]*\n(?:.*\n)*?\s+file yang bisa dikirim: size chart/);
    assert.match(block, /belum diisi toko/, 'empty topics say so, so the AI does not guess');

    deleteFaq(faq.id);
    deleteTopic(topic.id);
    deleteTopic(blank.id);
    updateProduct('jas-almamater', { info: {} });
});

test('the bot in AI mode: sends the turn like the script (logged first), stays silent on AI trouble, CS typing still hands over', async () => {
    const { Bot } = await import('../src/bot/bot.js');
    const store = await import('../src/bot/store.js');
    const { run } = await import('../src/db.js');
    run('DELETE FROM conversations');
    run('DELETE FROM message_log');

    const before = config.bot.mode;
    config.bot.mode = 'ai';
    try {
        let mode = 'ok';
        const chat = async (conv, input, deps) => chatTurn(conv, input, { ...deps, ask: async () => {
            if (mode === 'down') throw new Error('Ollama 500');
            return answer({ reply: `Siap kak (${input.history.length} baris sebelumnya)` });
        } });
        const sent = [];
        const bot = new Bot({ chat, media: { links: () => [], files: () => [], has: () => false }, isActive: () => true, debounceMs: 5 });
        const wa = { newMessageId: () => `C${sent.length}-${Math.random()}`, send: async (jid, action) => sent.push(action.text) };
        const JID = '6281111@s.whatsapp.net';
        const say = async (text, id) => { bot.onIncoming('utama', wa, { jid: JID, id, text }); await new Promise((r) => setTimeout(r, 20)); await withAi(() => bot.drain()); };

        await withAi(() => say('halo', 'm1'));
        assert.deepEqual(sent, [replies.greetUnknown()]);
        assert.equal(store.loadConversation('utama', JID).step, 'chat');

        sent.length = 0;
        await withAi(() => say('bahan kaosnya apa saja kak?', 'm2'));
        assert.match(sent[0], /^Siap kak \(\d+ baris sebelumnya\)$/, 'the AI got the conversation so far');
        assert.notEqual(sent[0], 'Siap kak (0 baris sebelumnya)');

        sent.length = 0;
        mode = 'down';
        await withAi(() => say('jaket ada?', 'm3'));
        assert.deepEqual(sent, [], 'AI down: silent');
        assert.equal(store.loadConversation('utama', JID).step, 'chat', 'and not handed over');

        bot.onOwnMessage('utama', { jid: JID, id: 'cs-typed', text: 'Halo kak, saya Anggun' });
        assert.equal(store.loadConversation('utama', JID).step, 'handed_over');
    } finally {
        config.bot.mode = before;
    }
});

test('a chat already with CS gets nothing from the AI turn ("Coba bot" kept answering after a handover)', async () => {
    const r = await withAi(() => chatTurn({ step: 'handed_over' }, { text: 'halo?', who: 't6' }, { media, ask: async () => assert.fail('not asked') }));
    assert.deepEqual(r.actions, []);
    assert.equal(r.silent, 'sudah diserahkan ke CS');
});

test('code holds the order: answers kept per item, next item in the team\'s order, complete -> CS with a summary (2026-10-22)', async () => {
    const { readOrder, orderStatus } = await import('../src/bot/chat.js');
    updateProduct('jas-almamater', { info: { tanya: 'jumlah\nwarna\nlogo kampus\nrincian ukuran' } });
    const seen = [];
    const step = async (conv, text, over) => {
        const r = await withAi(() => chatTurn(conv, { text, who: 't7' }, { media, ask: async (input) => (seen.push(input), answer(over)) }));
        return { ...r, conv: { ...conv, ...r.patch } };
    };

    // "almet" is the keywords' or the AI's: the AI says which product.
    let r = await step({ step: 'chat' }, 'mau bikin almet buat himpunan', { reply: 'Siap kak, mau berapa pcs?', product: 'jas-almamater' });
    assert.equal(readOrder(r.conv).produk, 'jas-almamater');
    assert.equal(r.conv.product, 'jas-almamater');

    r = await step(r.conv, '40 pcs warna navy', { reply: 'Logonya sudah ada kak?', answered: [{ hal: 'jumlah', isi: '40 pcs' }, { hal: 'Warna', isi: 'navy' }] });
    assert.deepEqual(readOrder(r.conv).jawaban, { jumlah: '40 pcs', warna: 'navy' }, 'kept under the team\'s own wording');
    assert.deepEqual(orderStatus(readOrder(r.conv)).open, ['logo kampus', 'rincian ukuran']);
    // What the AI is told: the order so far, the next items in order, this product in full.
    r = await step(r.conv, 'logo nanti saya kirim, ukuran masih didata ya', { reply: 'Siap kak, ditunggu ya', answered: [{ hal: 'logo', isi: 'menyusul' }, { hal: 'rincian ukuran', isi: 'menyusul' }] });
    assert.deepEqual(seen.at(-1).focus, ['jas-almamater']);
    assert.equal(seen.at(-1).order.jawaban.warna, 'navy');
    assert.ok(!r.actions.some((a) => a.type === 'handover'), 'items to come later keep the chat open');
    assert.deepEqual(orderStatus(readOrder(r.conv)).waiting, ['logo kampus', 'rincian ukuran']);

    // The AI calling it complete early is not enough...
    const early = await step(r.conv, 'oke', { reply: 'Siap', handover: true, reason: 'pesanan_lengkap' });
    assert.ok(!early.actions.some((a) => a.type === 'handover'));

    // ...but once every item is in, code hands over, whatever the AI said.
    r = await step(r.conv, 'ini logonya, ukuran S 10 M 20 L 10', { reply: 'Terima kasih kak, sudah lengkap', answered: [{ hal: 'logo kampus', isi: 'dikirim (gambar)' }, { hal: 'rincian ukuran', isi: 'S 10, M 20, L 10' }] });
    assert.deepEqual(texts(r.actions), ['Terima kasih kak, sudah lengkap', replies.waitForCs(), replies.socials()]);
    assert.equal(r.actions.at(-1).reason, 'data pesanan lengkap');
    assert.equal(JSON.parse(r.conv.notes)[0], 'Pesanan Jas Almamater · jumlah: 40 pcs · warna: navy · logo kampus: dikirim (gambar) · rincian ukuran: S 10, M 20, L 10');

    // Another product named: its own order starts.
    const other = await step({ step: 'chat', order_info: JSON.stringify({ produk: 'jas-almamater', jawaban: { jumlah: '40 pcs' } }) }, 'eh kalau kaos bisa?', { reply: 'Bisa kak' });
    assert.deepEqual(readOrder(other.conv), { produk: 'kaos', jawaban: {}, ditanya: 'jumlah', lain: { 'jas-almamater': { jumlah: '40 pcs' } }, media_sent: {} }, 'kaos asks its own list; the almamater answers are kept (audit 2026-10-24)');

    updateProduct('jas-almamater', { info: {} });
});

test('the AI gets every detail of the product being discussed, the others in one line', () => {
    updateProduct('kaos', { info: { bahan: 'Cotton combed 24s: adem', sebutan: 'oblong' } });
    updateProduct('jaket', { info: { bahan: 'Taslan: tebal' } });

    const focused = knowledgeBlock(media, { focus: ['kaos'] });
    assert.match(focused, /Cotton combed 24s/);
    assert.doesNotMatch(focused, /Taslan/, 'other products: name only');
    assert.match(focused, /- Jaket \[kode: jaket\]/);

    const none = knowledgeBlock(media, { focus: [] });
    assert.doesNotMatch(none, /Cotton combed 24s/);
    assert.match(none, /Kaos \[kode: kaos\] \(nama lain: oblong\)/, 'names and their other names, to recognise the product');
    assert.match(knowledgeBlock(media), /Taslan/, 'no focus given: everything (naskah mode answers)');

    updateProduct('kaos', { info: {} });
    updateProduct('jaket', { info: {} });
});

test('what the guards stopped is logged for Uji AI: rewritten, silent, error', async () => {
    const { listAi, clearAi } = await import('../src/bot/ai-log.js');
    clearAi();
    const reply = (balasan) => ({ ok: true, json: async () => ({ message: { content: JSON.stringify({ balasan, kirim: [], serahkan_cs: false, alasan: '', catatan_cs: '', nama_pelanggan: '', produk: '', terjawab: [] }) } }) });
    let n = 0;
    await withAi(() => askChat({ text: 'harga?', who: 'coba|x' }, { media, fetchImpl: async () => (n++ ? reply('Dihitung CS ya kak') : reply('Rp 45.000 kak')) }));
    await withAi(() => chatTurn({ step: 'chat' }, { text: 'harga?', who: 'coba|y' }, { media, fetchImpl: async () => reply('Rp 45.000 kak') }));
    await withAi(() => chatTurn({ step: 'chat' }, { text: 'halo?', who: 'coba|z' }, { media, ask: async () => { throw new Error('Ollama 503'); } }));

    const log = listAi();
    assert.deepEqual(log.map((l) => l.outcome), ['error', 'diam', 'ditulis ulang']);
    assert.match(log[2].problem, /nominal uang/);
    assert.equal(log[2].reply, 'Rp 45.000 kak', 'the refused text is kept, to see what the AI tried');
});

test('Uji AI: seeded scenarios, editable, and a run reports what broke (2026-10-22)', async () => {
    const { deleteScenario, listScenarios, runScenario, saveScenario } = await import('../src/bot/ai-scenarios.js');
    const seeded = listScenarios();
    assert.ok(seeded.length >= 8, 'the default red-team chats are seeded');
    assert.ok(seeded.some((s) => s.name === 'Tanya harga'));

    assert.throws(() => saveScenario({ name: 'x', messages: '' }), /minimal satu pesan/);
    const s = saveScenario({ name: 'Harga uji', messages: 'halo\nharga kaos berapa?', forbid: '#angka-uang, dijamin', expect: '#diam, CS' });
    assert.deepEqual(s.forbid, ['#angka-uang', 'dijamin']);

    // A good run: no amount, says CS, never silent.
    const ok = await withAi(() => runScenario(s.id, { media, ask: async () => answer({ reply: 'Harganya dihitung CS Anggun ya kak' }) }));
    assert.equal(ok.pass, true, ok.problems.join('; '));
    assert.equal(ok.transcript[0].from, 'pelanggan');

    // A bad run: every broken rule is named. (An amount gets past here only because ask is faked.)
    const bad = await withAi(() => runScenario(s.id, { media, ask: async () => answer({ reply: 'Dijamin murah, cuma Rp 45.000 kak' }) }));
    assert.equal(bad.pass, false);
    assert.ok(bad.problems.some((p) => /#angka-uang/.test(p)));
    assert.ok(bad.problems.some((p) => /dijamin/.test(p)));
    assert.ok(bad.problems.some((p) => /CS/.test(p)));

    const silent = await withAi(() => runScenario(s.id, { media, ask: async () => { throw new Error('Ollama 503'); } }));
    assert.ok(silent.problems.some((p) => /bot diam/.test(p)));

    const cs = listScenarios().find((x) => x.name === 'Minta bicara dengan CS');
    assert.equal((await withAi(() => runScenario(cs.id, { media, ask: async () => answer() }))).pass, true, 'asking for a person ends with CS');

    deleteScenario(s.id);
});

test('the AI left "terjawab" empty: code puts the reply under the item being asked (live: answers went unrecorded)', async () => {
    const { readOrder } = await import('../src/bot/chat.js');
    updateProduct('jas-almamater', { info: { tanya: 'jumlah\nwarna\nlogo kampus\nrincian ukuran' } });
    const step = async (conv, text, extra = {}) => {
        const r = await withAi(() => chatTurn(conv, { text, who: 't9', ...extra }, { media, ask: async () => answer({ reply: 'Siap kak' }) }));
        return { ...r, conv: { ...conv, ...r.patch } };
    };

    let r = await step({ step: 'chat' }, 'mau bikin jas almamater');
    assert.equal(readOrder(r.conv).ditanya, 'jumlah', 'code knows what is being asked');
    r = await step(r.conv, '40 pcs');
    r = await step(r.conv, 'navy');
    assert.deepEqual(readOrder(r.conv).jawaban, { jumlah: '40 pcs', warna: 'navy' });

    // A question back is not an answer.
    r = await step(r.conv, 'logonya bisa di dada kiri?');
    assert.equal(readOrder(r.conv).jawaban['logo kampus'], undefined);

    // "Nanti saya kirim" is menyusul; a picture alone is "dikirim".
    r = await step(r.conv, 'logonya nanti saya kirim ya');
    assert.equal(readOrder(r.conv).jawaban['logo kampus'], 'menyusul');
    assert.equal(readOrder(r.conv).ditanya, 'rincian ukuran');
    r = await step(r.conv, 'S 10, M 20');
    r = await step({ ...r.conv, order_info: JSON.stringify({ ...readOrder(r.conv), ditanya: 'logo kampus' }) }, '', { attachments: [{ kind: 'gambar', note: 'gambar' }], hasImage: true });
    assert.equal(readOrder(r.conv).jawaban['logo kampus'], 'dikirim (gambar)');
    assert.equal(r.actions.at(-1).type, 'handover', 'everything in: to CS');

    updateProduct('jas-almamater', { info: {} });
});

test('Uji AI: a forbidden phrase said in the negative is no violation ("tidak bisa disablon")', async () => {
    const { listScenarios, runScenario } = await import('../src/bot/ai-scenarios.js');
    const s = listScenarios().find((x) => x.name === 'Teknik yang tidak dilayani');
    const no = await withAi(() => runScenario(s.id, { media, ask: async () => answer({ reply: 'Untuk jas almamater tidak bisa disablon kak, logonya dibordir' }) }));
    assert.equal(no.pass, true, no.problems.join('; '));
    const yes = await withAi(() => runScenario(s.id, { media, ask: async () => answer({ reply: 'Bisa disablon kok kak' }) }));
    assert.equal(yes.pass, false);
});

test('a broken JSON reply from the AI is asked again once (live: "Expected double-quoted property name")', async () => {
    let n = 0;
    const fetchImpl = async () => ({ ok: true, json: async () => ({ message: { content: n++ ? JSON.stringify({ balasan: 'Siap kak', kirim: [], serahkan_cs: false, alasan: '', catatan_cs: '', nama_pelanggan: '', produk: '', terjawab: [] }) : '{"balasan": "Siap kak",\n}' } }) });
    const r = await withAi(() => askChat({ text: 'halo' }, { media, fetchImpl }));
    assert.equal(r.reply, 'Siap kak');
    assert.equal(n, 2);
});

test('fixed amounts written in the shop data may be quoted exactly; any other amount is refused (client decision 2026-10-24)', () => {
    const data = 'Tambahan ukuran besar: XXL +Rp5.000, 3XL +Rp9.000. Desain rumit Rp25.000–Rp50.000.';

    assert.equal(checkReply('Untuk XXL tambah Rp5.000 kak, 3XL tambah Rp9.000', data, { money: data }), null);
    assert.equal(checkReply('Biasanya sekitar Rp25.000–Rp50.000 kak', data, { money: data }), null);
    assert.equal(checkReply('XXL tambah 5rb kak', data, { money: data }), null, 'the same amount written another way');
    assert.match(checkReply('3XL tambah Rp8.000 kak', data, { money: data }), /tidak tertulis di data toko/, 'the old surcharge is refused');
    assert.match(checkReply('Harga kaosnya Rp45.000 kak', data, { money: data }), /tidak tertulis/);
    // An amount the customer typed is not the shop's.
    assert.match(checkReply('Iya kak Rp1.000 saja', `${data}\n<pesan>boleh Rp1.000?</pesan>`, { money: data }), /tidak tertulis/);
    // Without the shop's amounts every amount is refused, as before.
    assert.match(checkReply('XXL tambah Rp5.000', data), /nominal uang/);
});

test('the owner\'s answers are seeded: topics, product details, new products, Q&A; the team\'s own edits are kept', async () => {
    const { getProduct: product, listProducts } = await import('../src/bot/products.js');
    const { classifyWithRules } = await import('../src/bot/classify-rules.js');
    const topic = (title) => listTopics().find((t) => t.title === title)?.content ?? '';

    assert.match(topic('Ukuran & tambahan biaya ukuran besar'), /3XL \+Rp9\.000/, 'page 14, the client confirmed');
    assert.doesNotMatch(topic('Ukuran & tambahan biaya ukuran besar'), /Rp8\.000/);
    assert.match(topic('Alamat & lokasi workshop'), /maps\.app\.goo\.gl\/hJZ2RZwcsNNeawc86/);
    assert.match(topic('Pembayaran & DP'), /luar Kabupaten Purworejo 60%/);
    assert.equal(product('pdl').info.moq, 'Minimal 6 pcs.');
    assert.deepEqual(product('pdl').info.teknik, ['bordir']);
    assert.ok(listProducts().some((p) => p.key === 'kaos-raglan') && listProducts().some((p) => p.key === 'pin-jarum'));
    assert.ok(listFaq().some((f) => f.question === 'XXL tambah berapa?'));
    assert.equal(classifyWithRules({ text: 'mau bikin pdh', step: 'awaiting_product' }).product, 'kemeja', 'PDH is Kemeja PDH, not PDL');
    assert.equal(classifyWithRules({ text: 'mau bikin pdl', step: 'awaiting_product' }).product, 'pdl');

    // Run again over a database the team already edited: nothing of theirs is touched.
    const { db } = await import('../src/db.js');
    const { runMigrations } = await import('../src/migrations.js');
    const t = listTopics().find((x) => x.title === 'Promo');
    saveTopic({ id: t.id, title: 'Promo', content: 'Promo 17an sampai akhir bulan' });
    updateProduct('pdl', { info: { ...product('pdl').info, moq: 'Minimal 10 pcs' } });
    db.prepare(`DELETE FROM migrations WHERE id = '019_prema_knowledge'`).run();
    runMigrations(db);
    assert.equal(topic('Promo'), 'Promo 17an sampai akhir bulan');
    assert.equal(product('pdl').info.moq, 'Minimal 10 pcs');
    assert.equal(listFaq().filter((f) => f.question === 'XXL tambah berapa?').length, 1, 'no Q&A twice');
});

test('a fixed amount from the data used as a product price is refused ("harganya Rp50.000")', () => {
    const data = 'Desain rumit Rp25.000–Rp50.000. XXL +Rp5.000.';
    assert.match(checkReply('Harganya Rp50.000 kak per pcs', data, { money: data }), /harga produk/);
    assert.match(checkReply('Totalnya Rp5.000 kak', data, { money: data }), /harga produk/);
    assert.equal(checkReply('Untuk harga dihitung CS ya kak. XXL tambah Rp5.000.', data, { money: data }), null, 'the price sentence has no amount');
});

test('audit 2026-10-24: amounts only from the shop data, whole numbers, real answers, late lists, handover step, first-message questions, product switch, fresh chats', async () => {
    const { readOrder, orderStatus, orderSummary } = await import('../src/bot/chat.js');

    // 1. The customer's "budget 50rb" filed in the order is no source for amounts.
    let prompt = '';
    const fetchImpl = async (url, options) => {
        prompt = JSON.parse(options.body).messages[0].content;
        return { ok: true, json: async () => ({ message: { content: JSON.stringify({ balasan: 'Tambahannya Rp70.000 kak', kirim: [], serahkan_cs: false, alasan: '', catatan_cs: '', nama_pelanggan: '', produk: '', terjawab: [] }) } }) };
    };
    await assert.rejects(withAi(() => askChat({ text: 'oke', order: { produk: 'kaos', jawaban: { budget: 'budget 70rb' } }, focus: [] }, { media, fetchImpl })), /nominal/);
    assert.match(prompt, /budget 70rb/, 'the AI still sees the answer');

    // 2. Whole numbers: the prompt's rule numbers or "30" in the data do not let "3 hari" through.
    assert.match(checkReply('Bisa jadi 3 hari kak', 'Cotton Combed 30s. Minimal 6 pcs.'), /angka "3"/);
    assert.equal(checkReply('Minimal 6 pcs kak', 'Cotton Combed 30s. Minimal 6 pcs.'), null);

    // 3. "belum ada desain" and "nanti diambil sendiri" are answers, not data to come.
    updateProduct('kaos', { info: { tanya: 'desain\npengiriman' } });
    const done = { produk: 'kaos', jawaban: { desain: 'belum ada desain, minta dibuatin', pengiriman: 'nanti diambil sendiri' } };
    assert.equal(orderStatus(done).complete, true);

    // 4. A list that was to come later is filed when it arrives, even if the AI writes nothing down.
    const step = async (conv, text, over = {}) => {
        const r = await withAi(() => chatTurn(conv, { text, who: 'a4' }, { media, ask: async () => answer(over) }));
        return { ...r, conv: { ...conv, ...r.patch } };
    };
    let r = await step({ step: 'chat', order_info: JSON.stringify({ produk: 'kaos', jawaban: { desain: 'ada' }, ditanya: 'pengiriman' }) }, 'nanti saya kabari ya');
    assert.equal(readOrder(r.conv).jawaban.pengiriman, 'menyusul');
    assert.equal(readOrder(r.conv).ditanya, 'pengiriman', 'still expected, as the waiting item');
    r = await step(r.conv, 'dikirim ke Kebumen');
    assert.equal(readOrder(r.conv).jawaban.pengiriman, 'dikirim ke Kebumen');

    // 5. A handover marks the step (Coba bot kept answering after one).
    assert.equal(r.conv.step, 'handed_over');
    const human = await withAi(() => chatTurn({ step: 'chat' }, { text: 'mau ngobrol sama admin', who: 'a5' }, { media, ask: async () => answer() }));
    assert.equal(human.patch.step, 'handed_over');

    // 6. A first message that greets and asks: the AI answers after the greeting.
    const first = await withAi(() => chatTurn({ step: 'new' }, { text: 'halo kak bisa bikin sepatu custom?', who: 'a6' }, { media, ask: async () => answer({ reply: 'Untuk sepatu belum ada kak' }) }));
    assert.deepEqual(texts(first.actions), [replies.greetUnknown(), 'Untuk sepatu belum ada kak']);

    // 7. Switching product keeps what was answered; the AI alone cannot move a known order.
    // (Three items: two answered keeps the order open, so the chat is not handed over.)
    updateProduct('kaos', { info: { tanya: 'jumlah\nwarna\nrincian ukuran' } });
    r = await step({ step: 'chat', order_info: JSON.stringify({ produk: 'kaos', jawaban: { jumlah: '40', warna: 'navy' } }) }, 'oke', { product: 'kaos-raglan' });
    assert.equal(readOrder(r.conv).produk, 'kaos', 'the AI guess did not move the order');
    r = await step(r.conv, 'kalau hoodie ada juga?');
    assert.equal(readOrder(r.conv).produk, 'hoodie');
    assert.deepEqual(readOrder(r.conv).lain.kaos, { jumlah: '40', warna: 'navy' });
    assert.match(orderSummary(readOrder(r.conv)), /juga Kaos · jumlah: 40 · warna: navy/);
    r = await step(r.conv, 'eh balik kaos aja deh');
    assert.deepEqual(readOrder(r.conv).jawaban, { jumlah: '40', warna: 'navy' }, 'back to kaos, its answers come back');

    // 8. A new conversation does not take the product from the previous one's lines.
    const fresh = await withAi(() => chatTurn({ step: 'new' }, { text: 'halo kak mau tanya dong', history: [{ who: 'pelanggan', text: 'mau bikin almet' }], who: 'a8' }, { media, ask: async () => answer() }));
    assert.equal(readOrder({ ...fresh.patch }).produk ?? null, null);

    updateProduct('kaos', { info: PREMA_PRODUCTS.kaos });
});

test('the AI thinks before it writes: "pikir" comes first, is never sent, and the team sees it (2026-10-27)', async () => {
    const { thoughtOf } = await import('../src/bot/chat.js');
    let body = null;
    const fetchImpl = async (url, options) => {
        body = JSON.parse(options.body);
        return { ok: true, json: async () => ({ message: { content: JSON.stringify({ pikir: { maksud: 'tanya bahan kaos', fakta: 'Cotton Combed 24s dan 30s', belum_tahu: '', langkah: 'jawab lalu tanya jumlah' }, balasan: 'Ada Cotton Combed 24s dan 30s, Kak. Mau berapa pcs?', kirim: [], serahkan_cs: false, alasan: '', catatan_cs: '', nama_pelanggan: '', produk: 'kaos', terjawab: [] }) } }) };
    };
    const r = await withAi(() => chatTurn({ step: 'chat' }, { text: 'bahan kaos apa aja?', who: 'p1' }, { media, fetchImpl }));

    assert.deepEqual(Object.keys(body.format.properties).slice(0, 2), ['pikir', 'balasan'], 'thinking is written first');
    assert.match(body.messages[0].content, /CARA BERPIKIR/);
    assert.match(body.messages[0].content, /CONTOH GAYA[\s\S]*Nagata Drill termasuk pilihan bahan PDL/, 'the owner\'s example chats');
    assert.deepEqual(texts(r.actions), ['Ada Cotton Combed 24s dan 30s, Kak. Mau berapa pcs?'], 'the thinking is not sent');
    assert.match(r.thought, /maksud: tanya bahan kaos · fakta: Cotton Combed 24s dan 30s · langkah: jawab lalu tanya jumlah/);
    assert.equal(thoughtOf(null), '');

    // The examples are the team's to edit; empty goes back to the owner's.
    const { updateAiSettings, aiSettings } = await import('../src/ai-settings.js');
    updateAiSettings({ chatExamples: 'Pelanggan: halo\n{bot}: Halo juga, Kak!' });
    await withAi(() => chatTurn({ step: 'chat' }, { text: 'bahan kaos apa aja?', who: 'p2' }, { media, fetchImpl }));
    assert.match(body.messages[0].content, /Halo juga, Kak!/);
    assert.doesNotMatch(body.messages[0].content, /Nagata Drill termasuk pilihan bahan PDL/);
    updateAiSettings({ chatExamples: '' });
    assert.match(aiSettings().chatExamples, /Nagata Drill/);
});

test('last touch (2026-10-27): the AI knows the time and when CS is back; no repeated reply; emoji in moderation', async () => {
    const { timeBlock } = await import('../src/bot/chat.js');
    const before = { ...config.bot };
    Object.assign(config.bot, { timezone: 'Asia/Jakarta', activeFrom: '17:30', activeUntil: '07:30', forceMode: '', holidays: [] });
    try {
        // Saturday 2026-10-24 21:30 WIB: on guard all Sunday; CS is back Monday, at the shop's CS hours (not the bot's 07.30).
        const sat = timeBlock(new Date('2026-10-24T14:30:00Z'));
        assert.match(sat, /WAKTU SEKARANG: Sabtu, pukul 21\.30 WIB/);
        assert.match(sat, /CS Anggun sedang tidak online; CS membalas lagi Senin \(Senin\), pada jam kerja CS/);
        assert.doesNotMatch(sat, /07\.30/);
        // Tuesday 2026-10-27 20:00 WIB: back tomorrow.
        assert.match(timeBlock(new Date('2026-10-27T13:00:00Z')), /lagi besok \(Rabu\)/);
        // Office hours: no "not online" line.
        assert.doesNotMatch(timeBlock(new Date('2026-10-27T03:00:00Z')), /tidak online/);

        // The times are facts, so a reply may quote them.
        let prompt = '';
        const fetchImpl = async (url, options) => {
            prompt = JSON.parse(options.body).messages[0].content;
            return { ok: true, json: async () => ({ message: { content: JSON.stringify({ pikir: { maksud: 'kapan dibalas', fakta: 'Senin, jam kerja CS 08.30', belum_tahu: '', langkah: 'jawab' }, balasan: 'CS Anggun membalas lagi Senin mulai pukul 08.30 ya, Kak 😊', kirim: [], serahkan_cs: false, alasan: '', catatan_cs: '', nama_pelanggan: '', produk: '', terjawab: [] }) } }) };
        };
        const r = await withAi(() => askChat({ text: 'adminnya kapan bales kak?', now: new Date('2026-10-24T14:30:00Z') }, { media, fetchImpl }));
        assert.equal(r.reply, 'CS Anggun membalas lagi Senin mulai pukul 08.30 ya, Kak 😊', 'the hour from the owner\'s Jam kerja CS');
        assert.match(prompt, /WAKTU SEKARANG/);
    } finally {
        Object.assign(config.bot, before);
    }

    const last = 'Untuk bahan kaos ada Cotton Combed 24s dan 30s, Kak. Mau pakai yang mana?';
    assert.match(checkReply('Untuk bahan kaos ada Cotton Combed 24s dan 30s ya Kak. Mau pakai yang mana?', 'Cotton Combed 24s 30s', { previous: last }), /hampir sama/);
    assert.equal(checkReply('Siap, 24s ya Kak. Warnanya mau apa?', 'Cotton Combed 24s 30s', { previous: last }), null);
    assert.match(checkReply('Siap kak 😊😊🙏🎉', ''), /emoji/);
    assert.equal(checkReply('Siap kak 😊🙏', ''), null);
});

test('"halo" again mid-chat (2026-10-28): the greeting is returned whole, not cut to "Juga Kak ..."', async () => {
    let system = '';
    const fetchImpl = async (url, options) => {
        system = JSON.parse(options.body).messages[0].content;
        return { ok: true, json: async () => ({ message: { content: JSON.stringify({ pikir: { maksud: '', fakta: '', belum_tahu: '', langkah: '' }, balasan: 'Halo lagi, Kak! Mau lanjut soal jas almamaternya?', kirim: [], serahkan_cs: false, alasan: '', catatan_cs: '', nama_pelanggan: '', produk: '', terjawab: [] }) } }) };
    };
    const conv = { step: 'chat', name: 'Haikal', order_info: JSON.stringify({ produk: 'jas-almamater', jawaban: {} }) };

    // Mid-chat, nothing sent before this reply: the rule against greeting must not apply.
    const mid = await withAi(() => chatTurn(conv, { text: 'Halo', who: 'g1' }, { media, fetchImpl }));
    assert.deepEqual(texts(mid.actions), ['Halo lagi, Kak! Mau lanjut soal jas almamaternya?'], 'the hello is kept whole');
    assert.doesNotMatch(system, /JANGAN menyapa lagi/);
    assert.match(system, /menyapa lagi di tengah obrolan[\s\S]*mau melanjutkan/);

    // Right after the fixed greeting (first message with a question): no second hello.
    await withAi(() => chatTurn({ step: 'new' }, { text: 'halo kak bisa bikin kaos?', who: 'g2' }, { media, fetchImpl }));
    assert.match(system, /JANGAN menyapa lagi/);

    // The WhatsApp Business Salam went out mid-chat: it greeted, so the AI does not greet again.
    const salam = await withAi(() => chatTurn(conv, { text: 'Halo', who: 'g3', autoGreeted: true }, { media, fetchImpl }));
    assert.deepEqual(texts(salam.actions), ['Mau lanjut soal jas almamaternya?'], 'after a greeting the extra hello goes whole');

    const { dropGreeting } = await import('../src/bot/ai-text.js');
    assert.equal(dropGreeting('Halo juga, Kak Haikal! Mau lanjut?', 'Haikal'), 'Mau lanjut?');
    assert.equal(dropGreeting('Halo kak bisa banget, minimal 12 pcs'), 'Bisa banget, minimal 12 pcs', 'a lowercase word after "kak" is not a name');
    assert.equal(dropGreeting('Haikal suka?', 'Haikal'), 'Haikal suka?', 'no greeting, nothing cut');
    assert.match(system, /JANGAN menyapa lagi/);
    assert.match(system, /lewati sapaannya/);
});
