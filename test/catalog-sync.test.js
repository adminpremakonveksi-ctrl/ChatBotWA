import './setup.js';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Bot } from '../src/bot/bot.js';
import { catalogLinksFor, catalogStatus, setItemProduct, syncCatalog } from '../src/bot/catalog.js';
import { classifyWithRules } from '../src/bot/classify-rules.js';
import { createMedia } from '../src/bot/media.js';
import { replies } from '../src/bot/replies.js';
import { run } from '../src/db.js';

// The client's real catalog item names, in their catalog order.
const NAMES = [
    'Paket IDCard & Lanyard', 'Jersey Basket', 'Bahan Jersey', 'Opsi Peletakan Logo Apparel', 'Jenis Kerah Jersey',
    'PROMO JERSEY PRINTING (10 slot per bulan)', 'Kaos Kelas Two-Tone', 'Kemeja PDL 2in1', 'Koleksi Kaos Kelas Menyala',
    'Contoh Hasil Kaos Kelas', 'Contoh Hasil Cetak ID Card & Lanyard', 'Contoh Baju Osis', 'Contoh Baju Pramuka',
    'Contoh Baju PKS, Paskibra', 'Contoh Baju Kemeja PDL PMR', 'Koleksi Kaos Angkatan Tahun 2024',
];

/** A Baileys socket stand-in that serves the catalog in pages of 10. */
function fakeSocket(names = NAMES, { hidden = [] } = {}) {
    const products = names.map((name, i) => ({ id: String(1000 + i), name, description: '', price: 1, currency: 'IDR', isHidden: hidden.includes(name), imageUrls: { requested: `https://img/${i}.jpg` } }));

    return {
        user: { id: '6281999911895:12@s.whatsapp.net' },
        async getCatalog({ cursor }) {
            const start = cursor ? Number(cursor) : 0;
            const page = products.slice(start, start + 10);

            return { products: page, nextPageCursor: start + 10 < products.length ? String(start + 10) : undefined };
        },
    };
}

const reset = () => run(`DELETE FROM settings WHERE "key" LIKE 'catmap:%' OR "key" LIKE 'link:%'`);

test('sync reads every page, skips hidden items, and remembers the number', async () => {
    reset();
    const count = await syncCatalog(fakeSocket(NAMES, { hidden: ['Opsi Peletakan Logo Apparel'] }));

    assert.equal(count, NAMES.length - 1);
    assert.equal(catalogStatus().phone, '6281999911895');
    assert.ok(catalogStatus().syncedAt);
});

test('items are matched to products, promos first, at most three per answer', async () => {
    reset();
    await syncCatalog(fakeSocket());

    // Jersey Basket, Bahan Jersey, Kerah, PROMO: the promo must not be the one cut off.
    assert.deepEqual(catalogLinksFor('jersey'), [
        'https://wa.me/p/1005/6281999911895', // PROMO JERSEY PRINTING
        'https://wa.me/p/1001/6281999911895', // Jersey Basket
        'https://wa.me/p/1002/6281999911895', // Bahan Jersey
    ]);
    assert.equal(catalogLinksFor('seragam-sekolah').length, 3, 'OSIS, Pramuka, PKS/Paskibra');
    assert.equal(catalogLinksFor('id-card-lanyard').length, 2);
    assert.deepEqual(catalogLinksFor('topi'), []);
});

test('the team can move an item to another product or keep it out', async () => {
    reset();
    await syncCatalog(fakeSocket());

    setItemProduct('1003', 'jersey'); // Opsi Peletakan Logo Apparel -> jersey
    assert.equal(catalogStatus().items.find((i) => i.id === '1003').product, 'jersey');

    setItemProduct('1005', 'none'); // promo excluded
    assert.ok(!catalogLinksFor('jersey').includes('https://wa.me/p/1005/6281999911895'));

    setItemProduct('1005', ''); // back to automatic
    assert.ok(catalogLinksFor('jersey').includes('https://wa.me/p/1005/6281999911895'));

    assert.throws(() => setItemProduct('9999', 'jersey'), /tidak ditemukan/);
    assert.throws(() => setItemProduct('1003', 'mobil'), /tidak dikenal/);
});

test('the bot answers with its text, then the matching catalog products', async () => {
    reset();
    await syncCatalog(fakeSocket());
    const m = createMedia(fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-cat-')));

    const sent = [];
    const bot = new Bot({ classify: async (input) => classifyWithRules(input), media: m, isActive: () => true, debounceMs: 5 });
    let messageId = 0;
    const wa = { newMessageId: () => `C${++messageId}`, send: async (jid, action) => sent.push(action) };

    run('DELETE FROM conversations');
    bot.onIncoming('utama', wa, { jid: '6289999@s.whatsapp.net', id: 'c1', text: 'malam kak saya Rina dari Magelang, mau bikin seragam osis' });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();

    const texts = sent.map((a) => a.text);
    assert.equal(texts[0], replies.greetKnown('Rina'));
    assert.equal(texts[1], replies.askDesign('Seragam'), 'design-priced product: [4], no catalog');

    // A catalog product: the products replace the pictures, before [5].
    sent.length = 0;
    run('DELETE FROM conversations');
    bot.onIncoming('utama', wa, { jid: '6288888@s.whatsapp.net', id: 'c2', text: 'halo kak saya Budi dari Jogja mau bikin jersey' });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();

    assert.deepEqual(sent.map((a) => a.text), [
        replies.greetKnown('Budi'),
        replies.catalogLink('https://wa.me/p/1005/6281999911895', 'Jersey'),
        'https://wa.me/p/1001/6281999911895',
        'https://wa.me/p/1002/6281999911895',
        replies.askQuantityCatalog(),
    ]);
});

test('"belum ada desainnya" answers once: portfolio, examples, then the quantity question', async () => {
    reset();
    await syncCatalog(fakeSocket());
    const m = createMedia(fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-cat-')));
    const { decide } = await import('../src/bot/engine.js');

    const r = classifyWithRules({ text: 'belum ada desainnya kak', step: 'awaiting_design' });
    const { actions } = decide({ step: 'awaiting_design', product: 'seragam-sekolah' }, r, m);

    assert.deepEqual(actions.map((a) => (a.type === 'media' ? `media:${a.kind}` : a.text?.slice(0, 20))), [
        replies.portfolio().slice(0, 20),
        'media:katalog',
        replies.askQuantity().slice(0, 20),
    ]);
});
