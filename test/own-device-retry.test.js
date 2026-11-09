import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { fixOwnDeviceRetries, ownDeviceRetry } from '../src/own-device-retry.js';
import { makePlaceholderCache } from '../src/baileys-fixes.js';

const user = { id: '628999999999:12@s.whatsapp.net', lid: '999:12@lid' };
const recipient = '628111111111@s.whatsapp.net';
const receipt = (id = 'original-id', overrides = {}) => ({ tag: 'receipt', attrs: { from: '999:66@lid', recipient, type: 'retry', id, ...overrides }, content: [{ tag: 'retry', attrs: { count: '1' } }] });
const settle = async () => { for (let i = 0; i < 24; i++) await new Promise(setImmediate); };

function fixture() {
    const calls = [], acknowledgements = [], warnings = [], normal = [];
    let current = true;
    const socket = {
        ws: new EventEmitter(), user,
        assertSessions: async (jids, force) => calls.push({ type: 'session', jids, force }),
        relayMessage: async () => {},
        sendNode: async (node) => acknowledgements.push(node),
    };
    socket.ws.on('CB:receipt', (node) => normal.push(node));
    const options = {
        getMessage: async () => ({ conversation: 'Original answer' }),
        retry: async (key, participant, count, message) => calls.push({ type: 'message', key, participant, count, message }),
        cache: makePlaceholderCache(),
        log: { info() {}, warn: (detail) => warnings.push(detail) },
        isCurrent: () => current,
    };
    return { socket, options, calls, acknowledgements, warnings, normal, install: () => fixOwnDeviceRetries(socket, options), replace: () => { current = false; } };
}

test('own LID retry uses the authenticated phone alias and preserves the admin device number', () => {
    assert.equal(ownDeviceRetry(receipt(), user).participant, '628999999999:66@s.whatsapp.net');
    assert.equal(ownDeviceRetry(receipt('main', { from: '999@lid' }), user).participant, '628999999999@s.whatsapp.net');
    assert.equal(ownDeviceRetry(receipt('other', { from: '888:66@lid' }), user), null);
    assert.equal(ownDeviceRetry(receipt('group', { recipient: '123@g.us' }), user), null);
    assert.equal(ownDeviceRetry(receipt('read', { type: 'read' }), user), null);
    assert.equal(ownDeviceRetry(receipt(), { id: user.id }), null);
});

test('own retries target only the requesting admin and acknowledge the original LID address', async () => {
    const f = fixture();
    assert.equal(f.install(), true);
    assert.equal(f.install(), false);
    const node = receipt();
    const original = structuredClone(node);
    f.socket.ws.emit('CB:receipt', node);
    await settle();
    assert.deepEqual(node, original);
    assert.equal(f.normal.length, 0);
    assert.deepEqual(f.calls[0], { type: 'session', jids: ['628999999999:66@s.whatsapp.net'], force: true });
    assert.equal(f.calls[1].participant, '628999999999:66@s.whatsapp.net');
    assert.equal(f.calls[1].key.remoteJid, recipient);
    assert.equal(f.calls[1].key.id, node.attrs.id);
    assert.deepEqual(f.acknowledgements[0], { tag: 'ack', attrs: { id: node.attrs.id, to: '999:66@lid', class: 'receipt', type: 'retry', recipient } });
});

test('a LID customer refreshes the LID session that Baileys actually encrypts to', async () => {
    const f = fixture();
    f.install();
    f.socket.ws.emit('CB:receipt', receipt('lid-customer', { recipient: '711111111111@lid' }));
    await settle();
    assert.deepEqual(f.calls[0].jids, ['999:66@lid']);
    assert.equal(f.calls[1].participant, '628999999999:66@s.whatsapp.net');
    assert.equal(f.calls[1].key.remoteJid, '711111111111@lid');
});

test('customer retries, PN retries and ordinary events keep their existing handlers', async () => {
    const f = fixture();
    f.install();
    const nodes = [receipt('customer', { from: '888:9@lid' }), receipt('phone', { from: '628999999999:66@s.whatsapp.net' }), receipt('delivered', { type: 'delivery' })];
    for (const node of nodes) f.socket.ws.emit('CB:receipt', node);
    let notification;
    f.socket.ws.on('CB:notification', (value) => { notification = value; });
    f.socket.ws.emit('CB:notification', { tag: 'notification' });
    await settle();
    assert.deepEqual(f.normal, nodes);
    assert.equal(notification.tag, 'notification');
    assert.equal(f.calls.length, 0);
});

test('duplicate simultaneous receipts coalesce and repeated retries stop after five attempts', async () => {
    const f = fixture();
    f.install();
    f.socket.ws.emit('CB:receipt', receipt());
    f.socket.ws.emit('CB:receipt', receipt());
    await settle();
    assert.equal(f.calls.filter((call) => call.type === 'message').length, 1);
    for (let i = 0; i < 8; i++) { f.socket.ws.emit('CB:receipt', receipt()); await settle(); }
    assert.equal(f.calls.filter((call) => call.type === 'message').length, 5);
});

test('one admin session is not renewed in parallel while its previous retry is encrypting', async () => {
    const f = fixture();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let started = 0;
    f.options.retry = async () => { started++; if (started === 1) await gate; };
    f.install();
    f.socket.ws.emit('CB:receipt', receipt('first'));
    await settle();
    f.socket.ws.emit('CB:receipt', receipt('second'));
    await settle();
    assert.equal(f.calls.length, 1);
    release();
    await settle();
    assert.equal(started, 2);
    assert.equal(f.calls.length, 2);
});

test('missing originals are acknowledged without fabricating a replacement or renewing keys', async () => {
    const f = fixture();
    f.options.getMessage = async () => undefined;
    f.install();
    f.socket.ws.emit('CB:receipt', receipt());
    await settle();
    assert.equal(f.calls.length, 0);
    assert.equal(f.acknowledgements.length, 1);
});

test('failed retry is acknowledged and logged quietly without disconnecting the account', async () => {
    const f = fixture();
    f.socket.assertSessions = async () => { throw new Error('Connection Closed'); };
    f.install();
    f.socket.ws.emit('CB:receipt', receipt());
    await settle();
    assert.equal(f.acknowledgements.length, 1);
    assert.equal(f.warnings.length, 1);
    assert.equal(f.warnings[0].quiet, true);
    assert.equal(f.calls.length, 0);
});

test('a replaced socket cannot relay a late retry result', async () => {
    const f = fixture();
    let release;
    f.socket.assertSessions = () => new Promise((resolve) => { release = resolve; });
    f.install();
    f.socket.ws.emit('CB:receipt', receipt());
    await settle();
    f.replace();
    release();
    await settle();
    assert.equal(f.calls.length, 0);
    assert.equal(f.acknowledgements.length, 0);
});

test('a stalled own-device session request hits its deadline and still acknowledges the receipt', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    f.socket.assertSessions = () => new Promise(() => {});
    f.install();
    f.socket.ws.emit('CB:receipt', receipt());
    await settle();
    t.mock.timers.tick(20000);
    await settle();
    assert.equal(f.calls.length, 0);
    assert.equal(f.acknowledgements.length, 1);
    assert.equal(f.warnings.length, 1);
    assert.equal(f.warnings[0].quiet, true);
});
