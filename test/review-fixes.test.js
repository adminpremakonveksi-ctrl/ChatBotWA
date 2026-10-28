import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { Bot } from '../src/bot/bot.js';
import { classifyWithRules } from '../src/bot/classify-rules.js';
import { decide } from '../src/bot/engine.js';
import { updateProduct } from '../src/bot/products.js';
import { replies } from '../src/bot/replies.js';
import * as store from '../src/bot/store.js';
import { run } from '../src/db.js';
import { SEED_QUESTIONS, SIZE_QUESTION } from '../src/seeds.js';

/**
 * One test per problem found in the code review, so none of them comes back.
 */

const media = { has: (kind, product) => kind === 'katalog' && product === 'jersey', links: () => [] };
const texts = (actions) => actions.filter((a) => a.type === 'text').map((a) => a.text);
const step = (conv, text, extra = {}) => {
    const { actions, patch } = decide(conv, { ...classifyWithRules({ text, step: conv.step }), ...extra }, media);

    return { actions, conv: { ...conv, ...patch } };
};

test('misses are counted whatever the label, so asking again always ends at CS', () => {
    // A picture at the product question is "has_reference": not understood there, and still counted.
    let conv = { step: 'awaiting_product' };
    for (let i = 0; i < 2; i++) {
        const r = step(conv, '', { intent: 'has_reference' });
        assert.deepEqual(texts(r.actions), [replies.clarify(i)]);
        conv = r.conv;
    }
    assert.equal(step(conv, '', { intent: 'has_reference' }).conv.step, 'handed_over');
});

test('at a follow-up question: another product is a change of mind, a greeting is not an answer', () => {
    updateProduct('kemeja', { questions: [...SEED_QUESTIONS.kemeja, SIZE_QUESTION] });

    let r = step({ step: 'awaiting_product' }, 'mau bikin kemeja');
    r = step(r.conv, 'halo kak');
    assert.deepEqual(r.actions, []);
    assert.equal(r.conv.details ?? null, null, 'a greeting is not stored as the answer');

    r = step(r.conv, 'eh kalau jaket bisa?');
    assert.equal(r.conv.product, 'jaket', 'switched to jaket');

    updateProduct('kemeja', { questions: [] });
});

test('asking the price during the follow-up questions keeps them', () => {
    updateProduct('jersey', { questions: [...SEED_QUESTIONS.jersey, SIZE_QUESTION] });

    // The agreed flow: catalog, the product's question, [5], the size question last.
    let r = step({ step: 'awaiting_product' }, 'mau bikin jersey');
    assert.equal(r.conv.step, 'awaiting_detail');

    r = step(r.conv, 'harganya berapa?');
    assert.equal(r.conv.step, 'awaiting_detail', 'still at the follow-up question');

    r = step(r.conv, 'futsal');
    assert.deepEqual(texts(r.actions), [replies.askQuantityCatalog()]);
    r = step(r.conv, '15 stel');
    assert.deepEqual(texts(r.actions), [SIZE_QUESTION], 'the size question is still asked');

    updateProduct('jersey', { questions: [] });
});

test('a new customer whose first message asks for a person goes to CS at once', () => {
    const r = step({ step: 'new' }, 'mau ngobrol sama admin aja');
    assert.equal(r.conv.step, 'handed_over');
});

test('the amount said for one product does not carry over to another', () => {
    let r = step({ step: 'awaiting_product' }, 'mau bikin kaos 50 pcs');
    assert.equal(r.conv.quantity, '50 pcs');

    r = step({ ...r.conv, step: 'awaiting_quantity' }, 'eh jersey aja deh');
    assert.equal(r.conv.product, 'jersey');
    assert.equal(r.conv.quantity, null);
    assert.deepEqual(texts(r.actions), [replies.askQuantityCatalog()], 'asked how many jerseys');
});

test('after the WhatsApp Business Salam: the first message is not apologised for, and an old Salam is ignored', async () => {
    run('DELETE FROM conversations');
    const sent = [];
    const bot = new Bot({ classify: async (input) => classifyWithRules(input), media: { links: () => [], files: () => [], has: () => false }, isActive: () => true, debounceMs: 5 });
    const wa = { newMessageId: () => `R${sent.length}`, send: async (jid, action) => sent.push(action.text) };
    const salam = replies.greetUnknown();

    bot.onIncoming('utama', wa, { jid: 'a@s.whatsapp.net', id: 'a1', text: 'xyz qwerty' });
    bot.onOwnMessage('utama', { jid: 'a@s.whatsapp.net', id: 'salam-a', text: salam });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();
    assert.deepEqual(sent, [], 'no "belum paham" to the very first message');
    assert.equal(store.loadConversation('utama', 'a@s.whatsapp.net').step, 'awaiting_intro');

    // A Salam from long ago (sent by day) does not mute the night.
    bot.onOwnMessage('utama', { jid: 'b@s.whatsapp.net', id: 'salam-b', text: salam });
    bot.autoGreeted.set('utama|b@s.whatsapp.net', Date.now() - 60 * 60 * 1000);
    bot.onIncoming('utama', wa, { jid: 'b@s.whatsapp.net', id: 'b1', text: 'halo kak' });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();
    assert.deepEqual(sent, [replies.greetUnknown()], 'greeted as usual');
});

test('from the simulated chats: names, sizes, amounts and design said along the way', () => {
    updateProduct('hoodie', { questions: [SEED_QUESTIONS.hoodie[0], SIZE_QUESTION] });

    // "SMA 1" is not one piece; "perkenalkan saya Dimas" is a name.
    let r = step({ step: 'new' }, 'Selamat malam, perkenalkan saya Dimas dari SMA 1 Purworejo');
    assert.equal(r.conv.name, 'Dimas');
    assert.equal(r.conv.quantity ?? null, null);

    r = step(r.conv, 'Kami berencana memesan hoodie angkatan sebanyak 120 pcs');
    assert.equal(r.conv.quantity, '120 pcs');
    assert.deepEqual(texts(r.actions), [replies.askDesign('Hoodie')], 'the agreed flow: [4] first');

    // "nanti saya kirim filenya" is not a name; the amount is known, so the follow-up questions come now.
    r = step(r.conv, 'Desainnya sudah ada, nanti saya kirim filenya');
    assert.equal(r.conv.name, 'Dimas');
    assert.equal(r.conv.step, 'awaiting_detail');
    r = step(r.conv, 'Pakai resleting');
    assert.deepEqual(texts(r.actions), [SIZE_QUESTION], 'the size list is asked last');

    // "Ukuran beragam, nanti kami kirimkan datanya" answers the size question (no size chart, no "Seragam").
    r = step(r.conv, 'Ukuran beragam, nanti kami kirimkan datanya');
    assert.equal(r.conv.product, 'hoodie');
    assert.equal(r.conv.step, 'handed_over');

    updateProduct('hoodie', { questions: [] });
});

test('"belum ada desain" at [4] gets the portfolio and [5]; the follow-up questions come after the amount', () => {
    updateProduct('kaos', { questions: SEED_QUESTIONS.kaos });

    let r = step({ step: 'awaiting_product' }, 'mau bikin kaos');
    r = step(r.conv, 'belum ada desain kak');
    assert.deepEqual(texts(r.actions), [replies.portfolio(), replies.askQuantity()]);
    assert.equal(r.conv.step, 'awaiting_quantity');

    r = step(r.conv, '30 pcs');
    assert.deepEqual(texts(r.actions), [SEED_QUESTIONS.kaos[0]]);

    updateProduct('kaos', { questions: [] });
});

test('odd messages: unknown products, "kamu bot?", anger, phone, amounts in words', () => {
    const c = (text, s = 'awaiting_product') => classifyWithRules({ text, step: s });

    assert.equal(c('bisa bikin sepatu?').intent, 'product_unknown');
    assert.deepEqual(texts(step({ step: 'awaiting_product' }, 'bisa bikin sepatu?').actions), [replies.productUnknown()]);

    assert.equal(c('kamu bot ya?').intent, 'about_bot');
    const bot = step({ step: 'awaiting_design', product: 'kaos' }, 'kamu bot ya?');
    assert.deepEqual(texts(bot.actions), [replies.aboutBot()]);
    assert.equal(bot.conv.step, 'awaiting_design', 'no handover for asking');

    assert.equal(c('goblok bot nya lama banget').intent, 'human');
    assert.equal(c('tolong telpon saya aja di nomor itu').intent, 'human');

    assert.equal(c('bikin kaos 2rb pcs').quantity, '2rb pcs');
    assert.equal(c('dua ratus biji aja deh', 'awaiting_detail').quantity, 'dua ratus pcs');
    assert.equal(c('how much for 100 pieces?').quantity, '100 pcs');

    // A typo guess for a pattern does not beat a product named exactly.
    assert.equal(c('seragam batik kantor').product, 'kemeja');
    assert.notEqual(c('seragam batik kantor').intent, 'custom');

    assert.equal(classifyWithRules({ text: 'sya agus dr wonosobo', step: 'awaiting_intro' }).name, 'Agus');
});

test('one message asking for the same catalog twice sends it once', () => {
    const asked = { has: () => true, links: () => [] };
    const r = classifyWithRules({ text: 'ada contoh desain jersey ga? mau bikin jersey', step: 'awaiting_product' });
    const { actions } = decide({ step: 'awaiting_product', name: 'Wawan' }, r, asked);

    assert.equal(actions.filter((a) => a.type === 'media' && a.kind === 'katalog').length, 1);
});

test('questions only CS can answer: noted, said so once, the chat goes on', () => {
    let r = step({ step: 'awaiting_product' }, 'bisa dp dulu ga kak?');
    assert.deepEqual(texts(r.actions), [replies.csQuestion()]);
    assert.equal(r.conv.step, 'awaiting_product');
    assert.deepEqual(JSON.parse(r.conv.notes), ['bisa dp dulu ga kak?']);

    // Next to a question the bot answers: both.
    r = step({ step: 'awaiting_product' }, 'minimal order berapa? terus bisa dicicil?');
    assert.equal(r.actions.filter((a) => a.text === replies.csQuestion()).length, 1);
    assert.ok(texts(r.actions).some((t) => /minimum pemesanan/.test(t)));

    // A product chosen later keeps the note (it is not part of the order details).
    r = step({ step: 'awaiting_product', notes: JSON.stringify(['bisa dp?']) }, 'mau bikin kaos');
    assert.equal(r.conv.notes, JSON.stringify(['bisa dp?']));
});

test('a voice note is asked to be typed; a picture is received and noted', () => {
    const voice = decide({ step: 'awaiting_product' }, classifyWithRules({ text: '', hasAudio: true, step: 'awaiting_product' }), media);
    assert.deepEqual(texts(voice.actions), [replies.voiceNote()]);

    const picture = decide({ step: 'awaiting_product' }, classifyWithRules({ text: '', hasImage: true, step: 'awaiting_product' }), media);
    assert.deepEqual(texts(picture.actions), [replies.imageReceived()]);
    assert.deepEqual(JSON.parse(picture.patch.notes), ['[gambar dari pelanggan]']);
});

test('the AI gets the lines before the message, never the message twice', async () => {
    const { recentHistory, logMessage } = store;
    run('DELETE FROM message_log');
    logMessage({ sessionKey: 'utama', jid: 'h@s.whatsapp.net', direction: 'in', text: 'mau bikin jersey' });
    logMessage({ sessionKey: 'utama', jid: 'h@s.whatsapp.net', direction: 'out', text: 'Jersey-nya untuk olahraga apa kak?' });
    logMessage({ sessionKey: 'utama', jid: 'h@s.whatsapp.net', direction: 'in', text: 'yang tadi itu buat futsal' });

    assert.deepEqual(recentHistory('utama', 'h@s.whatsapp.net', 1), [
        { who: 'pelanggan', text: 'mau bikin jersey' },
        { who: 'bot', text: 'Jersey-nya untuk olahraga apa kak?' },
    ]);
});

test('"belum paham" is worded differently each time it is said in a row', () => {
    assert.notEqual(replies.clarify(0), replies.clarify(1));
    assert.ok(replies.isClarify(replies.clarify(2)));
    assert.ok(!replies.isClarify('halo'));
});

test('the socket does not send the start-up queries that timed out on a client PC (2026-10-19)', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../src/session.js', import.meta.url), 'utf8');

    // "unexpected error in 'init queries'": props, block list and privacy settings, none used by the bot.
    assert.match(source, /fireInitQueries:\s*false/);
});

test('custom active hours: a window that does not cross midnight works (08.30 -> 18.30 was "always")', async () => {
    const { isBotActive, inWindow } = await import('../src/bot/schedule.js');
    const at = (iso) => new Date(iso);
    // Monday 2026-10-19, Asia/Jakarta (UTC+7).
    const day = { timezone: 'Asia/Jakarta', activeFrom: '08:30', activeUntil: '18:30', forceMode: '', holidays: [] };
    assert.equal(isBotActive(at('2026-10-19T02:00:00Z'), day), true, '09.00: inside 08.30-18.30');
    assert.equal(isBotActive(at('2026-10-19T12:00:00Z'), day), false, '19.00: outside');
    assert.equal(isBotActive(at('2026-10-18T23:00:00Z'), day), false, '06.00: outside');

    const night = { ...day, activeFrom: '17:30', activeUntil: '07:30' };
    assert.equal(isBotActive(at('2026-10-19T12:00:00Z'), night), true, '19.00: night guard');
    assert.equal(isBotActive(at('2026-10-19T02:00:00Z'), night), false, '09.00: CS hours');

    assert.equal(inWindow(600, '10:00', '10:00'), true, 'same start and end = all day');
});

test('the size list may come days later: "nanti saya kabari" keeps the question open (2026-10-19)', () => {
    updateProduct('kemeja', { questions: [...SEED_QUESTIONS.kemeja, SIZE_QUESTION] });
    let conv = { step: 'awaiting_detail', product: 'kemeja', quantity: '50 pcs', detail_index: 1, details: JSON.stringify([{ q: 'jenis', a: 'PDH' }]) };

    for (const text of ['Siap kak, nanti saya kabari ya', 'ukuran campur, masih dikumpulkan dulu', 'listnya menyusul kak']) {
        const r = step(conv, text);
        assert.deepEqual(texts(r.actions), [replies.detailLater()], text);
        assert.equal(r.conv.step, 'awaiting_detail', `${text}: not closed`);
        assert.equal(r.conv.details, conv.details, `${text}: not taken as the answer`);
        assert.ok(!r.conv.misses, `${text}: not a miss`);
    }

    // Days later the list arrives: now the order goes to CS.
    const r = step(conv, 'S 10, M 20, L 20');
    assert.equal(r.conv.step, 'handed_over');
    assert.match(r.conv.details, /S 10, M 20, L 20/);
    // A list with numbers and "sisanya nanti" is an answer.
    assert.equal(step(conv, 'M 20, sisanya nanti saya kabari').conv.step, 'handed_over');
});

test('a conversation waiting for the size list is not reset after a day; detailWaitDays is editable', async () => {
    const { config } = await import('../src/config.js');
    const { updateSettings } = await import('../src/settings.js');
    run('DELETE FROM conversations');
    store.saveConversation('utama', 'w@s.whatsapp.net', { step: 'awaiting_detail', product: 'kemeja', detail_index: 1 });
    store.saveConversation('utama', 'x@s.whatsapp.net', { step: 'awaiting_quantity', product: 'kemeja' });
    const days = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

    assert.equal(store.loadConversation('utama', 'w@s.whatsapp.net', days(5)).step, 'awaiting_detail');
    assert.equal(store.loadConversation('utama', 'x@s.whatsapp.net', days(2)).step, 'new', 'other steps still reset after resetHours');
    assert.equal(store.loadConversation('utama', 'w@s.whatsapp.net', days(15)).step, 'new', 'default 14 days');

    const before = config.bot.detailWaitDays;
    updateSettings({ detailWaitDays: '3' });
    assert.equal(store.loadConversation('utama', 'w@s.whatsapp.net', days(4)).step, 'new');
    assert.throws(() => updateSettings({ detailWaitDays: '0' }));
    updateSettings({ detailWaitDays: String(before) });
});

test('the console says the active hours in words, day or night window', async () => {
    const { describeHours } = await import('../src/bot/schedule.js');
    assert.match(describeHours('17:30', '07:30'), /besok paginya/);
    assert.match(describeHours('08:30', '18:30'), /siang/);
    assert.match(describeHours('10:00', '10:00'), /24 jam setiap hari/);
});

test('sizes are asked last: [4], the product question, [5] how many, then sizes, then CS (2026-10-19)', () => {
    updateProduct('kaos', { questions: [...SEED_QUESTIONS.kaos, SIZE_QUESTION], sizeChart: true });

    let r = step({ step: 'awaiting_product' }, 'mau bikin kaos');
    assert.deepEqual(texts(r.actions), [replies.askDesign('Kaos')]);
    r = step(r.conv, 'sablon logo di depan');
    assert.deepEqual(texts(r.actions), [SEED_QUESTIONS.kaos[0]], 'the product question before [5]');
    r = step(r.conv, 'lengan pendek, sablon depan');
    assert.deepEqual(texts(r.actions), [replies.askQuantity()], '[5] just before the sizes');
    r = step(r.conv, 'belum tahu kak');
    assert.deepEqual(texts(r.actions), [SIZE_QUESTION], 'sizes last');
    r = step(r.conv, 'S 10, M 20');
    assert.equal(r.conv.step, 'handed_over', 'then [7] + [8], [5] is not asked twice');

    // The amount known from the start: [5] is skipped, the sizes are still last.
    r = step({ step: 'awaiting_product' }, 'mau bikin kaos 50 pcs');
    r = step(r.conv, 'sablon logo di depan');
    r = step(r.conv, 'lengan pendek');
    assert.deepEqual(texts(r.actions), [SIZE_QUESTION]);

    updateProduct('kaos', { questions: [] });
});

test('a name said again or corrected mid-chat is kept, never a miss (2026-10-19, "Ku Haikal Loh")', () => {
    for (const [text, name] of [['nama ku haikal', 'Haikal'], ['aku haikal loh', 'Haikal'], ['eh salah, nama saya Haikal', 'Haikal'], ['panggil aja Haikal', 'Haikal']]) {
        const c = classifyWithRules({ text, step: 'awaiting_product' });
        assert.equal(c.intent, 'introduction', text);
        assert.equal(c.name, name, text);
    }

    // Already introduced, at the product question: three corrections in a row stay with the bot.
    let conv = { step: 'awaiting_product', name: 'Budi', origin: 'Jogja' };
    for (const text of ['aku haikal loh', 'nama ku haikal', 'eh salah, nama saya Haikal']) {
        const r = step(conv, text);
        assert.deepEqual(texts(r.actions), [replies.afterIntro('Haikal')], text);
        assert.equal(r.conv.name, 'Haikal');
        assert.equal(r.conv.origin, 'Jogja', 'the origin said before is kept');
        assert.ok(!r.conv.misses, `${text}: not a miss`);
        conv = r.conv;
    }

    // Mid-order: the name changes, the flow waits at its question.
    const r = step({ step: 'awaiting_design', product: 'kaos', name: 'Budi' }, 'eh salah, nama saya Haikal');
    assert.deepEqual(texts(r.actions), [replies.introAgain('Haikal')]);
    assert.equal(r.conv.step, 'awaiting_design');
    assert.equal(r.conv.name, 'Haikal');
});

test('statuses, channels and groups are not decrypted at all (status@broadcast "No session found", 2026-10-19)', async () => {
    const { ignoredJid } = await import('../src/session.js');
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../src/session.js', import.meta.url), 'utf8');
    assert.match(source, /shouldIgnoreJid:\s*\(jid\) => ignoredJid\(jid\)/);

    for (const jid of ['status@broadcast', '12345@broadcast', '120363@newsletter', '120363-1@g.us']) assert.equal(ignoredJid(jid), true, jid);
    // Customers, our own LID, the self-chat test: read as always.
    for (const jid of ['6281234567890@s.whatsapp.net', '247768274698362@lid', '@s.whatsapp.net']) assert.equal(ignoredJid(jid), false, jid);
});

test('"Stream Errored (conflict)": the bot stops instead of fighting the other program for the number (2026-10-19)', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../src/session.js', import.meta.url), 'utf8');
    const close = source.slice(source.indexOf("if (connection === 'close')"), source.indexOf('async #onMessages'));

    // 440 is checked before the reconnect, and returns without scheduling one.
    const replaced = close.indexOf('DisconnectReason.connectionReplaced');
    assert.ok(replaced > 0 && replaced < close.indexOf('reconnectTimer'), 'conflict handled before reconnecting');
    assert.match(close.slice(replaced, close.indexOf('reconnectTimer')), /setState\('replaced'[\s\S]*?return;/);

    const html = fs.readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');
    assert.match(html, /main\.state === 'replaced'/, 'the console explains it and offers a fresh scan');
});

test('"Jas almet bahan apa ya?" the AI does not know: noted for CS, then the flow; no CS offer next to [4] (2026-10-19)', () => {
    const conv = { step: 'awaiting_product', name: 'Haikal' };
    const c = classifyWithRules({ text: 'Jas almet bahan apa ya?', step: conv.step });
    const r = step(conv, 'Jas almet bahan apa ya?', { ...c, aiAnswer: { type: 'unknown' } });

    assert.deepEqual(texts(r.actions), [replies.csQuestion(), replies.askDesign('Jas Almamater')]);
    assert.ok(!r.conv.offered_cs, 'no "mau dioper ke CS?" while the flow goes on');
    assert.match(r.conv.notes, /bahan apa/, 'CS sees the question in Percakapan and the morning recap');

    // Mid-order the same: noted, the step waits.
    const mid = step({ step: 'awaiting_design', product: 'kaos' }, 'sablonnya pakai apa?', { intent: 'has_reference', isQuestion: true, aiAnswer: { type: 'unknown' } });
    assert.deepEqual(texts(mid.actions), [replies.csQuestion()]);
    assert.equal(mid.conv.step, 'awaiting_design');

    // A question outside the flow still gets the offer.
    const off = step({ step: 'awaiting_product' }, 'kalian buka cabang di jakarta?', { intent: 'other', isQuestion: true, aiAnswer: { type: 'unknown' } });
    assert.deepEqual(texts(off.actions), [replies.aiUnknown()]);
    assert.equal(off.conv.offered_cs, 1);
});

test('the console is read once at boot, so it always matches the running bot ("GET /ai/scenarios (HTTP 404)", 2026-10-27)', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
    const start = source.indexOf("app.get('/', ");
    const route = source.slice(start, source.indexOf('});', start));

    assert.match(source, /const consolePage = fs\.readFileSync\(/, 'read at module load');
    assert.doesNotMatch(route, /readFileSync/, 'not read again per request');
});

test('launcher: Mulai checks for a new version first; Update installs it but does not start the bot (client, 2026-10-27)', async () => {
    const fs = await import('node:fs');
    const ps = fs.readFileSync(new URL('../scripts/launcher.ps1', import.meta.url), 'utf8');
    const body = (name) => {
        const start = ps.indexOf(`function ${name} {`);
        return ps.slice(start, ps.indexOf('\n}\n', start));
    };

    const mulai = body('Invoke-Mulai');
    assert.match(mulai, /Get-LatestVersion/, 'Mulai looks for a newer version');
    assert.match(mulai, /Install-UpdateFiles/);
    assert.ok(mulai.indexOf('Get-LatestVersion') < mulai.indexOf('Get-Health'), 'before opening a running bot');
    assert.match(mulai, /Test-DevCheckout/, 'never pulls on the developer PC');

    const update = body('Invoke-Update');
    assert.doesNotMatch(update, /-Action install|Invoke-Install|Start-ScheduledTask/, 'Update does not start the bot');
    assert.match(update, /-Action prepare/);
    assert.match(update, /klik Mulai ChatBot Prema/);

    // The files Update must never touch.
    assert.match(body('Install-UpdateFiles'), /\/XD data media logs node_modules \.git \/XF \.env/);
});

test('a customer message delivered late (bot reconnecting) is still answered; old history is skipped, and both are logged (2026-10-27)', async () => {
    const { isRecentCatchUp } = await import('../src/session.js');
    const now = Date.parse('2026-10-27T12:10:00Z');
    assert.equal(isRecentCatchUp({ messageTimestamp: now / 1000 - 60 }, now), true, 'a minute late: answered');
    assert.equal(isRecentCatchUp({ messageTimestamp: now / 1000 - 14 * 60 }, now), true);
    assert.equal(isRecentCatchUp({ messageTimestamp: now / 1000 - 3600 }, now), false, 'an hour old: history');

    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../src/session.js', import.meta.url), 'utf8');
    const branch = source.slice(source.indexOf("} else if (type !== 'notify') {"), source.indexOf('// What came with (or instead of) words'));
    assert.match(branch, /isRecentCatchUp\(message\)/);
    assert.match(branch, /pesan lama dari sinkronisasi dilewati/, 'never dropped without a trace');
});

test('no history sync: Baileys never holds customer messages back waiting for it (a week of silence, 2026-10-27)', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../src/session.js', import.meta.url), 'utf8');
    assert.match(source, /shouldSyncHistoryMessage:\s*\(\)\s*=>\s*false/);

    // What that option does in the pinned Baileys: no history sync means Online and flush at once.
    const chats = fs.readFileSync(new URL('../node_modules/baileys/lib/Socket/chats.js', import.meta.url), 'utf8');
    assert.match(chats, /if \(!willSyncHistory\) \{[\s\S]{0,200}syncState = SyncState\.Online;[\s\S]{0,60}ev\.flush\(\)/, 'Baileys 6.7.24 behaviour this fix relies on');
});
