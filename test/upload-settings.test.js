import './setup.js';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { decide } from '../src/bot/engine.js';
import { createMedia, sniffType } from '../src/bot/media.js';
import { config } from '../src/config.js';
import { currentSettings, normalisePhone, updateSettings } from '../src/settings.js';

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const PDF = Buffer.from('%PDF-1.7\n' + 'x'.repeat(20));
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(30)]);

const fresh = () => createMedia(fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-upload-')));

test('file type comes from the bytes, not the name', () => {
    assert.equal(sniffType(JPG), '.jpg');
    assert.equal(sniffType(PNG), '.png');
    assert.equal(sniffType(PDF), '.pdf');
    assert.equal(sniffType(EXE), null);
});

test('catalogs gain pages; the first single file moves into a folder', () => {
    const m = fresh();

    m.save('katalog:jersey', PDF);
    m.save('katalog:jersey', JPG);
    m.save('katalog:jersey', PNG);

    assert.deepEqual(m.files('katalog', 'jersey').map((f) => path.basename(f)), ['01.pdf', '02.jpg', '03.png']);
    assert.equal(m.slots().find((s) => s.id === 'katalog:jersey').files.length, 3);
});

test('size charts are replaced, whatever the old format was', () => {
    const m = fresh();

    m.save('size-chart:kaos:reguler', PNG);
    m.save('size-chart:kaos:reguler', JPG);

    assert.deepEqual(m.files('size-chart', 'kaos', 'reguler').map((f) => path.basename(f)), ['kaos.jpg']);
});

test('uploads that are not images or PDF are refused', () => {
    assert.throws(() => fresh().save('katalog:jersey', EXE), /JPG, PNG, WEBP, atau PDF/);
    assert.throws(() => fresh().save('tidak-ada', JPG), /tidak dikenal/);
});

test('deleting stays inside media/, and tidies empty folders', () => {
    const m = fresh();
    m.save('katalog:jersey', JPG);
    m.save('katalog:jersey', JPG);

    const [first, second] = m.slots().find((s) => s.id === 'katalog:jersey').files;
    m.remove(first.path);
    m.remove(second.path);

    assert.equal(m.has('katalog', 'jersey'), false);
    assert.throws(() => m.remove('../../package.json'), /tidak ditemukan/);
    assert.throws(() => m.resolve('C:/Windows/win.ini'), /tidak ditemukan/);
});

test('an uploaded promo pamphlet is sent at step [9]', () => {
    const m = fresh();
    m.save('promo:jersey', JPG);

    const { actions } = decide({ step: 'awaiting_product' }, { intent: 'product', product: 'jersey', extras: [], sizeVariant: 'reguler' }, m);

    assert.deepEqual(actions.map((a) => (a.type === 'media' ? `media:${a.kind}` : a.type)), ['media:promo', 'text']);
});

test('phone numbers are accepted the way people type them', () => {
    assert.equal(normalisePhone('0812-3456-7890'), '6281234567890');
    assert.equal(normalisePhone('+62 812 3456 7890'), '6281234567890');
    assert.equal(normalisePhone('812 3456 7890'), '6281234567890');
});

test('settings apply at once, and a bad field saves nothing', () => {
    const before = currentSettings();

    try {
        const after = updateSettings({ csName: 'Sari', activeFrom: '18.00', recapTo: '0812-3456-7890, 0813 1111 2222' });

        assert.equal(config.bot.csName, 'Sari');
        assert.equal(after.activeFrom, '18:00');
        assert.deepEqual(config.recap.to, ['6281234567890', '6281311112222']);

        assert.throws(() => updateSettings({ csName: 'Dewi', activeUntil: '25:00' }), /tulis jam/);
        assert.equal(config.bot.csName, 'Sari', 'nothing applied from the rejected save');

        assert.throws(() => updateSettings({ backupDir: 'relatif/saja' }), /harus lengkap/);
        assert.throws(() => updateSettings({ recapTo: '123' }), /tidak valid/);
    } finally {
        updateSettings({ csName: before.csName, activeFrom: before.activeFrom, recapTo: before.recapTo });
    }
});
