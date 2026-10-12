import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWithRules } from '../src/bot/classify-rules.js';
import { customKeywords, removeKeyword, seedStarterKeywords } from '../src/bot/keywords.js';

test('a fresh install starts with example keywords, once, and they work', () => {
    seedStarterKeywords();
    const first = customKeywords().length;
    assert.ok(first >= 5, 'examples present');

    seedStarterKeywords();
    assert.equal(customKeywords().length, first, 'not seeded twice');

    assert.equal(classifyWithRules({ text: 'bisa pakai rekber ga kak', step: 'awaiting_product' }).intent, 'trust');
    assert.equal(classifyWithRules({ text: 'jam buka nya kapan', step: 'awaiting_product' }).intent, 'location');

    // Deleted examples stay deleted.
    for (const k of customKeywords()) removeKeyword(k.id);
    seedStarterKeywords();
    assert.equal(customKeywords().length, 0);
});
