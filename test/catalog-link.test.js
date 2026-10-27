import './setup.js';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Bot } from '../src/bot/bot.js';
import { classifyWithRules } from '../src/bot/classify-rules.js';
import { createMedia } from '../src/bot/media.js';
import { replies, resetTemplate, updateTemplate } from '../src/bot/replies.js';
import { run } from '../src/db.js';

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const SHOP = 'https://wa.me/c/6281999911895';

const fresh = () => {
    run(`DELETE FROM settings WHERE "key" LIKE 'link:%'`);

    return createMedia(fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-link-')));
};

test('the shop catalog link covers every catalog product without its own pictures', () => {
    const m = fresh();
    m.setLink('katalog', SHOP);

    assert.equal(m.link('katalog', 'jersey'), SHOP);
    assert.equal(m.link('katalog', 'gantungan-kunci'), SHOP);
    assert.equal(m.link('katalog'), SHOP);
    assert.ok(m.has('katalog', 'jersey'));
    assert.equal(m.link('size-chart', 'kaos'), null, 'size charts stay pictures');
});

test("a product's own link beats its pictures; its own pictures beat the shop link", () => {
    const m = fresh();
    m.setLink('katalog', SHOP);

    m.save('katalog:jersey', JPG);
    assert.equal(m.link('katalog', 'jersey'), null, 'pictures of its own win over the shop link');

    m.setLink('katalog:jersey', 'wa.me/p/123456/6281999911895');
    assert.equal(m.link('katalog', 'jersey'), 'https://wa.me/p/123456/6281999911895', 'scheme added, own link wins');

    m.setLink('katalog:jersey', '');
    assert.equal(m.link('katalog', 'jersey'), null, 'cleared');
});

test('catalog slots take WhatsApp catalog links only; other slots any https link', () => {
    const m = fresh();

    assert.throws(() => m.setLink('katalog', 'https://bit.ly/promo'), /link katalog WhatsApp/);

    // A size chart as a link: replaces the picture, and is used for the variant asked.
    const drive = 'https://drive.google.com/file/d/abc/view';
    assert.equal(m.setLink('size-chart:kaos:reguler', 'drive.google.com/file/d/abc/view'), drive);
    assert.ok(m.has('size-chart', 'kaos', 'reguler'));
    assert.deepEqual(m.links('size-chart', 'kaos', 'reguler'), [drive]);
    assert.equal(m.slots().find((s) => s.id === 'size-chart:kaos:reguler').link, drive);
    assert.throws(() => m.setLink('size-chart:kaos:reguler', 'bukan link'), /tidak valid/);

    m.setLink('size-chart:kaos:reguler', '');
    assert.deepEqual(m.links('size-chart', 'kaos', 'reguler'), []);
});

test('the bot says its text first, then sends the catalog link instead of pictures', async () => {
    const m = fresh();
    m.setLink('katalog', SHOP);
    m.save('katalog-review', JPG);

    const sent = [];
    const bot = new Bot({ classify: async (input) => classifyWithRules(input), media: m, isActive: () => true, debounceMs: 5 });
    const wa = { newMessageId: () => `L${sent.length}`, send: async (jid, action) => sent.push(action) };

    run('DELETE FROM conversations');
    bot.onIncoming('utama', wa, { jid: '6281234@s.whatsapp.net', id: 'x1', text: 'halo kak saya Budi dari Jogja mau bikin jersey' });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();

    assert.deepEqual(
        sent.map((a) => (a.type === 'text' ? a.text.slice(0, 12) : a.type)),
        [replies.greetKnown('Budi').slice(0, 12), replies.catalogLink(SHOP, 'produk').slice(0, 12), replies.askQuantityCatalog().slice(0, 12)],
    );
    // The shop-wide link is the shop's catalog, not "katalog Jersey" (2026-10-19: "katalog Jas Almamater" was the whole shop).
    assert.equal(sent[1].text, replies.catalogLink(SHOP, 'produk'), 'a lead-in, then the link');
    assert.ok(!sent.some((a) => a.type === 'file'), 'no pictures when a catalog link applies');

    // A link of the product's own is named after the product.
    const OWN = 'https://wa.me/p/123456/6281999911895';
    m.setLink('katalog:jersey', OWN);
    sent.length = 0;
    run('DELETE FROM conversations');
    bot.onIncoming('utama', wa, { jid: '6281235@s.whatsapp.net', id: 'x2', text: 'halo kak saya Budi dari Jogja mau bikin jersey' });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();
    assert.equal(sent[1].text, replies.catalogLink(OWN, 'Jersey'));
    m.setLink('katalog:jersey', '');
});

test('the lead-in before the link is an editable template', () => {
    try {
        updateTemplate('catalogLink', 'Ini katalog {produk} kami ya kak 👇\n{link}');
        assert.equal(replies.catalogLink(SHOP, 'Jersey'), `Ini katalog Jersey kami ya kak 👇\n${SHOP}`);
    } finally {
        resetTemplate('catalogLink');
    }

    assert.equal(replies.catalogLink(SHOP, 'Jersey'), `Berikut katalog Jersey kami ya kak, silakan dicek 👇\n${SHOP}`);
});

test('a size chart with a link and a picture: the link first, then the picture', async () => {
    const m = fresh();
    m.save('size-chart:kaos:reguler', JPG);
    m.setLink('size-chart:kaos:reguler', 'https://drive.google.com/size-kaos');

    const sent = [];
    const bot = new Bot({ classify: async (input) => classifyWithRules(input), media: m, isActive: () => true, debounceMs: 5 });
    const wa = { newMessageId: () => `Z${sent.length}`, send: async (jid, action) => sent.push(action) };

    run('DELETE FROM conversations');
    bot.onIncoming('utama', wa, { jid: '6289999@s.whatsapp.net', id: 'z1', text: 'halo kak saya Budi dari Jogja, size chart kaos dong' });
    await new Promise((r) => setTimeout(r, 20));
    await bot.drain();

    const after = sent.slice(1).map((a) => (a.type === 'file' ? 'file' : a.text));
    assert.deepEqual(after, [replies.sizeChartLink('https://drive.google.com/size-kaos', 'Kaos'), 'file', replies.sizeChartNote()]);
});
