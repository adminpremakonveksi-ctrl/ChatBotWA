import './setup.js';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { z } from 'zod';

import { TRANSIENT_COOLDOWN_MS, chooseKey, keyStatus, markKey, pickKey, reloadKeyStates, resetKeyStates } from '../src/ai-keys.js';
import { aiSettings, updateAiSettings } from '../src/ai-settings.js';
import { ollamaJson } from '../src/bot/classify-ollama.js';
import { config } from '../src/config.js';
import { getSetting, setSetting } from '../src/db.js';
import { errorsSince, latestErrorId } from '../src/errors.js';
import { logger } from '../src/logger.js';
import { startupChecks } from '../src/startup-check.js';

const KEYS = ['key-one-0000000001', 'key-two-0000000002', 'key-three-00000003', 'key-four-000000004'];
const schema = z.object({ ok: z.boolean() });
const call = (fetchImpl) => ollamaJson({ system: 'x', user: 'y', schema }, { fetchImpl });
const answer = { ok: true, status: 200, json: async () => ({ message: { content: '{"ok":true}' } }) };
const refusal = (status, error) => ({ ok: false, status, json: async () => ({ error }) });
const bearer = (options) => options.headers.Authorization?.replace('Bearer ', '');

const useKeys = (count) => {
    updateAiSettings({ key: KEYS[0], key2: count > 1 ? KEYS[1] : '', key3: count > 2 ? KEYS[2] : '', key4: count > 3 ? KEYS[3] : '', keyCooldownMinutes: 30 });
    resetKeyStates();
};

const scripted = (statusByKey, calls = []) => async (url, options) => {
    const key = bearer(options);
    calls.push(key);

    return statusByKey[key] ?? answer;
};

test.afterEach(() => {
    updateAiSettings({ key: '', key2: '', key3: '', key4: '' });
    resetKeyStates();
});

test('key 1 is used until its quota is gone, then key 2, then key 3, and the working key stays in use', async () => {
    useKeys(4);
    const calls = [];
    const fetchImpl = scripted({ [KEYS[0]]: refusal(429, 'you have reached your usage limit'), [KEYS[1]]: refusal(429, 'weekly usage limit reached') }, calls);

    const first = await call(fetchImpl);
    assert.deepEqual(first.answer, { ok: true });
    assert.deepEqual(calls, [KEYS[0], KEYS[1], KEYS[2]], 'one request moves through the keys without waiting for a retry');

    calls.length = 0;
    await call(fetchImpl);
    assert.deepEqual(calls, [KEYS[2]], 'the next request starts on the key that works');
    assert.deepEqual(keyStatus().map((k) => k.state), ['habis', 'habis', 'aktif', 'siap']);
});

test('when every key is out, the request says so once, does not call Ollama again, and the error is a retryable 429', async () => {
    useKeys(4);
    const calls = [];
    const fetchImpl = scripted(Object.fromEntries(KEYS.map((key) => [key, refusal(429, 'usage limit exceeded')])), calls);
    const before = latestErrorId();
    const level = logger.level;
    logger.level = 'warn';

    await assert.rejects(call(fetchImpl), (error) => /Ollama 429: semua kunci AI sudah dicek satu per satu dan semuanya habis jatahnya/.test(error.message));
    assert.equal(calls.length, 4);

    await assert.rejects(call(fetchImpl), /Ollama 429/);
    assert.equal(calls.length, 4, 'no request while every key is resting');
    logger.level = level;

    const popups = errorsSince(before).filter((entry) => /semua kunci AI/.test(entry.message));
    assert.equal(popups.length, 1, 'one pop-up per episode');
    assert.equal(popups[0].guide.level, 'tindak');
    assert.match(popups[0].guide.todo, /Tambahkan kunci Ollama lain/);
    assert.equal(popups[0].guide.known, true);
});

test('a key Ollama rejects (401/403) is skipped for a day and reported with what to do', async () => {
    useKeys(2);
    const calls = [];
    const before = latestErrorId();
    const level = logger.level;
    logger.level = 'warn';

    await call(scripted({ [KEYS[0]]: refusal(401, 'unauthorized') }, calls));
    logger.level = level;
    assert.deepEqual(calls, [KEYS[0], KEYS[1]]);
    assert.equal(keyStatus()[0].state, 'ditolak');

    const popup = errorsSince(before).find((entry) => /ditolak Ollama/.test(entry.message));
    assert.ok(popup);
    assert.match(popup.guide.todo, /Tempel kunci yang benar/);
    assert.equal(popup.guide.known, true);
});

test('a short 429 without a usage-limit message rests the key for a minute, a usage limit for the configured time', () => {
    useKeys(2);
    const now = Date.now();

    markKey(KEYS[0], 429, 'too many requests at once', now);
    assert.equal(pickKey(now + 1000).slot, 2);
    assert.equal(pickKey(now + TRANSIENT_COOLDOWN_MS + 1000).slot, 2, 'sticky: the working key stays in use');

    resetKeyStates();
    markKey(KEYS[0], 429, 'you have reached your weekly usage limit', now);
    markKey(KEYS[1], 429, 'weekly usage limit', now);
    assert.equal(pickKey(now + 29 * 60000), null);
    assert.equal(pickKey(now + 31 * 60000).slot, 1, 'back to the first key once its rest is over');
});

test('only the last four characters of a key reach the dashboard, each slot with its state and source', () => {
    useKeys(3);
    const settings = aiSettings();

    assert.deepEqual(settings.keys.map((k) => [k.slot, k.state, k.source]), [[1, 'aktif', 'pengaturan'], [2, 'siap', 'pengaturan'], [3, 'siap', 'pengaturan'], [4, 'kosong', null]]);
    assert.match(settings.keys[0].masked, /^•+0001$/);
    assert.equal(settings.keys[3].masked, '');
    for (const key of KEYS) assert.doesNotMatch(JSON.stringify(settings), new RegExp(key));
    assert.equal(settings.keyCooldownMinutes, 30);
});

test('saving keys: the same key twice, a short key and a bad rest time are refused; an empty column removes only that key', () => {
    assert.throws(() => updateAiSettings({ key: KEYS[0], key2: KEYS[0] }), /sama tidak boleh dipakai dua kali/);
    assert.throws(() => updateAiSettings({ key3: 'pendek' }), /Kunci API tidak valid/);
    assert.throws(() => updateAiSettings({ keyCooldownMinutes: 0 }), /Jeda kunci/);
    assert.throws(() => updateAiSettings({ keyCooldownMinutes: 721 }), /Jeda kunci/);
    assert.equal(aiSettings().keys.every((k) => k.state === 'kosong'), true, 'nothing was saved by the refused requests');

    useKeys(4);
    updateAiSettings({ key2: '' });
    assert.deepEqual(aiSettings().keys.map((k) => k.state === 'kosong'), [false, true, false, false]);
    assert.equal(config.ollama.extraKeys[0], '');
});

test('a local Ollama without a key still works, and a 429 there is a plain error, not a key rotation', async () => {
    resetKeyStates();
    const hostSet = config.ollama.hostSet;
    config.ollama.hostSet = true;
    const calls = [];
    await assert.rejects(call(async (url, options) => { calls.push(bearer(options)); return refusal(429, 'busy'); }), /Ollama 429: busy/);
    assert.deepEqual(calls, [undefined]);
    config.ollama.hostSet = hostSet;
});

test('Siap mulai shows how many keys are in use, which are resting, and fails only when all are out', async () => {
    useKeys(3);
    const mode = config.bot.mode;
    config.bot.mode = 'ai';
    const reachable = async () => ({ ok: true, status: 200, headers: new Headers() });
    const manager = { list: () => [{ state: 'connected', connected: true, phoneNumber: '62812', healing: {} }] };

    await call(scripted({}));
    markKey(KEYS[0], 429, 'usage limit');
    let ai = (await startupChecks({ manager, fresh: true, fetchImpl: reachable })).checks.find((entry) => entry.key === 'ai');
    assert.equal(ai.ok, true);
    assert.match(ai.detail, /3 kunci, kunci 1 habis sampai/);

    markKey(KEYS[1], 429, 'usage limit');
    markKey(KEYS[2], 429, 'usage limit');
    ai = (await startupChecks({ manager, fresh: true, fetchImpl: reachable })).checks.find((entry) => entry.key === 'ai');
    assert.equal(ai.ok, false);
    assert.match(ai.detail, /Semua 3 kunci AI/);
    assert.match(ai.fix, /Tambahkan kunci Ollama lain[\s\S]*balas pelanggan lewat WhatsApp Business/);
    config.bot.mode = mode;
});

test('the dashboard has four key columns with their state, a rest time field, and one remove button per key', () => {
    const page = fs.readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');
    for (const name of ['aiKey1', 'aiKey2', 'aiKey3', 'aiKey4', 'aiKeyCooldown']) assert.match(page, new RegExp(`name="${name}"`));
    for (const slot of ['key', 'key2', 'key3', 'key4']) assert.match(page, new RegExp(`data-key-remove="${slot}"`));
    assert.match(page, /ai\.keys/);
    assert.match(page, /keyCooldownMinutes: f\.aiKeyCooldown\.value/);
});

test('after the bot is stopped and started again it continues on the key that was working, not from key 1', async () => {
    useKeys(4);
    const calls = [];
    const fetchImpl = scripted({ [KEYS[0]]: refusal(429, 'usage limit reached'), [KEYS[1]]: refusal(429, 'usage limit reached') }, calls);

    await call(fetchImpl);
    assert.deepEqual(calls, [KEYS[0], KEYS[1], KEYS[2]]);

    reloadKeyStates();
    calls.length = 0;
    await call(fetchImpl);
    assert.deepEqual(calls, [KEYS[2]], 'keys 1 and 2 are not asked again after the restart');
    assert.deepEqual(keyStatus().map((k) => k.state), ['habis', 'habis', 'aktif', 'siap']);
});

test('a restart remembers when each key rests until, and forgets the rest once it is over', () => {
    useKeys(3);
    const now = Date.now();
    markKey(KEYS[0], 429, 'usage limit', now);
    pickKey(now);

    reloadKeyStates();
    assert.equal(pickKey(now + 60000).slot, 2, 'key 1 is still resting a minute later');
    reloadKeyStates();
    assert.equal(keyStatus(now + 60000)[0].state, 'habis');
    assert.equal(keyStatus(now + 31 * 60000)[0].state, 'siap', 'rested long enough');
});

test('the saved key state holds no key, only a fingerprint, and a replaced key starts fresh', () => {
    useKeys(2);
    markKey(KEYS[0], 429, 'usage limit');
    const stored = getSetting('ai:key_state');
    for (const key of KEYS) assert.equal(stored.includes(key), false);

    updateAiSettings({ key: 'brand-new-key-0000000009' });
    reloadKeyStates();
    assert.equal(keyStatus()[0].state, 'aktif', 'a new key in column 1 is not treated as the exhausted one');
});

test('a damaged saved state cannot stop the bot: it starts clean', () => {
    useKeys(2);
    setSetting('ai:key_state', '{not json');
    reloadKeyStates();
    assert.equal(pickKey().slot, 1);
    setSetting('ai:key_state', JSON.stringify({ current: 99, resting: { abc: { until: 'x', reason: 'habis' } } }));
    reloadKeyStates();
    assert.equal(pickKey().slot, 1);
});


test('the admin picks which key to use now: it is used first, stays after a restart, and gives way to the next only when it runs out', async () => {
    useKeys(4);
    const calls = [];

    chooseKey(4);
    assert.deepEqual(keyStatus().map((k) => k.state), ['siap', 'siap', 'siap', 'aktif']);
    await call(scripted({}, calls));
    assert.deepEqual(calls, [KEYS[3]]);

    reloadKeyStates();
    calls.length = 0;
    await call(scripted({}, calls));
    assert.deepEqual(calls, [KEYS[3]], 'the choice survives a restart');

    calls.length = 0;
    await call(scripted({ [KEYS[3]]: refusal(429, 'usage limit reached') }, calls));
    assert.deepEqual(calls, [KEYS[3], KEYS[0]], 'when the chosen key is out, the bot does not go silent: it moves on');
});

test('choosing a key that was marked as resting tries it again; an empty column or a wrong number is refused', () => {
    useKeys(2);
    markKey(KEYS[1], 429, 'usage limit');
    assert.equal(keyStatus()[1].state, 'habis');
    chooseKey(2);
    assert.equal(keyStatus()[1].state, 'aktif');

    assert.throws(() => chooseKey(3), (error) => error.statusCode === 422 && /Kunci 3 belum diisi/.test(error.message));
    assert.throws(() => chooseKey(0), /belum diisi/);
    assert.throws(() => chooseKey('abc'), /belum diisi/);
    assert.equal(keyStatus()[1].state, 'aktif', 'a refused choice changes nothing');
});

test('the choose route and the dashboard button', async () => {
    const { once } = await import('node:events');
    const { app } = await import('../src/index.js');
    useKeys(3);
    config.apiKey = '';
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const chosen = await fetch(`${base}/ai/key/3/use`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(chosen.status, 200);
        assert.deepEqual((await chosen.json()).keys.map((k) => k.state), ['siap', 'siap', 'aktif', 'kosong']);

        const empty = await fetch(`${base}/ai/key/4/use`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(empty.status, 422);
        assert.match((await empty.json()).error, /Kunci 4 belum diisi/);
    } finally {
        server.close();
    }

    const page = fs.readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');
    for (const slot of [1, 2, 3, 4]) assert.match(page, new RegExp(`data-key-use="${slot}"`));
    assert.match(page, /\/ai\/key\/\$\{button\.dataset\.keyUse\}\/use/);
});

test('every text that sends the client to the AI keys names the page as the sidebar does, and Pengaturan links to it', () => {
    const page = fs.readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');
    assert.match(page, /data-page="ai"[\s\S]{0,400}>Atur AI<\/button>/);
    assert.match(page, /Kunci AI \(Ollama\)[\s\S]{0,300}data-goto="ai">Atur AI<\/a>/);

    const sources = ['errors.js', 'startup-check.js', 'index.js', 'ai-keys.js', 'bot/chat.js'].map((name) => fs.readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')).join('\n');
    assert.doesNotMatch(sources, /Pengaturan > AI/, 'there is no such menu: the page is "Atur AI"');
    assert.match(sources, /Buka Atur AI dan lihat status tiap kunci/);
});



test('the whole Atur AI page is laid out in four numbered sections with a sticky save bar, and every field the save code reads is still there', () => {
    const page = fs.readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');
    const section = page.slice(page.indexOf('<section data-page="ai"'), page.indexOf('<section data-page="promo"'));

    for (const step of ['1', '2', '3', '4']) assert.match(section, new RegExp(`class="aistep" aria-hidden="true">${step}<`));
    for (const title of ['Kunci API', 'Model dan koneksi', 'Gaya bicara dan contoh', 'Batas pemakaian']) assert.match(section, new RegExp(`<h3>${title}</h3>`));
    for (const field of ['aiKey1', 'aiKey2', 'aiKey3', 'aiKey4', 'aiKeyCooldown', 'aiModel', 'aiHost', 'aiChatPrompt', 'aiChatExamples', 'aiPerCustomer', 'aiTotal', 'aiTimeout']) {
        assert.match(section, new RegExp(`name="${field}"`));
    }
    for (const read of ['f.aiModel.value', 'f.aiHost.value', 'f.aiChatPrompt.value', 'f.aiChatExamples.value', 'f.aiPerCustomer.value', 'f.aiTotal.value', 'f.aiTimeout.value', 'f.aiKeyCooldown.value', 'f[`aiKey${index + 1}`].value']) {
        assert.ok(page.includes(read), `the save code reads ${read}`);
    }
    for (const id of ['aiState', 'aiTest', 'aiTestOut', 'aiPromptReset', 'aiPromptState', 'aiModeHint', 'aiDirty']) assert.match(page, new RegExp(`id="${id}"`));
    assert.match(section, /class="aisave"[\s\S]{0,300}<button class="btn primary">Simpan<\/button>/);
    assert.match(page, /\.aisave \{ position:sticky/);
    assert.match(page, /prefers-reduced-transparency: reduce\) \{ \.aisave/);
    assert.match(page, /prefers-reduced-motion: reduce\) \{ \.keyrow/);
    assert.match(page, /@media \(pointer:coarse\) \{ \.keyactions \.btn \{ min-height:44px/);
});

test('the key cards show their state in words and colour, open the editor smoothly, and tell the admin about unsaved changes', () => {
    const page = fs.readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');

    for (const state of ['aktif', 'siap', 'habis', 'ditolak', 'kosong']) assert.match(page, new RegExp(`\.keyrow\[data-state="${state}"\]`));
    assert.match(page, /const KEY_SHORT = \{ aktif: 'Sedang dipakai', siap: 'Cadangan', habis: 'Habis jatah', ditolak: 'Ditolak', kosong: 'Kosong' \}/);
    assert.match(page, /function setKeyEditor\(slot, open\)[\s\S]{0,200}area\.inert = !open/);
    assert.match(page, /\.keyedit\[data-open="false"\] \{ grid-template-rows:0fr/);
    assert.match(page, /\.keyactions \.btn:active \{ transform:scale\(\.97\) \}/);
    assert.match(page, /\$\('#aiForm'\)\.addEventListener\('input', \(\) => setAiDirty\(true\)\)/);
    assert.match(page, /keyEditing\.clear\(\); setAiDirty\(false\); renderAi\(saved\)/);
    assert.match(page, /\.keyrow button:focus-visible/);
});

test('the dashboard keeps one design system: hints under labels, themed controls, readable links, matching charts, reachable buttons', () => {
    const page = fs.readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');
    const style = page.slice(page.indexOf('<style>'), page.indexOf('</style>'));

    assert.doesNotMatch(page, /<span class="small muted" style="font-weight:400">· /, 'a hint is a <small> under its label, never inline text glued to it');
    assert.match(page, /<label class="lb">Katalog produk<small>/);

    assert.match(style, /label\.lb small, \.card label\.lb small \{ display:block/);
    assert.match(style, /input\[type="checkbox"\], input\[type="radio"\] \{ accent-color:var\(--accent\)/);
    assert.match(style, /select\.f \{ appearance:none/);
    assert.match(style, /\.content a:not\(\.btn\)[^{]*\{ color:var\(--accent\)/);
    assert.match(style, /input\.f:focus, select\.f:focus, textarea\.f:focus \{ outline:none; border-color:var\(--accent\); box-shadow/);
    assert.match(style, /\* \{ scrollbar-width:thin/);
    assert.match(style, /\.content \{ padding-bottom:104px \}/);
    assert.match(style, /\.aisave \{ padding-right:76px \}/, 'the help button never covers a Save button');
    assert.match(style, /\.btn:active:not\(:disabled\) \{ transform:scale\(\.97\) \}/);
    assert.match(style, /@media \(pointer:coarse\) \{ \.btn \{ min-height:44px \}/);
    assert.match(style, /@media \(prefers-reduced-motion:reduce\) \{ \.btn, \.chip, \.pola-sum/);

    assert.match(style, /--accent:#0e7a58;[^\n]*\n\s*--series:#0e7a58; --series-wash:rgba\(14,122,88,\.12\)/);
    assert.equal(style.split('--accent:#63d6b0;').length - 1, 2, 'both dark themes share the accent');
    assert.equal(style.split('--series:#63d6b0; --series-wash:rgba(99,214,176,.16)').length - 1, 2, 'charts use the accent colour in both dark themes');
    assert.doesNotMatch(style, /--series:#(2a78d6|3987e5)/);

    assert.match(style, /label\.lb\.lb-check/);
    assert.doesNotMatch(page, /class="row lb check"/, 'the readiness list owns the class "check"');
});

test('the product editor keeps Save and Delete in a side card that stays in view, and accordion headers work from the keyboard', () => {
    const page = fs.readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');
    const start = page.indexOf('<div class="pola-body">');
    const editor = page.slice(start, page.indexOf("</div>` : ''}", start));

    assert.match(editor, /<div class="pola-aside small">\s*<div class="stack"[^>]*><button class="btn primary" data-save>Simpan perubahan<\/button><button class="btn danger" data-delete>Hapus produk<\/button>/);
    assert.equal((editor.match(/data-save/g) || []).length, 1, 'one Save, not a copy at the bottom of a 2000px form');
    assert.match(page, /\.pola-aside \{ position:sticky; top:80px \}/);
    assert.match(page, /@media \(max-width:1100px\) \{ \.pola-aside \{ position:static \} \}/);

    assert.equal((page.match(/class="pola-sum" role="button" tabindex="0"/g) || []).length, 2);
    assert.match(page, /event\.target\.classList\?\.contains\('pola-sum'\)[\s\S]{0,120}event\.target\.click\(\)/);
});

test('the console has its own look: warm palette, serif headings, a floating sidebar with groups, a subtitle for every page, the status first on Ringkasan', () => {
    const page = fs.readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');
    const style = page.slice(page.indexOf('<style>'), page.indexOf('</style>'));

    assert.equal((page.match(/<aside\b/g) || []).length, 1, 'the sidebar is the only <aside>');
    assert.equal((page.match(/<\/aside>/g) || []).length, 1, 'and it is closed: an open <aside> swallowed the whole main area once');
    assert.match(page, /<\/aside>\s*<div class="main">/);

    assert.match(style, /--serif:"Iowan Old Style"/);
    assert.match(style, /\.topbar h1 \{ font-family:var\(--serif\)/);
    assert.match(style, /\.kpi \.value \{ font-family:var\(--serif\)/);
    assert.match(style, /\.card h3 \{ font-family:var\(--serif\)/);
    assert.match(style, /@media \(min-width:761px\) \{[^@]*\.app > aside \{ margin:14px 0 14px 14px[^}]*border-radius:28px/);
    assert.match(style, /\.nav\.on \{ background:var\(--accent\); color:var\(--accent-ink\)/);
    assert.match(style, /@media \(max-width:760px\) \{\s*\.app > aside \{ margin:0/);

    assert.match(page, /\['Percakapan', \['percakapan', 'coba'\]\], \['Isi bot', \['produk', 'pengetahuan', 'template', 'promo', 'ai', 'media'\]\], \['Sistem', \['statistik', 'pengaturan', 'log'\]\]/);
    const titles = /const TITLES ?= ?\{([^}]*)\}/.exec(page)[1].match(/(\w+):/g).map((entry) => entry.slice(0, -1));
    const subtitles = /const SUBS = \{([^}]*)\}/.exec(page)[1].match(/(\w+):/g).map((entry) => entry.slice(0, -1));
    assert.deepEqual([...subtitles].sort(), [...titles].sort(), 'every page has a one-line subtitle');
    assert.match(page, /\$\('#pageSub'\)\.textContent = SUBS\[page\]/);

    const section = page.slice(page.indexOf('<section data-page="ringkasan"'));
    assert.ok(section.indexOf('class="hero"') < section.indexOf('id="startCard"'), 'the bot status leads, the readiness check follows');
    assert.match(page, /\$\('#startCard'\)\.dataset\.ok = bad\.length \? 'false' : 'true'/);
    assert.match(page, /class="okmore"/);
});
