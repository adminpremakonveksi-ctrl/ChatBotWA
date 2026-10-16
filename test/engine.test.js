import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { decide } from '../src/bot/engine.js';
import { activePatterns } from '../src/bot/patterns.js';
import { replies } from '../src/bot/replies.js';
import { seedText } from './helpers.js';

// What exists in media/ for these tests.
const available = new Set(['katalog/jersey', 'katalog/umum', 'size-chart/kaos/reguler', 'size-chart/kaos/oversize', 'katalog-review']);
const media = {
    has: (kind, product = null, variant = null) => {
        if (kind === 'katalog') return available.has(`katalog/${product ?? 'umum'}`);
        if (kind === 'size-chart') return available.has(`size-chart/${product}/${variant}`);
        return available.has(kind);
    },
};

const r = (intent, extra = {}) => ({ intent, product: null, name: null, origin: null, sizeVariant: 'reguler', ...extra });
const texts = (actions) => actions.filter((a) => a.type === 'text').map((a) => a.text);
const kinds = (actions) => actions.map((a) => (a.type === 'text' ? 'text' : a.type === 'media' ? `media:${a.kind}` : a.type));

test('[2] then [3]: unknown customer is asked to introduce themselves', () => {
    const first = decide({}, r('greeting'), media);
    assert.deepEqual(texts(first.actions), [replies.greetUnknown()]);
    assert.equal(first.patch.step, 'awaiting_intro');

    const second = decide({ step: 'awaiting_intro' }, r('introduction', { name: 'Budi', origin: 'Jogja' }), media);
    assert.deepEqual(texts(second.actions), [replies.afterIntro('Budi')]);
    assert.equal(second.patch.step, 'awaiting_product');
    assert.equal(second.patch.name, 'Budi');
});

test('[1]: customer who already introduced themselves is greeted by name', () => {
    const { actions, patch } = decide({}, r('introduction', { name: 'Rina', origin: 'Magelang' }), media);
    assert.deepEqual(texts(actions), [replies.greetKnown('Rina')]);
    assert.equal(patch.step, 'awaiting_product');
});

test('catalog product (jersey): catalog, [5], then [7] + [8] and handover', () => {
    const asked = decide({ step: 'awaiting_product', name: 'Rina' }, r('product', { product: 'jersey' }), media);
    assert.deepEqual(kinds(asked.actions), ['media:katalog', 'text']);
    assert.deepEqual(texts(asked.actions), [replies.askQuantity()]);
    assert.equal(asked.patch.step, 'awaiting_quantity');

    const done = decide({ step: 'awaiting_quantity', product: 'jersey' }, r('quantity'), media);
    assert.deepEqual(texts(done.actions), [replies.waitForCs(), replies.socials()]);
    assert.equal(done.actions.at(-1).type, 'handover');
    assert.equal(done.patch.step, 'handed_over');
});

test('[9] jersey promo is sent only once its text exists', async () => {
    const { config } = await import('../src/config.js');
    config.bot.jerseyPromo = 'PROMO JERSEY';

    try {
        const { actions } = decide({ step: 'awaiting_product' }, r('product', { product: 'jersey' }), media);
        assert.deepEqual(texts(actions), ['PROMO JERSEY', replies.askQuantity()]);
    } finally {
        config.bot.jerseyPromo = '';
    }
});

test('design product (kaos): [4], reference, [5], quantity, handover', () => {
    const asked = decide({ step: 'awaiting_product' }, r('product', { product: 'kaos' }), media);
    assert.deepEqual(texts(asked.actions), [replies.askDesign('Kaos')]);
    assert.equal(asked.patch.step, 'awaiting_design');

    const described = decide({ step: 'awaiting_design', product: 'kaos' }, r('has_reference'), media);
    assert.deepEqual(texts(described.actions), [replies.askQuantity()]);
    assert.equal(described.patch.step, 'awaiting_quantity');
});

test('[6B] no reference for a non-jersey product: portfolio, then [5]', () => {
    const { actions, patch } = decide({ step: 'awaiting_design', product: 'hoodie' }, r('no_reference'), media);
    assert.deepEqual(texts(actions), [replies.portfolio(), replies.askQuantity()]);
    assert.equal(patch.step, 'awaiting_quantity');
});

test('first message names a product but no name: [2], product kept for after the intro', () => {
    const first = decide({}, r('product', { product: 'kaos' }), media);
    assert.deepEqual(texts(first.actions), [replies.greetUnknown()]);
    assert.equal(first.patch.product, 'kaos');

    const second = decide({ step: 'awaiting_intro', product: 'kaos' }, r('introduction', { name: 'Budi' }), media);
    assert.deepEqual(texts(second.actions), [replies.afterIntro('Budi'), replies.askDesign('Kaos')]);
    assert.equal(second.patch.step, 'awaiting_design');
});

test('customer skips the introduction and asks a product: not asked twice', () => {
    const { actions, patch } = decide({ step: 'awaiting_intro' }, r('product', { product: 'kaos' }), media);
    assert.deepEqual(texts(actions), [replies.askDesign('Kaos')]);
    assert.equal(patch.step, 'awaiting_design');
});

test('name + product in the first message: [1] and straight into the flow', () => {
    const { actions } = decide({}, r('product', { product: 'jersey', name: 'Andi' }), media);
    assert.deepEqual(kinds(actions), ['text', 'media:katalog', 'text']);
    assert.equal(texts(actions)[0], replies.greetKnown('Andi'));
});

test('size chart without a product: ask, then send image + note and return to the flow', () => {
    const asked = decide({ step: 'awaiting_quantity' }, r('size_chart'), media);
    assert.deepEqual(texts(asked.actions), [replies.sizeChartWhich()]);
    assert.equal(asked.patch.step, 'awaiting_size_chart_product');
    assert.equal(asked.patch.return_step, 'awaiting_quantity');

    const sent = decide({ step: 'awaiting_size_chart_product', return_step: 'awaiting_quantity' }, r('product', { product: 'kaos' }), media);
    assert.deepEqual(kinds(sent.actions), ['media:size-chart', 'text']);
    assert.equal(sent.actions[0].variant, 'reguler');
    assert.equal(sent.patch.step, 'awaiting_quantity');
});

test('size chart variant falls back to reguler when the variant file is missing', () => {
    const oversize = decide({ step: 'awaiting_product' }, r('size_chart', { product: 'kaos', sizeVariant: 'oversize' }), media);
    assert.equal(oversize.actions[0].variant, 'oversize');

    const boxy = decide({ step: 'awaiting_product' }, r('size_chart', { product: 'kaos', sizeVariant: 'boxy' }), media);
    assert.equal(boxy.actions[0].variant, 'reguler');
});

test('size chart file missing: hand to CS instead of sending nothing', () => {
    const { actions, patch } = decide({ step: 'awaiting_product' }, r('size_chart', { product: 'jaket' }), media);
    assert.deepEqual(texts(actions), [replies.waitForCs()]);
    assert.equal(patch.step, 'handed_over');
});

test('seeded answer patterns keep the conversation where it was', () => {
    const seeded = (builtin) => {
        const p = activePatterns().find((x) => x.builtin === builtin);

        return r('custom', { patterns: [p], pattern: p });
    };

    const location = decide({ step: 'awaiting_design', product: 'kaos' }, seeded('location'), media);
    assert.deepEqual(texts(location.actions), [seedText('location', 0), seedText('location', 1)]);
    assert.equal(location.patch.step, undefined);

    const moq = decide({ step: 'awaiting_product' }, seeded('moq'), media);
    assert.deepEqual(texts(moq.actions), [seedText('moq', 0), seedText('moq', 1)]);

    // Ragu: text, then the files of the Media slot "katalog-review".
    const trust = decide({ step: 'awaiting_product' }, seeded('trust'), media);
    assert.deepEqual(kinds(trust.actions), ['text', 'media:katalog-review']);

    const shipping = decide({ step: 'awaiting_product' }, seeded('shipping'), media);
    assert.deepEqual(texts(shipping.actions), [seedText('shipping', 0)]);
});

test('design reference for jersey: catalog + both [6] bubbles', () => {
    const { actions } = decide({ step: 'awaiting_product', product: 'jersey' }, r('design_reference'), media);
    assert.deepEqual(kinds(actions), ['media:katalog', 'text', 'text']);
    assert.deepEqual(texts(actions), [replies.portfolio(), replies.jerseyTemplates()]);
});

test('aturan 1: anything unrecognised goes to CS', () => {
    const { actions, patch } = decide({ step: 'awaiting_product' }, r('other'), media);
    assert.deepEqual(texts(actions), [replies.waitForCs()]);
    assert.equal(patch.step, 'handed_over');
});

test('handed over: silent', () => {
    assert.deepEqual(decide({ step: 'handed_over' }, r('product', { product: 'kaos' }), media), { actions: [], patch: {} });
});

test('returning customer is greeted by the stored name', () => {
    const { actions } = decide({ step: 'new', name: 'Budi' }, r('greeting'), media);
    assert.deepEqual(texts(actions), [replies.greetKnown('Budi')]);
});

test('bot and CS names come from config', async () => {
    const { config } = await import('../src/config.js');
    config.bot.csName = 'Sari';

    try {
        assert.match(replies.waitForCs(), /CS Sari online/);
        assert.doesNotMatch(replies.waitForCs(), /Anggun/);
    } finally {
        config.bot.csName = 'Anggun';
    }
});

test('replies never contain a price', () => {
    const all = Object.values(replies).map((fn) => fn('X') ?? '').join('\n');
    assert.equal(all.match(/Rp\s?[\d.]+/g), null);

    // The only rupiah amount in the spec, the shipping "mulai dari Rp 1.000/piece", is in the Pengiriman pattern.
    assert.deepEqual(seedText('shipping', 0).match(/Rp\s?[\d.]+/g), ['Rp 1.000']);
});
