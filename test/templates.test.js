import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { decide } from '../src/bot/engine.js';
import { TEMPLATES, listTemplates, replies, resetTemplate, updateTemplate } from '../src/bot/replies.js';

const media = { has: () => false };

test('defaults are the client spec, word for word', () => {
    assert.match(replies.greetKnown('Budi'), /^Halo Kak Budi, terima kasih sudah menghubungi Prema Konveksi\. Sembari menunggu CS Anggun online, izinkan saya Mawar selaku AI Agent/);
    assert.equal(listTemplates().filter((t) => t.changed).length, 0);
    assert.equal(Object.keys(TEMPLATES).length, listTemplates().length);
});

test('a team edit is used at once, with placeholders filled in', () => {
    try {
        updateTemplate('greetKnown', 'Malam Kak {nama}! Saya {bot}, menemani sampai CS {cs} datang 🌙');

        assert.equal(replies.greetKnown('Rina'), 'Malam Kak Rina! Saya Mawar, menemani sampai CS Anggun datang 🌙');
        assert.ok(listTemplates().find((t) => t.key === 'greetKnown').changed);

        const { actions } = decide({}, { intent: 'greeting', name: 'Rina', extras: [] }, media);
        assert.equal(actions[0].text, 'Malam Kak Rina! Saya Mawar, menemani sampai CS Anggun datang 🌙');
    } finally {
        resetTemplate('greetKnown');
    }

    assert.match(replies.greetKnown('Rina'), /^Halo Kak Rina, terima kasih/);
});

test('templates that cannot be filled in are refused', () => {
    assert.throws(() => updateTemplate('greetUnknown', 'Halo Kak {nama}'), /\{nama\} tidak bisa dipakai di sini/);
    assert.throws(() => updateTemplate('waitForCs', '   '), /tidak boleh kosong/);
    assert.throws(() => updateTemplate('tidakAda', 'x'), /tidak dikenal/);
});

test('the jersey promo [9] is optional: empty skips it, text sends it', () => {
    assert.equal(replies.jerseyPromo(), null);

    try {
        updateTemplate('jerseyPromo', 'Promo jersey bulan ini kak! *Gratis nomor punggung*');
        assert.equal(replies.jerseyPromo(), 'Promo jersey bulan ini kak! *Gratis nomor punggung*');

        updateTemplate('jerseyPromo', '');
        assert.equal(replies.jerseyPromo(), null);
    } finally {
        resetTemplate('jerseyPromo');
    }
});
