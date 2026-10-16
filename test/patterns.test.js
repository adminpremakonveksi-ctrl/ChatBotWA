import './setup.js';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Bot } from '../src/bot/bot.js';
import { syncCatalog } from '../src/bot/catalog.js';
import { classifyWithRules } from '../src/bot/classify-rules.js';
import { decide } from '../src/bot/engine.js';
import { createMedia } from '../src/bot/media.js';
import { addPatternKeyword, createPattern, deletePattern, listPatterns, updatePattern } from '../src/bot/patterns.js';
import { replies } from '../src/bot/replies.js';
import { run } from '../src/db.js';

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const c = (text, step = 'awaiting_product') => classifyWithRules({ text, step });
// Team patterns only: the seeded ones (Lokasi, ...) stay, as on a real install.
const clean = () => { for (const p of listPatterns().filter((x) => !x.builtin)) deletePattern(p.id); };

function ukuran(extra = {}) {
    const p = createPattern('Ukuran');

    return updatePattern(p.id, {
        keywords: 'ukuran\nsize\nlingkar dada',
        bubbles: [{ type: 'text', text: 'Siap Kak {nama}, ini panduan ukuran dari {bot} ya 👇' }, { type: 'photos' }, { type: 'link', url: 'https://wa.me/c/6281999911895' }],
        ...extra,
    });
}

test('a team pattern is recognised by its keywords, typos included, before built-in answers', () => {
    clean();
    ukuran();

    assert.equal(c('ukurannya apa aja kak').intent, 'custom');
    assert.equal(c('ukurannya apa aja kak').pattern.name, 'Ukuran');
    assert.equal(c('sizenya gmn').intent, 'custom', 'beats the built-in size chart answer');
    assert.equal(c('lingkar dadanya berapa').intent, 'custom');
    assert.equal(c('lokasinya dimana').pattern.name, 'Lokasi', 'other questions untouched');
});

test('a pattern needs a keyword, an answer and to be switched on', () => {
    clean();
    const p = createPattern('Kosong');
    assert.notEqual(c('kosong').intent, 'custom', 'no keywords, no answer');

    updatePattern(p.id, { keywords: 'cara bayar', bubbles: [{ type: 'text', text: 'Bisa transfer kak' }], enabled: false });
    assert.notEqual(c('cara bayarnya gimana').intent, 'custom', 'switched off');

    updatePattern(p.id, { enabled: true });
    assert.equal(c('cara bayarnya gimana').intent, 'custom');
});

test('the answer goes out bubble by bubble in the team order, and the conversation stays put', () => {
    clean();
    const p = ukuran();
    const m = createMedia(fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-pola-')));
    m.savePattern(p.id, JPG);
    m.savePattern(p.id, JPG);

    const { actions, patch } = decide({ step: 'awaiting_design', name: 'Budi', product: 'kaos' }, c('ukurannya ada apa aja', 'awaiting_design'), m);

    assert.deepEqual(actions.map((a) => a.type === 'text' ? a.text : `${a.type}:${a.kind}`), [
        'Siap Kak Budi, ini panduan ukuran dari Mawar ya 👇',
        'media:pola',
        'https://wa.me/c/6281999911895',
    ]);
    assert.equal(m.files('pola', String(p.id)).length, 2);
    assert.equal(patch.step, undefined, 'still waiting for the design answer');
});

test('"Serahkan ke CS" hands over after the answer; an unknown name leaves no gap', () => {
    clean();
    const p = ukuran({ after: 'handover' });
    const m = createMedia(fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-pola-')));

    const { actions, patch } = decide({ step: 'awaiting_product' }, c('size chart ada?'), m);

    assert.equal(actions[0].text, 'Siap Kak, ini panduan ukuran dari Mawar ya 👇');
    assert.equal(actions.at(-1).type, 'handover');
    assert.equal(patch.step, 'handed_over');
    assert.ok(!actions.some((a) => a.type === 'media'), 'no photos uploaded, no photo bubble');
    deletePattern(p.id);
});

test('catalog bubbles send the chosen WhatsApp catalog items as product links', async () => {
    clean();
    await syncCatalog({ user: { id: '6281999911895:1@s.whatsapp.net' }, getCatalog: async () => ({ products: [{ id: '501', name: 'Jersey Basket', description: '' }, { id: '502', name: 'Bahan Jersey', description: '' }] }) });
    const p = createPattern('Bahan');
    updatePattern(p.id, { keywords: 'bahan', bubbles: [{ type: 'text', text: 'Ini pilihan bahannya kak' }, { type: 'catalog', items: ['502', '999'] }] });
    const m = createMedia(fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-pola-')));

    const { actions } = decide({ step: 'awaiting_product' }, c('bahannya apa aja'), m);
    assert.deepEqual(actions.map((a) => a.text), ['Ini pilihan bahannya kak', 'https://wa.me/p/502/6281999911895'], 'item 999 no longer in the catalog: skipped');
});

test('Latih bot can teach a phrase straight into a pattern', () => {
    clean();
    const p = ukuran();
    assert.notEqual(c('kegedean ga ya kak').intent, 'custom');

    addPatternKeyword(p.id, 'Kegedean');
    assert.equal(c('kegedean ga ya kak').intent, 'custom');
});

test('bad patterns are refused', () => {
    clean();
    const p = createPattern('X');
    assert.throws(() => updatePattern(p.id, { bubbles: [{ type: 'text', text: 'Halo {pelanggan}' }] }), /tidak dikenal/);
    assert.throws(() => updatePattern(p.id, { bubbles: [{ type: 'link', url: 'javascript:alert(1)' }] }), /https/);
    assert.throws(() => updatePattern(p.id, { bubbles: [{ type: 'catalog', items: [] }] }), /minimal satu/);
    assert.throws(() => updatePattern(p.id, { name: '  ' }), /wajib/);
});

test('the real bot sends a pattern answer and labels it in the stats', async () => {
    clean();
    ukuran();
    const m = createMedia(fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-pola-')));
    const sent = [];
    const bot = new Bot({ classify: async (input) => classifyWithRules(input), media: m, isActive: () => true, debounceMs: 5 });
    const wa = { newMessageId: () => `P${sent.length}`, send: async (jid, action) => sent.push(action) };

    run('DELETE FROM conversations');
    run('DELETE FROM message_log');
    bot.onIncoming('utama', wa, { jid: '6287777@s.whatsapp.net', id: 'p1', text: 'halo kak saya Sinta dari Kutoarjo, ukurannya ada apa aja?' });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();

    assert.deepEqual(sent.map((a) => a.text), [replies.greetKnown('Sinta'), 'Siap Kak Sinta, ini panduan ukuran dari Mawar ya 👇', 'https://wa.me/c/6281999911895']);

    const { intent } = (await import('../src/db.js')).get(`SELECT intent FROM message_log WHERE direction = 'in'`);
    assert.equal(intent, 'pola: Ukuran');
});
