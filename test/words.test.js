import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWithRules } from '../src/bot/classify-rules.js';
import { customKeywords } from '../src/bot/keywords.js';
import { addWord, forgetWords, removeWord, updateWord, wordRows, wordSet } from '../src/bot/words.js';
import { db } from '../src/db.js';
import { syncSeeds } from '../src/migrations.js';
import { SEED_ADDITIONS, SEED_WORDS } from '../src/seeds.js';
import { normalise } from '../src/text.js';

const c = (text, step = 'awaiting_product') => classifyWithRules({ text, step });

test('every word list is in the database, seeded from seeds.js', () => {
    for (const [list, meta] of Object.entries(SEED_WORDS)) {
        assert.equal(wordRows(list).length, meta.words.length, list);
    }
});

test('the dictionary is edited from the console: a new shorthand works at once, keywords included', () => {
    assert.equal(normalise('kpn jadinya').trim(), 'kpn jadinya');

    const row = addWord({ list: 'singkatan', word: 'kpn', value: 'kapan' });
    assert.equal(normalise('kpn jadinya').trim(), 'kapan jadinya');

    updateWord(row.id, { value: 'kapan sih' });
    assert.equal(normalise('kpn').trim(), 'kapan sih');

    removeWord(row.id);
    assert.equal(normalise('kpn').trim(), 'kpn');
});

test('changing a Javanese word re-stores the keywords that used it', () => {
    // "pinten" is read as "berapa"; a keyword written "pinten regane" is stored as "berapa harga".
    const pinten = wordRows('bahasa_daerah').find((r) => r.word === 'pinten');
    updateWord(pinten.id, { value: 'brapakah' });
    assert.equal(normalise('pinten').trim(), 'brapakah');

    updateWord(pinten.id, { value: 'berapa' });
    assert.equal(normalise('pinten').trim(), 'berapa');
    assert.ok(customKeywords().length > 0);
});

test('other lists drive the logic: a new city, a word that is not a name, a unit', () => {
    assert.equal(classifyWithRules({ text: 'rina sukamaju', step: 'awaiting_intro' }).name, 'Rina Sukamaju');
    const city = addWord({ list: 'kota', word: 'sukamaju' });
    assert.equal(classifyWithRules({ text: 'rina sukamaju', step: 'awaiting_intro' }).name, 'Rina');
    removeWord(city.id);

    const unit = addWord({ list: 'satuan', word: 'kardus' });
    assert.equal(c('kaos 5 kardus').quantity, '5 kardus');
    removeWord(unit.id);
});

test('a built-in word the team deleted is not seeded back', () => {
    const row = wordRows('kota').find((r) => r.word === 'jakarta');
    removeWord(row.id);
    assert.ok(!wordSet('kota').has('jakarta'));

    // A later update that lists jakarta (and a new city) again: jakarta stays out, the new one comes in.
    SEED_ADDITIONS.push({ migration: 'test_words', words: { kota: ['jakarta', 'sukamakmur'] } });
    syncSeeds(db, 'test_words');
    SEED_ADDITIONS.pop();
    forgetWords();

    assert.ok(!wordSet('kota').has('jakarta'));
    assert.ok(wordSet('kota').has('sukamakmur'));
});

test('bad input is refused', () => {
    assert.throws(() => addWord({ list: 'tidak_ada', word: 'x' }), /tidak dikenal/);
    assert.throws(() => addWord({ list: 'singkatan', word: 'abc' }), /artinya/);
    assert.throws(() => addWord({ list: 'kota', word: 'purworejo' }), /sudah ada/);
});
