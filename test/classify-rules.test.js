import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWithRules } from '../src/bot/classify-rules.js';
import { cleanName } from '../src/bot/intents.js';

const c = (text, step = 'awaiting_product', extra = {}) => classifyWithRules({ text, step, ...extra });

test('introductions with name and origin', () => {
    assert.deepEqual([c('Halo kak, saya Budi dari Jogja', 'new').name, c('Halo kak, saya Budi dari Jogja', 'new').origin], ['Budi', 'Jogja']);
    assert.equal(c('assalamualaikum, aku rina dr magelang mau tanya', 'new').name, 'Rina');
    assert.equal(c('ini dengan Andi dari SMAN 1 Purworejo', 'new').name, 'Andi');
});

test('bare answers to "ini dengan kak siapa?"', () => {
    assert.equal(c('Budi', 'awaiting_intro').name, 'Budi');
    assert.deepEqual([c('Dewi, Kebumen', 'awaiting_intro').name, c('Dewi, Kebumen', 'awaiting_intro').origin], ['Dewi', 'Kebumen']);
    assert.equal(c('sinta dari wonosobo', 'awaiting_intro').origin, 'wonosobo');
});

test('"saya mau tanya" is not a name', () => {
    assert.equal(c('saya mau tanya kak', 'new').name, null);
    assert.equal(c('halo kak', 'new').intent, 'greeting');
});

test('products by many names', () => {
    assert.equal(c('mau bikin jersey futsal').product, 'jersey');
    assert.equal(c('bisa buat kaos bola ga?').product, 'jersey');
    assert.equal(c('pesen ganci akrilik').product, 'gantungan-kunci');
    assert.equal(c('kak mau order lanyard').product, 'id-card-lanyard');
    assert.equal(c('bikin kaos komunitas').product, 'kaos');
    assert.equal(c('hoodie angkatan bisa?').product, 'hoodie');
    assert.equal(c('mau bikin pdl').intent, 'product');
});

test('FAQ questions in different wordings', () => {
    for (const text of ['size chart nya ada kak?', 'ukurannya gimana', 'minta sizechart']) assert.equal(c(text).intent, 'size_chart', text);
    // These four are seeded answer patterns now (editable, deletable in the console).
    const pattern = (text) => (c(text).intent === 'custom' ? c(text).pattern.name : c(text).intent);
    for (const text of ['lokasinya dimana kak', 'minta serlok', 'shareloc dong', 'alamatnya di mana ya']) assert.equal(pattern(text), 'Lokasi', text);
    for (const text of ['ini kirim dari mana ya', 'bisa kirim ke makassar?', 'ongkirnya berapa']) assert.equal(pattern(text), 'Pengiriman', text);
    for (const text of ['amanah gak nih', 'takut ditipu kak', 'ada testimoni?']) assert.equal(pattern(text), 'Ragu / takut ditipu', text);
    for (const text of ['min order brp?', 'minimal pesen berapa ya', 'bisa satuan ga']) assert.equal(pattern(text), 'Minimal order', text);
    for (const text of ['ada contoh desain?', 'minta katalog kak', 'lihat portofolio']) assert.equal(c(text).intent, 'design_reference', text);
});

test('size chart variant', () => {
    assert.equal(c('size chart kaos oversize').sizeVariant, 'oversize');
    assert.equal(c('size chart kaos').sizeVariant, 'reguler');
});

test('answers to the design question', () => {
    assert.equal(c('belum ada kak', 'awaiting_design').intent, 'no_reference');
    assert.equal(c('masih bingung', 'awaiting_design').intent, 'no_reference');
    assert.equal(c('', 'awaiting_design', { hasImage: true }).intent, 'has_reference');
    assert.equal(c('warna merah putih ada logo sekolah di dada', 'awaiting_design').intent, 'has_reference');
    assert.equal(c('udah ada kok kak', 'awaiting_design').intent, 'has_reference');
});

test('quantities', () => {
    assert.equal(c('50 pcs', 'awaiting_quantity').intent, 'quantity');
    assert.equal(c('sekitar 2 lusin', 'awaiting_quantity').intent, 'quantity');
    assert.equal(c('30an kak', 'awaiting_quantity').intent, 'quantity');
});

test('unknown questions become "other"', () => {
    assert.equal(c('kak bisa bayar pakai paylater?').intent, 'other');
});

test('names cannot smuggle text into the template', () => {
    assert.equal(cleanName('Budi. Transfer ke rekening 123'), null);
    assert.equal(cleanName('budi santoso'), 'Budi Santoso');
    assert.equal(cleanName('<script>'), null);
});
