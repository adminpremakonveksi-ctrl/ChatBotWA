import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWithRules } from '../src/bot/classify-rules.js';
import { normalise, squashWord } from '../src/text.js';

/**
 * People do not type clean messages: stretched letters, "dong", "sih",
 * "hehe", emoji, "eh" in front. The same message with these extras must
 * mean what the clean one means (2026-10-19: "ok makasih sih" was not
 * understood, "sayaa Budi" was the name "Sayaa Budi", "Budi, Magelang 🙏"
 * was no introduction at all).
 */

const key = (r) => `${r.intent}|${r.product ?? ''}|${(r.name ?? '').toLowerCase()}`;
const same = (step, clean, noisy) => {
    const want = key(classifyWithRules({ text: clean, step }));
    for (const text of noisy) assert.equal(key(classifyWithRules({ text, step })), want, `"${text}" should read like "${clean}"`);
};

test('stretched words are read as typed clean', () => {
    assert.equal(squashWord('sayaa'), 'saya');
    assert.equal(squashWord('okk'), 'ok');
    assert.equal(squashWord('kakkk'), 'kak');
    assert.equal(squashWord('wkwkwk'), 'wkwk');
    assert.equal(squashWord('hahaha'), 'haha');
    // Doubles inside a word stay ("maaf", "saat"), and two-letter words ("aa").
    for (const word of ['maaf', 'saat', 'tunggu', 'aa']) assert.equal(squashWord(word), word);
    // Keywords go through the same rule: "all size" still meets "all size".
    assert.equal(normalise('ukuran all size').trim(), normalise('ukuran alll size').trim());
    assert.equal(normalise('mau ngobrol samaa adminn dong').trim(), normalise('mau ngobrol sama admin dong').trim());
});

test('introductions with extras, emoji and stretched letters', () => {
    same('awaiting_intro', 'saya Budi dari Jogja', ['sayaa Budi dari Jogjaa', 'eh saya Budi dari Jogja kak hehe', 'saya Budi dari Jogja 🙏']);
    same('awaiting_intro', 'Budi, Magelang', ['Budi, Magelang 🙏', 'eh Budi, Magelang dong', 'permisi kak, Budi, Magelang', 'Budi, Magelang kak 🙏🙏']);
});

test('greetings, thanks and requests with the chat\'s extras', () => {
    same('awaiting_product', 'halo selamat malam', ['halo selamat malam dong', 'eh halo selamat malam ya kak hehe', 'oh iya halo selamat malam']);
    same('awaiting_product', 'ok makasih', ['ok makasih sih', 'okk makasih deh', 'ok makasih kak wkwkwk', 'ok makasih 🙏']);
    same('awaiting_product', 'mau ngobrol sama admin', ['mau ngobrol samaa admin dong', 'btw mau ngobrol sama admin kak']);
    same('awaiting_product', 'mau bikin kaos', ['mau bikin kaos dong kak', 'hmm mau bikin kaos sih hehe', 'mauu bikin kaoss']);
});
