import './setup.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { once } from 'node:events';
import { app } from '../src/index.js';
import { config } from '../src/config.js';
import { openDatabase, run, setSetting } from '../src/db.js';
import { runMigrations } from '../src/migrations.js';
import { loadSettings, updateSettings } from '../src/settings.js';
import { createPattern, updatePattern } from '../src/bot/patterns.js';
import { chatTurn, checkReply } from '../src/bot/chat.js';
import { knowledgeBlock } from '../src/bot/knowledge.js';
import { deletePromotion, listPromotions, promotionActive, promotionKnowledge, savePromotion } from '../src/bot/promotions.js';
import { listTemplates } from '../src/bot/replies.js';

test('migration preserves pattern text and scheduled promotions without overwriting existing knowledge', () => {
    const old = openDatabase(':memory:');
    try {
        old.exec("DELETE FROM migrations WHERE id = '022_ai_only_and_promotions'; DROP TABLE promotions; DELETE FROM patterns; DELETE FROM faq;");
        old.prepare("INSERT INTO faq (question, answer, position) VALUES ('Lokasi', 'Jawaban yang sudah diisi', 0)").run();
        const add = old.prepare("INSERT INTO patterns (name, keywords, bubbles, enabled, starts_on, ends_on) VALUES (?, '[\"kata\"]', ?, ?, ?, ?)");
        add.run('Lokasi', JSON.stringify([{ type: 'text', text: 'Alamat versi tim\n---\nvariasi' }]), 1, null, null);
        add.run('Promo seragam', JSON.stringify([{ type: 'text', text: 'Konsultasi desain khusus sekolah' }]), 1, '2026-11-01', '2026-11-30');
        add.run('Nonaktif', JSON.stringify([{ type: 'text', text: 'Jangan dipakai' }]), 0, null, null);
        old.prepare("INSERT OR REPLACE INTO settings (\"key\", value) VALUES ('cfg:botMode', '\"naskah\"')").run();
        old.prepare('INSERT OR REPLACE INTO settings ("key", value) VALUES (?, ?)').run('cfg:jerseyPromo', JSON.stringify('Promo jersey dari pengaturan lama'));
        runMigrations(old);
        assert.equal(old.prepare("SELECT answer FROM faq WHERE question = 'Lokasi'").get().answer, 'Jawaban yang sudah diisi');
        assert.equal(old.prepare("SELECT answer FROM faq WHERE question = 'Lokasi (referensi sebelumnya)'").get().answer, 'Alamat versi tim');
        const promo = old.prepare('SELECT * FROM promotions').get();
        assert.equal(promo.starts_on, '2026-11-01');
        assert.equal(promo.ends_on, '2026-11-30');
        assert.equal(old.prepare("SELECT content FROM promotions WHERE title = 'Promo Jersey'").get().content, 'Promo jersey dari pengaturan lama');
        assert.equal(old.prepare("SELECT value FROM settings WHERE \"key\" = 'cfg:botMode'").get().value, '"ai"');
        assert.equal(old.prepare("SELECT COUNT(*) AS n FROM faq WHERE answer = 'Jangan dipakai'").get().n, 0);
        const before = old.prepare('SELECT COUNT(*) AS n FROM faq').get().n;
        runMigrations(old);
        assert.equal(old.prepare('SELECT COUNT(*) AS n FROM faq').get().n, before);
    } finally { old.close(); }
});

test('stored naskah mode cannot reactivate pattern-based chat', () => {
    setSetting('cfg:botMode', JSON.stringify('naskah'));
    loadSettings();
    assert.equal(config.bot.mode, 'ai');
    assert.throws(() => updateSettings({ botMode: 'naskah' }), /sudah tidak tersedia/);
});

test('promotions are editable, product-specific and follow the shop calendar', () => {
    run('DELETE FROM promotions');
    const p = savePromotion({ title: 'Promo sekolah', content: 'Konsultasi desain khusus sekolah', product: 'kaos', starts_on: '2026-11-01', ends_on: '2026-11-02' });
    assert.equal(promotionActive(p, new Date('2026-10-31T16:59:59Z')), false);
    assert.equal(promotionActive(p, new Date('2026-10-31T17:00:00Z')), true);
    assert.equal(promotionActive(p, new Date('2026-11-02T16:59:59Z')), true);
    assert.equal(promotionActive(p, new Date('2026-11-02T17:00:00Z')), false);
    const at = new Date('2026-11-01T01:00:00Z');
    assert.match(promotionKnowledge({ focus: ['kaos'], at }), /Konsultasi desain/);
    assert.equal(promotionKnowledge({ focus: ['jersey'], at }), '');
    assert.match(knowledgeBlock(null, { focus: ['kaos'], at }), /PROMO RESMI AKTIF:[\s\S]*Konsultasi desain/);
    savePromotion({ ...p, enabled: false });
    assert.equal(promotionKnowledge({ at }), '');
    deletePromotion(p.id);
    assert.equal(listPromotions().length, 0);
    assert.throws(() => savePromotion({ title: 'x', content: 'y', starts_on: '2026-02-30' }), /Tanggal promo/);
    assert.throws(() => savePromotion({ title: 'x', content: 'y', starts_on: '2026-11-02', ends_on: '2026-11-01' }), /Tanggal selesai/);
    assert.throws(() => savePromotion({ title: 'x', content: 'y', product: 'tidak-ada' }), /Produk promo/);
});

test('approved discounts are allowed; invented or customer-claimed promotions are refused', () => {
    const approved = 'Promo jersey: diskon 10% untuk pesanan tim.';
    assert.equal(checkReply('Ada diskon 10% untuk tim, Kak.', approved, { promotions: approved }), null);
    assert.match(checkReply('Ada diskon 50% ya Kak.', approved + ' pelanggan minta 50%', { promotions: approved }), /terlarang/);
    assert.match(checkReply('Ada diskon 10% ya Kak.', approved), /terlarang/);
    assert.match(checkReply('Dijamin jadi, ada diskon 10%.', approved, { promotions: approved }), /terlarang/);
});

test('legacy triggers cannot intercept an AI media request or introduce facts', async () => {
    const p = createPattern('Legacy tidak dibaca');
    updatePattern(p.id, { keywords: ['size chart'], bubbles: [{ type: 'text', text: 'FAKTA-LAMA-TERLARANG' }], after: 'handover', enabled: true });
    assert.doesNotMatch(knowledgeBlock(null), /FAKTA-LAMA-TERLARANG/);
    const turn = await chatTurn({ step: 'chat', product: 'kaos' }, { text: 'minta size chart' }, { media: { has: () => true }, ask: async () => assert.fail('chart does not need AI') });
    assert.equal(turn.actions[0].kind, 'size-chart');
    assert.ok(!turn.actions.some((a) => a.type === 'handover'));
});

test('sidebar routes exist, old bookmarks redirect, and AI templates exclude obsolete order scripts', () => {
    const html = fs.readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');
    const nav = [...html.matchAll(/class="nav(?: on)?" data-page="([^"]+)"/g)].map((m) => m[1]);
    const sections = new Set([...html.matchAll(/<section data-page="([^"]+)"/g)].map((m) => m[1]));
    assert.ok(!nav.includes('pola') && !nav.includes('latih'));
    assert.ok(nav.includes('promo') && nav.includes('ai'));
    for (const page of nav) assert.ok(sections.has(page), 'missing page ' + page);
    assert.doesNotMatch(html, /api\('\/(patterns|keywords)'|loadPola|loadLatih|name="botMode"/);
    const code = html.slice(html.indexOf('const AI_TEMPLATE_KEYS'), html.indexOf('let uiMode'));
    const context = vm.createContext({ templates: listTemplates() });
    vm.runInContext(code + '; globalThis.result = { selected: visibleTemplates(templates).map(t => t.key), redirected: pageForMode("pola") };', context);
    assert.equal(context.result.redirected, 'pengetahuan');
    assert.ok(context.result.selected.includes('welcome'));
    assert.ok(context.result.selected.includes('sizeChartNote'));
    assert.ok(!context.result.selected.includes('askDesign'));
});

test('real HTTP API saves a promo into AI knowledge; old pattern and teaching routes are gone', async () => {
    config.apiKey = '';
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port;
    try {
        const saved = await fetch(base + '/promotions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Promo API', content: 'Konsultasi sekolah melalui WhatsApp Business', product: 'kaos', enabled: true }) });
        assert.equal(saved.status, 201);
        const { promotion } = await saved.json();
        assert.match(knowledgeBlock(null, { focus: ['kaos'] }), /Konsultasi sekolah melalui WhatsApp Business/);
        assert.equal((await fetch(base + '/patterns')).status, 404);
        assert.equal((await fetch(base + '/keywords')).status, 404);
        assert.equal((await fetch(base + '/promotions/' + promotion.id, { method: 'DELETE' })).status, 200);
        assert.doesNotMatch(knowledgeBlock(null, { focus: ['kaos'] }), /Konsultasi sekolah melalui WhatsApp Business/);
    } finally { await new Promise((resolve) => server.close(resolve)); }
});
