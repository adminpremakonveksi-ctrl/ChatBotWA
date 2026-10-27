import './setup.js';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { classifyWithRules } from '../src/bot/classify-rules.js';
import { customKeywords, removeKeyword, updateKeyword } from '../src/bot/keywords.js';
import { activePatterns, deletePattern, listPatterns, missingBuiltins, resetPattern, restoreBuiltin, updatePattern } from '../src/bot/patterns.js';
import { createProduct, deleteProduct, listProducts, productKeywords, updateProduct } from '../src/bot/products.js';
import { createMedia } from '../src/bot/media.js';
import { migrationIds, runMigrations } from '../src/migrations.js';
import { SEED_NEW_PRODUCTS, SEED_PATTERNS, SEED_PRODUCTS } from '../src/seeds.js';
import { PREMA_NEW_PRODUCTS } from '../src/seeds-prema.js';
import { seedText } from './helpers.js';

const c = (text, step = 'awaiting_product') => classifyWithRules({ text, step });

test('a fresh install is seeded: products, keywords, answer patterns, examples', () => {
    assert.equal(listProducts().length, SEED_PRODUCTS.length + SEED_NEW_PRODUCTS.length + PREMA_NEW_PRODUCTS.length);
    assert.ok(customKeywords().filter((k) => k.source === 'bawaan').length > 200);
    assert.deepEqual(activePatterns().filter((p) => p.builtin).map((p) => p.name).sort(), ['Lokasi', 'Minimal order', 'Pengiriman', 'Ragu / takut ditipu']);

    // Examples so "Latih bot" is not empty, and they work.
    assert.equal(c('ada contoh foto?').intent, 'design_reference');
    assert.equal(c('mau bikin kaos kelas').product, 'kaos');
    assert.equal(c('bisa pakai rekber ga kak').pattern.name, 'Ragu / takut ditipu');
    assert.equal(c('jam buka nya kapan').pattern.name, 'Lokasi');
});

test('keywords are stored the way messages are compared, so shorthand matches', () => {
    // The seed list had "blm ada"; it is stored as "belum ada" and matches both spellings.
    assert.ok(customKeywords().some((k) => k.phrase === 'belum ada' && k.intent === 'no_reference'));
    assert.ok(!customKeywords().some((k) => k.phrase === 'blm ada'));
    assert.equal(c('blm ada kak', 'awaiting_design').intent, 'no_reference');
    assert.equal(c('ga ada kak', 'awaiting_design').intent, 'no_reference');
});

test('built-in keywords can be edited and deleted like the team ones', () => {
    // A multi-word phrase with no look-alike in the list (single words also match typos of each other).
    const kw = customKeywords().find((k) => k.phrase === 'hasil produksi');
    assert.equal(kw.source, 'bawaan');
    assert.equal(c('boleh lihat hasil produksi').intent, 'design_reference');

    updateKeyword(kw.id, { phrase: 'karya prema' });
    assert.notEqual(c('boleh lihat hasil produksi').intent, 'design_reference');
    assert.equal(c('boleh lihat karya prema').intent, 'design_reference');

    removeKeyword(kw.id);
    assert.notEqual(c('boleh lihat karya prema').intent, 'design_reference');
});

test('products: add, edit, and delete (jersey included)', () => {
    const { product } = createProduct({ name: 'Kaos Polo Anak', catalog: false, sizeChart: true, keywords: 'polo anak, kaos anak' });
    assert.equal(product.key, 'kaos-polo-anak');
    assert.equal(c('mau bikin polo anak').product, 'kaos-polo-anak');

    const media = createMedia(fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-prod-')));
    assert.ok(media.slots().some((s) => s.id === 'size-chart:kaos-polo-anak:reguler'), 'gets its Media slot');

    const { taken } = updateProduct('kaos-polo-anak', { name: 'Polo Anak', keywords: 'polo anak\njersey' });
    assert.equal(listProducts().find((p) => p.key === 'kaos-polo-anak').name, 'Polo Anak');
    assert.equal(taken.length, 1, '"jersey" belongs to another product and is not taken');
    assert.deepEqual(productKeywords('kaos-polo-anak'), ['polo anak']);

    // Jersey: deletable now. Its keywords go with it; the bot stops recognising it.
    assert.equal(c('mau bikin jersey').product, 'jersey');
    deleteProduct('jersey');
    assert.ok(!listProducts().some((p) => p.key === 'jersey'));
    assert.equal(c('mau bikin jersey').product, null);
    assert.ok(!media.slots().some((s) => s.id === 'katalog:jersey'), 'its Media slot is gone');

    deleteProduct('kaos-polo-anak');
});

test('seeded patterns: edit, put back to the original, delete, restore', () => {
    const lokasi = activePatterns().find((p) => p.builtin === 'location');

    updatePattern(lokasi.id, { bubbles: [{ type: 'text', text: 'Kami pindah ke Jl. Baru kak' }] });
    assert.equal(c('lokasinya dimana').pattern.bubbles[0].text, 'Kami pindah ke Jl. Baru kak');

    resetPattern(lokasi.id);
    assert.equal(c('lokasinya dimana').pattern.bubbles[0].text, seedText('location', 0));

    deletePattern(lokasi.id);
    assert.equal(c('lokasinya dimana').intent, 'other', 'deleted: CS takes the question');
    assert.deepEqual(missingBuiltins().map((m) => m.name), ['Lokasi']);

    restoreBuiltin('location');
    assert.equal(c('lokasinya dimana').pattern.name, 'Lokasi');
    assert.deepEqual(missingBuiltins(), []);
});

test('upgrading an existing client database keeps everything the team changed', () => {
    // A database as an earlier version left it: no products table, keywords without
    // "source", an edited location template, keywords taught to old built-in answers.
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-old-')), 'old.sqlite');
    const old = new Database(file);
    old.exec(`
        CREATE TABLE settings ("key" TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
        CREATE TABLE custom_keywords (id INTEGER PRIMARY KEY AUTOINCREMENT, phrase TEXT NOT NULL UNIQUE, intent TEXT NOT NULL, product TEXT, created_at TEXT);
        CREATE TABLE patterns (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, keywords TEXT NOT NULL DEFAULT '[]', bubbles TEXT NOT NULL DEFAULT '[]', after TEXT NOT NULL DEFAULT 'stay', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT);
        INSERT INTO settings VALUES ('keywords:seeded', 'x', 'x');
        INSERT INTO settings VALUES ('reply:location', 'Toko kami di Jl. Pahlawan 9 kak', 'x');
        INSERT INTO settings VALUES ('reply:locationMap', 'https://maps.app.goo.gl/baru', 'x');
        INSERT INTO custom_keywords (phrase, intent) VALUES ('rekber', 'trust'), ('patokan toko', 'location'), ('blm kepikiran desain', 'no_reference');
        INSERT INTO custom_keywords (phrase, intent, product) VALUES ('baju panitia', 'product', 'kaos');
        INSERT INTO patterns (name, keywords, bubbles) VALUES ('Ukuran', '["ukuran"]', '[{"type":"text","text":"cek size ya"}]');
    `);

    const applied = runMigrations(old);
    assert.deepEqual(applied, migrationIds());

    const patterns = old.prepare('SELECT * FROM patterns').all();
    const lokasi = patterns.find((p) => p.builtin === 'location');
    assert.deepEqual(JSON.parse(lokasi.bubbles), [
        { type: 'text', text: 'Toko kami di Jl. Pahlawan 9 kak' },
        { type: 'link', url: 'https://maps.app.goo.gl/baru' },
    ], 'edited template carried into the pattern');
    assert.ok(JSON.parse(lokasi.keywords).includes('patokan toko'), 'taught keyword carried over');
    assert.ok(JSON.parse(patterns.find((p) => p.builtin === 'trust').keywords).includes('rekber'));
    assert.ok(patterns.some((p) => p.name === 'Ukuran' && !p.builtin), 'team pattern untouched');

    assert.equal(old.prepare(`SELECT COUNT(*) AS n FROM settings WHERE "key" LIKE 'reply:location%'`).get().n, 0, 'old template edits moved, not duplicated');
    assert.equal(old.prepare(`SELECT COUNT(*) AS n FROM custom_keywords WHERE intent IN ('trust','location')`).get().n, 0);
    assert.ok(old.prepare(`SELECT 1 FROM custom_keywords WHERE phrase = 'belum kepikiran desain'`).get(), 'old team keyword normalised');
    assert.ok(old.prepare(`SELECT 1 FROM custom_keywords WHERE phrase = 'baju panitia' AND source = 'tim'`).get(), 'team product keyword kept');
    assert.equal(old.prepare('SELECT COUNT(*) AS n FROM products').get().n, SEED_PRODUCTS.length + SEED_NEW_PRODUCTS.length + PREMA_NEW_PRODUCTS.length);
    assert.equal(old.prepare(`SELECT COUNT(*) AS n FROM custom_keywords WHERE "phrase" = 'contoh foto'`).get().n, 0, 'no fresh-install examples on an existing install');

    // Running again does nothing: each migration runs once.
    assert.deepEqual(runMigrations(old), []);
    assert.equal(old.prepare('SELECT COUNT(*) AS n FROM patterns WHERE builtin IS NOT NULL').get().n, SEED_PATTERNS.length);
    old.close();
});

test('a later seed update never brings back what the team deleted', async () => {
    const { db } = await import('../src/db.js');
    const { syncSeeds } = await import('../src/migrations.js');

    const kw = customKeywords().find((k) => k.phrase === 'mau tanya' && k.source === 'bawaan');
    removeKeyword(kw.id);

    const lokasi = activePatterns().find((p) => p.builtin === 'location');
    updatePattern(lokasi.id, { keywords: lokasi.keywords.filter((k) => k !== 'patokan') });

    syncSeeds(db, '005_smarter_seeds');
    const { forgetKeywords } = await import('../src/bot/keywords.js');
    forgetKeywords();

    assert.ok(!customKeywords().some((k) => k.phrase === 'mau tanya'), 'deleted keyword stays deleted');
    assert.ok(!listPatterns().find((p) => p.builtin === 'location').keywords.includes('patokan'), 'removed pattern keyword stays removed');

    // "Kembalikan ke bawaan" is explicit: the original keywords come back.
    resetPattern(lokasi.id);
    assert.ok(listPatterns().find((p) => p.builtin === 'location').keywords.includes('patokan'));
});
