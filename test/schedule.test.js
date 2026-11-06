import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { isBotActive } from '../src/bot/schedule.js';

const at = (iso) => new Date(`${iso}+07:00`);
const options = { timezone: 'Asia/Jakarta', activeFrom: '17:30', activeUntil: '07:30', forceMode: '' };

test('silent during working hours, Monday to Saturday', () => {
    assert.equal(isBotActive(at('2026-10-05T12:00:00'), options), false);
    assert.equal(isBotActive(at('2026-10-05T07:30:00'), options), false);
    assert.equal(isBotActive(at('2026-10-10T17:29:00'), options), false);
});

test('the 17.00-17.30 gap stays silent, as specified', () => {
    assert.equal(isBotActive(at('2026-10-05T17:15:00'), options), false);
});

test('active in the night window', () => {
    assert.equal(isBotActive(at('2026-10-05T17:30:00'), options), true);
    assert.equal(isBotActive(at('2026-10-05T23:59:00'), options), true);
    assert.equal(isBotActive(at('2026-10-06T03:00:00'), options), true);
    assert.equal(isBotActive(at('2026-10-06T07:29:00'), options), true);
});

test('active all day Sunday, and Monday early morning', () => {
    assert.equal(isBotActive(at('2026-10-04T12:00:00'), options), true);
    assert.equal(isBotActive(at('2026-10-05T06:00:00'), options), true);
});

test('force mode overrides the clock', () => {
    assert.equal(isBotActive(at('2026-10-05T12:00:00'), { ...options, forceMode: 'always' }), true);
    assert.equal(isBotActive(at('2026-10-04T12:00:00'), { ...options, forceMode: 'never' }), false);
});

test('works regardless of the PC clock timezone', () => {
    assert.equal(isBotActive(new Date('2026-10-05T12:00:00Z'), options), true);
});
