import './setup.js';

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { INTENTS } from '../src/bot/intents.js';
import { TEMPLATES } from '../src/bot/replies.js';
import { root } from '../src/config.js';
import { SEED_ADDITIONS, SEED_KEYWORDS, SEED_NEW_PRODUCTS, SEED_PATTERNS, SEED_PRODUCTS } from '../src/seeds.js';
import { cleanPhrase } from '../src/text.js';

/**
 * Guards against mistakes that have happened while developing this bot, so
 * `npm test` catches them before a client gets a broken update:
 * - scripted edits writing invisible control characters (\x08) into regexes,
 *   or a real line break inside a '...' string;
 * - a file the tests never import (index.js, session.js) that does not parse;
 * - the console's script not parsing (the whole dashboard goes blank);
 * - non-ASCII in the PowerShell launcher (Windows PowerShell 5.1 misreads it);
 * - a template using a placeholder that is never filled;
 * - one seed phrase given two meanings (which one wins depends on insert order).
 */

const files = (dir, ext) =>
    fs.readdirSync(path.join(root, dir), { recursive: true })
        .filter((f) => f.endsWith(ext))
        .map((f) => path.join(root, dir, f));

const sources = [...files('src', '.js'), ...files('test', '.js'), path.join(root, 'src', 'console.html')];

test('no invisible control characters in the code', () => {
    const bad = [];

    for (const file of sources) {
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
            // eslint-disable-next-line no-control-regex
            if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(line)) bad.push(`${path.relative(root, file)}:${i + 1}`);
        });
    }

    assert.deepEqual(bad, [], 'control characters (an edit by script went wrong): ' + bad.join(', '));
});

test('every file in src/ parses, imported by the tests or not', () => {
    const broken = files('src', '.js')
        .map((file) => ({ file, r: spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }) }))
        .filter(({ r }) => r.status !== 0)
        .map(({ file, r }) => `${path.relative(root, file)}: ${r.stderr.split('\n').find((l) => /Error/.test(l))}`);

    assert.deepEqual(broken, []);
});

test('the console script parses', () => {
    const html = fs.readFileSync(path.join(root, 'src', 'console.html'), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

    assert.ok(scripts.length, 'console.html has its inline script');
    for (const code of scripts) assert.doesNotThrow(() => new vm.Script(code, { filename: 'console.html' }));
});

test('the PowerShell launcher is ASCII only (Windows PowerShell 5.1)', () => {
    for (const file of files('scripts', '.ps1')) {
        const text = fs.readFileSync(file, 'utf8');
        const at = [...text].findIndex((c) => c.charCodeAt(0) > 127);

        assert.equal(at, -1, `${path.relative(root, file)} has a non-ASCII character at ${at}`);
    }
});

test('templates only use placeholders that get filled', () => {
    const always = ['bot', 'cs'];
    const wrong = Object.entries(TEMPLATES).flatMap(([key, t]) =>
        [...t.text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((name) => ![...always, ...t.vars].includes(name)).map((name) => `${key}: {${name}}`),
    );

    assert.deepEqual(wrong, []);
});

test('no seed phrase has two meanings', () => {
    const owner = new Map();
    const clashes = [];
    const claim = (phrase, who) => {
        const p = cleanPhrase(phrase);
        const before = owner.get(p);

        if (before && before !== who) clashes.push(`"${p}": ${before} / ${who}`);
        else owner.set(p, who);
    };

    for (const [intent, list] of Object.entries(SEED_KEYWORDS)) list.forEach((p) => claim(p, `maksud ${intent}`));
    for (const p of [...SEED_PRODUCTS, ...SEED_NEW_PRODUCTS]) p.keywords.forEach((k) => claim(k, `produk ${p.key}`));
    for (const add of SEED_ADDITIONS) for (const [key, list] of Object.entries(add.products ?? {})) list.forEach((k) => claim(k, `produk ${key}`));
    for (const p of SEED_PATTERNS) p.keywords.forEach((k) => claim(k, `pola ${p.builtin}`));

    assert.deepEqual(clashes, []);
});

test('no word lists are hard-coded in the logic: vocabulary lives in the database (Kamus)', () => {
    // The files that read customer text. A list of 8+ quoted words there is
    // vocabulary that belongs in SEED_WORDS (seeds.js) and the table word_lists.
    const logic = ['src/text.js', 'src/bot/classify-rules.js', 'src/bot/engine.js', 'src/bot/store.js', 'src/bot/intents.js', 'src/bot/ai-text.js', 'src/bot/classify.js'];
    const found = [];

    for (const file of logic) {
        const code = fs.readFileSync(path.join(root, file), 'utf8');
        for (const match of code.matchAll(/\[((?:\s*'[^'\n]*',?){8,})\s*\]/g)) {
            const line = code.slice(0, match.index).split('\n').length;
            const items = [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
            const before = code.split('\n').slice(Math.max(0, line - 2), line).join('\n');

            // Intent labels and database columns are the bot's structure, not vocabulary.
            if (/export const INTENTS|const COLUMNS/.test(before)) continue;
            if (items.every((item) => INTENTS.includes(item))) continue;

            found.push(`${file}:${line}`);
        }
    }

    assert.deepEqual(found, [], 'move these words to SEED_WORDS (seeds.js) and read them with words.js');
});

test('every seed migration named in SEED_ADDITIONS exists', async () => {
    const { migrationIds } = await import('../src/migrations.js');

    for (const add of SEED_ADDITIONS) assert.ok(migrationIds().includes(add.migration), `${add.migration} has no migration`);
});
