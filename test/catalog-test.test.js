import './setup.js';

import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { phoneFromLink, testCatalog } from '../src/bot/catalog.js';
import { guideOf } from '../src/errors.js';
import { Session } from '../src/session.js';

const socketOf = (getCatalog) => ({ user: { id: '6281999911895:12@s.whatsapp.net' }, getCatalog });
const products = (...names) => ({ products: names.map((name, i) => ({ id: String(i), name, isHidden: false })), nextPageCursor: undefined });

test('a catalog link yields its number', () => {
    assert.equal(phoneFromLink('https://wa.me/c/6281234567890'), '6281234567890');
    assert.equal(phoneFromLink('https://wa.me/p/123/6281234567890'), null);
    assert.equal(phoneFromLink(''), null);
});

test('a readable catalog passes the connection test and shows a sample', async () => {
    const result = await testCatalog(socketOf(async () => products('Jersey Basket', 'Kaos Kelas', 'PDL', 'Lanyard')));

    assert.equal(result.ok, true);
    assert.equal(result.count, 4);
    assert.deepEqual(result.sample, ['Jersey Basket', 'Kaos Kelas', 'PDL']);
    assert.equal(result.phone, '6281999911895');
});

test('a link to another number is tested against that number', async () => {
    let asked = null;
    await testCatalog(socketOf(async ({ jid }) => { asked = jid; return products('A'); }), { phone: '6281234567890' });

    assert.equal(asked, '6281234567890@s.whatsapp.net');
});

test('an empty catalog, a timeout, a missing catalog and a disconnected bot each get their own plain answer', async () => {
    const empty = await testCatalog(socketOf(async () => products()));
    assert.equal(empty.reason, 'kosong');
    assert.match(empty.advice, /Tambahkan produk/);

    const slow = await testCatalog(socketOf(() => new Promise(() => {})), { timeoutMs: 30 });
    assert.equal(slow.reason, 'timeout');
    assert.match(slow.advice, /belum membuktikan katalog kosong/);
    assert.doesNotMatch(slow.message, /kosong/);

    const missing = await testCatalog(socketOf(async () => { throw new Error('item-not-found'); }));
    assert.equal(missing.reason, 'tidak_ada_katalog');

    const other = await testCatalog(socketOf(async () => { throw new Error('boom'); }));
    assert.equal(other.reason, 'lainnya');
    assert.match(other.message, /boom/);

    const off = await testCatalog({ user: null, getCatalog: async () => products('A') });
    assert.equal(off.reason, 'belum_tersambung');
});

test('the route reports the result and syncs when it works', async () => {
    const { app } = await import('../src/index.js');
    const { manager } = await import('../src/manager.js');
    const original = manager.defaultSession;
    let synced = 0;
    manager.defaultSession = async () => ({
        testCatalog: async () => ({ ok: true, reason: 'ok', phone: '628111', message: 'bisa', advice: '', count: 2, sample: ['A', 'B'] }),
        syncCatalog: async () => { synced++; return 2; },
    });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');

    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/catalog/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://wa.me/c/628111234567' }) });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.result.ok, true);
        assert.equal(synced, 1);
    } finally {
        manager.defaultSession = original;
        server.close();
    }
});

test('upload and missing-file failures when sending a catalog are explained', () => {
    const upload = guideOf('gagal memproses pesan', { err: 'Media upload failed on all hosts' });
    assert.match(upload.meaning, /gagal diunggah/);
    assert.equal(upload.known, true);

    const missing = guideOf('gagal memproses pesan', { err: "ENOENT: no such file or directory, open 'D:/bot/media/katalog/jersey.pdf'" });
    assert.equal(missing.level, 'tindak');
    assert.match(missing.todo, /Media/);

    assert.notEqual(guideOf('gagal memproses pesan', { err: "ENOENT: no such file or directory, open 'D:/bot/data/backups/x'" }).level, 'tindak');
});

test('the Media page has the connection test and runs it after a catalog link is saved', async () => {
    const fs = await import('node:fs');
    const page = fs.readFileSync(new URL('../src/console.html', import.meta.url), 'utf8');

    assert.ok(page.includes('id="catTest"'));
    assert.ok(page.includes('runCatalogTest(url)'));
    assert.ok(Session);
});

test('without any registered number the test answers plainly instead of raising an error', async () => {
    const { app } = await import('../src/index.js');
    const { manager } = await import('../src/manager.js');
    const original = manager.defaultSession;
    manager.defaultSession = async () => { throw Object.assign(new Error('Belum ada nomor WhatsApp yang didaftarkan'), { statusCode: 409 }); };
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');

    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/catalog/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.result.reason, 'belum_tersambung');
    } finally {
        manager.defaultSession = original;
        server.close();
    }
});
