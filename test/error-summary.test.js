import './setup.js';

import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { errorSummary, pruneErrors, saveError } from '../src/error-summary.js';
import { recordError } from '../src/errors.js';
import { all, run } from '../src/db.js';
import { migrationIds } from '../src/migrations.js';

const KEYS_OUT = 'semua kunci AI sudah dicek satu per satu dan semuanya habis jatahnya';

test('the error log has its own numbered migration', () => {
    assert.ok(migrationIds().includes('026_error_log'));
});

test('recorded problems are saved with their plain meaning and what to do, notes included', () => {
    run('DELETE FROM error_log');
    recordError({ level: 'peringatan', message: KEYS_OUT });
    recordError({ level: 'peringatan', message: 'Pesan sinkronisasi internal akun WhatsApp spoofed self-only protocolMessage' });

    const rows = all('SELECT * FROM error_log ORDER BY id');
    assert.equal(rows.length, 2);
    assert.match(rows[0].meaning, /habis jatahnya/);
    assert.match(rows[0].todo, /Atur AI/);
    assert.equal(rows[0].guide_level, 'tindak');
    assert.equal(rows[0].known, 1);
    assert.equal(rows[1].guide_level, 'info');
    assert.match(rows[1].todo, /Tidak perlu/);
});

test('the same problem repeating within ten minutes is one row with a count', () => {
    run('DELETE FROM error_log');
    for (let i = 0; i < 5; i++) recordError({ level: 'peringatan', message: KEYS_OUT });

    const rows = all('SELECT * FROM error_log');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].count, 5);

    run(`UPDATE error_log SET last_at = datetime('now', '-30 minutes'), at = datetime('now', '-30 minutes')`);
    recordError({ level: 'peringatan', message: KEYS_OUT });
    assert.equal(all('SELECT * FROM error_log').length, 2);
});

test('the summary groups by cause, puts action items first and counts the repeats', () => {
    run('DELETE FROM error_log');
    recordError({ level: 'peringatan', message: 'Katalog WhatsApp gagal dibaca: katalog WhatsApp gagal dibaca' });
    recordError({ level: 'peringatan', message: KEYS_OUT });
    run(`UPDATE error_log SET last_at = datetime('now', '-3 hours'), at = datetime('now', '-3 hours') WHERE message = ?`, [KEYS_OUT]);
    recordError({ level: 'peringatan', message: KEYS_OUT });

    const summary = errorSummary(24);
    assert.equal(summary.groups[0].level, 'tindak');
    assert.equal(summary.groups[0].count, 2);
    assert.ok(summary.groups[0].lastAt >= summary.groups[0].firstAt);
    assert.equal(summary.groups.length, 2);
    assert.equal(summary.total, 3);
    assert.equal(errorSummary(1).groups.length, 2);

    recordError({ level: 'peringatan', message: 'Pesan sinkronisasi internal akun WhatsApp spoofed self-only protocolMessage' });
    assert.deepEqual(errorSummary(24).groups.map((g) => g.level), ['tindak', 'cek', 'info'], 'notes come last');
    assert.equal(errorSummary(24).more, 0);
});

test('old rows are pruned, and a failing save never breaks logging', () => {
    run('DELETE FROM error_log');
    saveError({ level: 'peringatan', source: 'bot', message: 'lama', guide: { level: 'cek', meaning: 'Masalah lama', todo: 'x', known: true } });
    run(`UPDATE error_log SET last_at = datetime('now', '-20 days')`);
    assert.equal(pruneErrors(14), 1);

    assert.doesNotThrow(() => recordError({ level: 'peringatan', message: undefined }));
});

test('the summary route returns the groups', async () => {
    run('DELETE FROM error_log');
    recordError({ level: 'peringatan', message: KEYS_OUT });

    const { app } = await import('../src/index.js');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');

    try {
        const body = await (await fetch(`http://127.0.0.1:${server.address().port}/errors/summary?hours=24`)).json();
        assert.equal(body.groups.length, 1);
        assert.match(body.groups[0].meaning, /habis jatahnya/);
    } finally {
        server.close();
    }
});

test('every problem gets a code: the technical one when there is one, otherwise its guide number', async () => {
    const { codeOf } = await import('../src/errors.js');

    assert.equal(codeOf('AI gagal membalas: bot diam untuk pesan ini', { err: 'Ollama 402: Add usage credits' }), '402');
    assert.equal(codeOf('koneksi putus', { err: 'read ECONNRESET' }), 'ECONNRESET');
    assert.match(codeOf('semua kunci AI sudah dicek satu per satu dan semuanya habis jatahnya'), /^G\d\d$/);
    assert.equal(codeOf('sesuatu yang belum pernah terjadi'), '?');

    run('DELETE FROM error_log');
    recordError({ level: 'peringatan', message: 'AI gagal membalas: bot diam untuk pesan ini', detail: { err: 'Ollama 402: Add usage credits' } });
    assert.equal(errorSummary(24).groups[0].code, '402');
});

test('the Ringkasan table has the four columns', async () => {
    const fs = await import('node:fs');
    const page = fs.readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');

    assert.ok(page.includes('id="issueCard"'));
    assert.ok(page.includes('<th>Jam</th><th>Kode</th><th>Masalah</th><th>Solusinya</th>'));
});

test('quiet log lines (retries) reach the table with their solution but never the pop-up', async () => {
    const { logger } = await import('../src/logger.js');
    const { errorsSince, latestErrorId } = await import('../src/errors.js');
    run('DELETE FROM error_log');
    const before = latestErrorId();
    const level = logger.level;
    logger.level = 'warn';
    logger.warn({ quiet: true, err: 'Ollama 429' }, 'batas panggilan AI tercapai: pesan menunggu percobaan ulang');
    logger.level = level;

    assert.equal(errorsSince(before).length, 0);
    const group = errorSummary(24).groups[0];
    assert.match(group.meaning, /batas jumlah balasan AI/);
    assert.ok(group.todo);
});

test('every problem is listed, not only the first few', () => {
    run('DELETE FROM error_log');
    for (let i = 0; i < 15; i++) recordError({ level: 'peringatan', message: `masalah unik nomor ${i}` });

    const summary = errorSummary(24);
    assert.equal(summary.groups.length, 15);
    assert.equal(summary.more, 0);
});
