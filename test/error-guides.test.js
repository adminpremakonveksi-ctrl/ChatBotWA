import './setup.js';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FALLBACK, GUIDE, LEVELS, errorsSince, guideOf, latestErrorId, meaningOf, recordError } from '../src/errors.js';


const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []));

function skipString(src, i) {
    const quote = src[i++];
    while (i < src.length) {
        const c = src[i];
        if (c === '\\') { i += 2; continue; }
        if (quote === '`' && c === '$' && src[i + 1] === '{') { i = skipBraces(src, i + 1); continue; }
        if (c === quote) return i + 1;
        i++;
    }

    return i;
}

function skipBraces(src, i) {
    let depth = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === "'" || c === '"' || c === '`') { i = skipString(src, i); continue; }
        if (c === '{') depth++;
        if (c === '}' && --depth === 0) return i + 1;
        i++;
    }

    return i;
}

function callArgs(src, open) {
    const args = [];
    let depth = 0;
    let start = open + 1;
    for (let i = open; i < src.length;) {
        const c = src[i];
        if (c === "'" || c === '"' || c === '`') { i = skipString(src, i); continue; }
        if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
        if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 2; continue; }
        if ('([{'.includes(c)) depth++;
        if (')]}'.includes(c)) {
            depth--;
            if (depth === 0) { args.push(src.slice(start, i)); break; }
        }
        if (c === ',' && depth === 1) { args.push(src.slice(start, i)); start = i + 1; }
        i++;
    }

    return args.map((a) => a.trim()).filter(Boolean);
}

function literals(text) {
    const found = [];
    for (let i = 0; i < text.length;) {
        const c = text[i];
        if (c === "'" || c === '"' || c === '`') {
            const end = skipString(text, i);
            let body = text.slice(i + 1, end - 1);
            if (c === '`') {
                let out = '';
                for (let j = 0; j < body.length;) {
                    if (body[j] === '$' && body[j + 1] === '{') { j = skipBraces(body, j + 1); out += 'N'; continue; }
                    out += body[j++];
                }
                body = out;
            }
            found.push(body);
            i = end;
            continue;
        }
        i++;
    }

    return found;
}

function messagesInSource() {
    const found = [];
    for (const file of walk(srcDir)) {
        const src = fs.readFileSync(file, 'utf8');
        for (const match of src.matchAll(/\.(warn|error|alert)\(|\bcrash\(/g)) {
            const args = callArgs(src, match.index + match[0].length - 1);
            if (!args.length) continue;
            const kind = match[1] ?? 'crash';
            if (args.length > 1 && /\bquiet\b/.test(args[0])) continue;
            const messageArg = kind === 'warn' || kind === 'error' ? args[args.length - 1] : args[0];
            for (const message of literals(messageArg)) {
                if (message.trim().length < 8) continue;
                found.push({ file: path.relative(srcDir, file), line: src.slice(0, match.index).split('\n').length, message });
            }
        }
    }

    return found;
}

test('every warn/error in src/ has a guide of its own, not the fallback', () => {
    const messages = messagesInSource();
    assert.ok(messages.length > 25, `the scan should find the bot's warn/error calls (found ${messages.length})`);

    const unexplained = messages.filter((m) => !guideOf(m.message).known);
    assert.deepEqual(
        unexplained.map((m) => `${m.file}:${m.line}  "${m.message}"`),
        [],
        'add a guide in src/errors.js (what it means, what to do) or mark the log line { quiet: true } if it is only for the log file',
    );
});

test('the errors that really appeared on client PCs (a month of logs) all have a guide', () => {
    const seen = [
        'failed to decrypt message', 'katalog WhatsApp gagal dibaca', 'error in sending keep alive', 'stream errored out',
        'sesi dilepas dari HP, kredensial dibersihkan', 'error in handling message', 'url generation failed',
        "unexpected error in 'init queries'", "unexpected error in 'processing offline nodes'", "unexpected error in 'handling notification'",
        'WhatsApp belum tersambung lagi setelah 3 kali mencoba; bot terus mencoba',
        'no name present, ignoring presence update request...', 'error in sending presence update on name change',
        'error in validating connection', 'error in sending message again', '12 file media belum ada (lihat tab Media di konsol)',
        'dropping spoofed self-only protocolMessage',
        'Pesan WhatsApp belum bisa dipulihkan setelah 5 menit; perlu diperiksa',
        'Tidak bisa menghubungi bot: Failed to fetch',
    ];
    for (const message of seen) assert.equal(guideOf(message).known, true, message);
});

test('every guide says whether to act, what it means and what to do, in steps a person can follow', () => {
    for (const g of GUIDE) {
        const name = String(g.match);
        assert.ok(LEVELS.includes(g.level), `${name}: level`);
        assert.ok(g.meaning.length > 15 && g.todo.length > 5, `${name}: meaning and todo`);
        assert.doesNotMatch(`${g.meaning} ${g.todo}`, /undefined|\[object/, `${name}: template slip`);
        if (g.level === 'tindak') assert.match(g.todo, /1\)/, `${name}: a "tindak" guide lists steps`);
    }
    assert.ok(LEVELS.includes(FALLBACK.level) && /Salin teks/.test(FALLBACK.todo), 'the fallback still tells what to do');
});

test('an error nobody wrote a guide for still gets steps, and is marked as unknown', () => {
    const guide = guideOf('sesuatu yang belum pernah terjadi', { err: 'xyz' });
    assert.equal(guide.known, false);
    assert.match(guide.todo, /Salin teks[\s\S]*Mulai ChatBot Prema/);
    assert.equal(meaningOf('sesuatu yang belum pernah terjadi'), null);

    const before = latestErrorId();
    recordError({ level: 'error', message: 'sesuatu yang belum pernah terjadi' });
    const [entry] = errorsSince(before);
    assert.equal(entry.guide.known, false);
    assert.ok(entry.guide.todo, 'never an error without a step');
});

test('a detail cannot take over an error that names itself; the raw message stays as logged', () => {
    const guide = guideOf('AI gagal membalas: bot diam untuk pesan ini', { err: 'Connection Closed' });
    assert.match(guide.meaning, /balasan yang lolos pemeriksaan/);
    const before = latestErrorId();
    recordError({ level: 'error', message: 'AI gagal membalas: bot diam untuk pesan ini', detail: { err: 'Connection Closed' } });
    assert.equal(errorsSince(before)[0].message, 'AI gagal membalas: bot diam untuk pesan ini');
});

test('the pop-up shows the guide before the raw text, with a copy that carries both', () => {
    const page = fs.readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');
    assert.match(page, /function guideFor\(e\)/);
    assert.match(page, /Yang perlu dilakukan/);
    assert.match(page, /Detail untuk developer/);
    assert.match(page, /errQueue\.push\(\{ g, raw, full:/, 'the copied text starts with the guide');
});
