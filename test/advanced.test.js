import './setup.js';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Bot } from '../src/bot/bot.js';
import { classifyWithRules, normalise } from '../src/bot/classify-rules.js';
import { decide } from '../src/bot/engine.js';
import { createMedia } from '../src/bot/media.js';
import { createPattern, deletePattern, listPatterns, updatePattern } from '../src/bot/patterns.js';
import { replies } from '../src/bot/replies.js';
import { holidayOn, isBotActive, nextChange } from '../src/bot/schedule.js';
import * as store from '../src/bot/store.js';
import { run } from '../src/db.js';
import { parseHolidays } from '../src/settings.js';
import { patternNames, seedText } from './helpers.js';

const c = (text, step = 'awaiting_product') => classifyWithRules({ text, step });
const media = () => createMedia(fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-adv-')));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('chat shorthand is understood', () => {
    assert.equal(normalise('min order brp kak??'), ' min order berapa kak ');
    assert.deepEqual(patternNames(c('min order brp kak')), ['Minimal order']);
    assert.deepEqual(patternNames(c('lok nya dmn ya')), ['Lokasi']);
    assert.deepEqual(patternNames(c('bs kirim ke medan gk')), ['Pengiriman']);
    assert.equal(c('blm ada kak', 'awaiting_design').intent, 'no_reference');
    assert.equal(c('sz chart kaos ada?').intent, 'size_chart');
    assert.equal(c('hrg jersey brp').product, 'jersey');
});

test('anti-repeat: a bubble already sent twice in 10 minutes is not sent a third time', async () => {
    run('DELETE FROM conversations');
    run('DELETE FROM message_log');
    const sent = [];
    const bot = new Bot({ classify: async (input) => classifyWithRules(input), media: media(), isActive: () => true, debounceMs: 5 });
    const wa = { newMessageId: () => `R${sent.length}${Math.random()}`, send: async (jid, action) => sent.push(action) };
    const jid = '6281111222@s.whatsapp.net';
    const ask = async (text) => { bot.onIncoming('utama', wa, { jid, id: `i${Math.random()}`, text }); await wait(15); await bot.drain(); };

    await ask('halo saya Budi dari Jogja');
    for (let i = 0; i < 4; i++) await ask('minimal order berapa?');

    assert.equal(sent.filter((a) => a.text === seedText('moq', 0)).length, 2, 'sent twice, then held back');
    assert.equal(store.loadConversation('utama', jid).step, 'handed_over', 'nothing new to say: a person takes over');
});

test('holiday mode keeps the bot on guard all day', () => {
    const holidays = parseHolidays('2027-03-08 - 2027-03-14 Lebaran\n2026-12-25 Natal');
    assert.deepEqual(holidays, [
        { from: '2026-12-25', to: '2026-12-25', label: 'Natal' },
        { from: '2027-03-08', to: '2027-03-14', label: 'Lebaran' },
    ]);

    const options = { timezone: 'Asia/Jakarta', activeFrom: '17:30', activeUntil: '07:30', forceMode: '', holidays };
    const noon = (day) => new Date(`${day}T12:00:00+07:00`);

    assert.equal(isBotActive(noon('2027-03-10'), options), true, 'Wednesday noon during Lebaran');
    assert.equal(holidayOn(noon('2027-03-10'), options).label, 'Lebaran');
    assert.equal(isBotActive(noon('2027-03-15'), options), false, 'Monday after: back to normal');
    assert.equal(isBotActive(noon('2026-12-25'), options), true, 'single day');
    // Saturday 13 Mar is a holiday, Sunday 14 too, Monday 15 normal: on guard until 07.30 Monday.
    assert.equal(nextChange(noon('2027-03-12'), options).toISOString(), '2027-03-15T00:30:00.000Z');

    assert.throws(() => parseHolidays('besok saja'), /tidak dimengerti/);
    assert.throws(() => parseHolidays('2027-03-14 - 2027-03-08'), /sebelum/);
});

test('pattern text versions rotate; a dated pattern only answers in its dates', () => {
    for (const p of listPatterns()) deletePattern(p.id);
    const p = createPattern('Sapa malam');
    updatePattern(p.id, { keywords: 'masih buka', bubbles: [{ type: 'text', text: 'Masih kak {nama}!\n---\nIya kak {nama}, kami jaga malam 🌙' }] });

    const r = c('masih buka kak?');
    const one = decide({ step: 'awaiting_product', name: 'Rina' }, r, media(), { random: () => 0 }).actions[0].text;
    const two = decide({ step: 'awaiting_product', name: 'Rina' }, r, media(), { random: () => 0.99 }).actions[0].text;
    assert.equal(one, 'Masih kak Rina!');
    assert.equal(two, 'Iya kak Rina, kami jaga malam 🌙');

    updatePattern(p.id, { startsOn: '2099-01-01' });
    assert.notEqual(c('masih buka kak?').intent, 'custom', 'not started yet');
    updatePattern(p.id, { startsOn: '2000-01-01', endsOn: '2000-12-31' });
    assert.notEqual(c('masih buka kak?').intent, 'custom', 'already over');
    updatePattern(p.id, { startsOn: '', endsOn: '' });
    assert.equal(c('masih buka kak?').intent, 'custom', 'always');

    assert.throws(() => updatePattern(p.id, { startsOn: '2027-02-01', endsOn: '2027-01-01' }), /sebelum/);
    assert.throws(() => updatePattern(p.id, { startsOn: '1 Jan' }), /tanggal/);
    deletePattern(p.id);
});

test('the funnel counts how far customers got', async () => {
    run('DELETE FROM conversations');
    run('DELETE FROM message_log');
    const bot = new Bot({ classify: async (input) => classifyWithRules(input), media: media(), isActive: () => true, debounceMs: 5 });
    const wa = { newMessageId: () => `F${Math.random()}`, send: async () => {} };
    const talk = async (jid, lines) => {
        for (const text of lines) { bot.onIncoming('utama', wa, { jid, id: `f${Math.random()}`, text }); await wait(15); await bot.drain(); }
    };

    await talk('62801@s.whatsapp.net', ['halo saya Ani dari Solo', 'mau bikin kaos kelas', 'belum ada', '30 pcs']);
    await talk('62802@s.whatsapp.net', ['halo saya Budi dari Jogja', 'mau bikin hoodie']);
    await talk('62803@s.whatsapp.net', ['halo kak']);

    const funnel = Object.fromEntries(store.analytics(7).funnel.map((f) => [f.stage, f.n]));
    assert.deepEqual(funnel, { Menghubungi: 3, 'Menyebut produk': 2, 'Ditanya jumlah': 1, 'Alur selesai, menunggu CS': 1 });

    // Step records never show up as chat bubbles.
    assert.ok(store.messagesOf('utama', '62801@s.whatsapp.net').every((m) => m.direction !== 'step'));
});
