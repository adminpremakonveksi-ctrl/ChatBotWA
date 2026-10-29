import './setup.js';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { aiSettings, updateAiSettings } from '../src/ai-settings.js';
import { config } from '../src/config.js';
import { getSetting } from '../src/db.js';
import { logger } from '../src/logger.js';
import { errorsSince, latestErrorId, meaningOf, recordError } from '../src/errors.js';
import { startupChecks } from '../src/startup-check.js';
import { checkUpdate, readRepo } from '../src/update-check.js';

/** A client install: data/versi.txt and scripts/repo.txt, no .git. */
const install = (sha) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-install-'));
    fs.mkdirSync(path.join(dir, 'data'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(path.join(dir, 'data', 'versi.txt'), `${sha}\r\n`);
    fs.writeFileSync(path.join(dir, 'scripts', 'repo.txt'), '# komentar\nhttps://github.com/pemilik/ChatBotWA main\n');

    return dir;
};
const github = (sha, calls = []) => async (url) => {
    calls.push(url);

    return { ok: true, status: 200, json: async () => ({ sha }) };
};

test('client PC errors get a plain meaning above the raw text, which stays as logged', () => {
    assert.match(meaningOf('error in validating connection', { err: { message: 'Connection Closed' } }), /putus sebentar/);
    assert.match(meaningOf('pesan tidak dijawab AI', { err: 'The operation was aborted due to timeout' }), /terlalu lama/);
    assert.match(meaningOf('fetch failed'), /tidak bisa menjangkau internet/);
    assert.match(meaningOf('Ollama 429: limit'), /Jatah/);
    assert.match(meaningOf('stream errored out', { node: { attrs: { code: '515' } } }), /kode 515/);
    assert.match(meaningOf('dropping spoofed self-only protocolMessage from non-self origin'), /sinkronisasi internal/);
    assert.equal(meaningOf('sesuatu yang belum dikenal'), null);
    // A stack naming decryptMessage must not turn an unrelated error into "pesan tidak bisa dibuka".
    assert.equal(meaningOf('gagal', { stack: 'at decryptMessage (x.js:1)' }), null);

    const before = latestErrorId();
    recordError({ message: 'error in validating connection', detail: { err: 'Connection Closed' } });
    const [entry] = errorsSince(before);
    assert.equal(entry.message, 'error in validating connection', 'raw message untouched');
    assert.match(entry.meaning, /menyambung ulang sendiri/);
});

test('the AI time limit: 60 s by default, editable 10-180 s, applied to the calls', () => {
    assert.equal(getSetting('ai:timeout_s'), '60', 'migration 020 sets 60 s over the old .env 20000');
    assert.equal(aiSettings().timeoutSeconds, 60);
    assert.equal(config.ollama.timeoutMs, 60000);

    updateAiSettings({ timeoutSeconds: 90 });
    assert.equal(config.ollama.timeoutMs, 90000);
    assert.throws(() => updateAiSettings({ timeoutSeconds: 5 }), /Batas waktu/);
    updateAiSettings({ timeoutSeconds: 60 });
    assert.equal(fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8').match(/OLLAMA_TIMEOUT_MS=(\d+)/)[1], '60000', 'new installs copy this');
});

test('repo.txt is read like the launcher reads it', () => {
    assert.deepEqual(readRepo('# x\nhttps://github.com/a/b dev'), { owner: 'a', repo: 'b', branch: 'dev' });
    assert.deepEqual(readRepo('https://github.com/a/b.git'), { owner: 'a', repo: 'b', branch: 'main' });
    assert.equal(readRepo('# kosong'), null);
});

test('a newer commit on GitHub says "not the latest bot", once per new version', async () => {
    const dir = install('aaaaaaa1111');
    const calls = [];
    const before = latestErrorId();
    const level = logger.level;
    logger.level = 'warn';

    let r = await checkUpdate({ dir, fetchImpl: github('bbbbbbb2222', calls) });
    assert.equal(r.available, true);
    assert.equal(r.installed, 'aaaaaaa');
    assert.equal(r.latest, 'bbbbbbb');
    assert.equal(calls[0], 'https://api.github.com/repos/pemilik/ChatBotWA/commits/main');
    await checkUpdate({ dir, fetchImpl: github('bbbbbbb2222') });
    const warned = errorsSince(before).filter((e) => /belum versi terbaru/.test(e.message));
    assert.equal(warned.length, 1, 'the pop-up shows it once, not every 6 hours');
    assert.match(warned[0].meaning, /Mulai ChatBot Prema/);

    r = await checkUpdate({ dir, fetchImpl: github('aaaaaaa1111') });
    assert.equal(r.available, false, 'same commit: up to date');

    // No internet keeps the last answer, without a pop-up.
    const quiet = latestErrorId();
    r = await checkUpdate({ dir, fetchImpl: async () => { throw new Error('fetch failed'); } });
    assert.equal(r.error, 'fetch failed');
    assert.equal(errorsSince(quiet).length, 0);
    logger.level = level;
});

test('the developer PC (git checkout) and an install without versi.txt are not checked', async () => {
    const dir = install('aaaaaaa');
    fs.mkdirSync(path.join(dir, '.git'));
    assert.equal((await checkUpdate({ dir, fetchImpl: github('b') })).skipped, 'git');

    const bare = install('x');
    fs.rmSync(path.join(bare, 'data', 'versi.txt'));
    assert.equal((await checkUpdate({ dir: bare, fetchImpl: github('b') })).skipped, 'versi');
});

test('Siap mulai: no internet, wrong PC clock and a lost WhatsApp each say what to do', async () => {
    const manager = { list: () => [{ state: 'disconnected', connected: false, lastError: 'Connection Closed' }] };

    let r = await startupChecks({ manager, fresh: true, fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND web.whatsapp.com'); } });
    const net = r.checks.find((c) => c.key === 'internet');
    assert.equal(r.ready, false);
    assert.equal(net.ok, false);
    assert.match(net.fix, /Wi-Fi/);
    assert.match(net.raw, /ENOTFOUND/, 'raw error kept');
    const wa = r.checks.find((c) => c.key === 'wa');
    assert.match(wa.fix, /putus sebentar/);
    assert.equal(wa.raw, 'Connection Closed');

    const tenMinutesAhead = Date.now() + 10 * 60000;
    r = await startupChecks({
        manager: { list: () => [{ state: 'connected', connected: true, phoneNumber: '62812' }] },
        fresh: true,
        now: () => tenMinutesAhead,
        fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers({ date: new Date().toUTCString() }) }),
    });
    const clock = r.checks.find((c) => c.key === 'jam');
    assert.equal(clock.ok, false);
    assert.match(clock.detail, /lebih cepat 10 menit/);
    assert.match(clock.fix, /Set time automatically/);
    assert.equal(r.checks.find((c) => c.key === 'wa').ok, true);
});
