import './setup.js';

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { NON_CHANNEL_MEX, fixMexNotifications, isNonChannelMex } from '../src/baileys-fixes.js';

// The notification from the client PC log (2026-10-19 07:05:38).
const linkedProfiles = () => ({
    tag: 'notification',
    attrs: { from: '28067997159547@lid', type: 'mex', id: '1541249863', offline: '0', t: '1792248640' },
    content: [{ tag: 'update', attrs: { op_name: 'NotificationLinkedProfilesUpdatesSideSub' }, content: Buffer.from('{"data":{"xwa2_notify_linked_profiles_side_sub":{"hash":"xTbe"}}}') }],
});
const channel = () => ({ tag: 'notification', attrs: { from: '120363@newsletter', type: 'mex', id: '77' }, content: [{ tag: 'mex', attrs: {}, content: Buffer.from('{}') }] });
const group = () => ({ tag: 'notification', attrs: { from: '123@g.us', type: 'w:gp2', id: '88' }, content: [] });

test('a linked-profiles mex notification reaches Baileys under its own type; channel ones are untouched', () => {
    assert.ok(isNonChannelMex(linkedProfiles()));
    assert.ok(!isNonChannelMex(channel()));
    assert.ok(!isNonChannelMex(group()));

    // Baileys' own listener, registered when the socket is made, sees every notification.
    const ws = new EventEmitter();
    const seen = [];
    ws.on('CB:notification', (node) => seen.push(`${node.attrs.id}:${node.attrs.type}`));

    assert.equal(fixMexNotifications({ ws }), true);

    ws.emit('CB:notification', linkedProfiles());
    ws.emit('CB:notification', channel());
    ws.emit('CB:notification', group());

    // Every notification still goes to Baileys (which acks it); only the misrouted one has a new type.
    assert.deepEqual(seen, [`1541249863:${NON_CHANNEL_MEX}`, '77:mex', '88:w:gp2']);
});

test('without a socket to fix nothing is changed', () => {
    assert.equal(fixMexNotifications({}), false);
});

test('the placeholder cache takes an empty key without throwing (NodeCache.del(null): "error in handling message", 2026-10-19)', async () => {
    const { makePlaceholderCache } = await import('../src/baileys-fixes.js');
    let now = 0;
    const cache = makePlaceholderCache(1000, () => now);

    assert.doesNotThrow(() => cache.del(null));
    assert.doesNotThrow(() => cache.del(undefined));
    assert.equal(cache.get(null), undefined);
    assert.equal(cache.set(null, true), false);

    cache.set('A1', true);
    assert.equal(cache.get('A1'), true);
    now = 1001;
    assert.equal(cache.get('A1'), undefined, 'gone after its hour, like the default');
    cache.set('A2', true);
    assert.equal(cache.del('A2'), 1);
    assert.equal(cache.get('A2'), undefined);

    const fs = await import('node:fs');
    assert.match(fs.readFileSync(new URL('../src/session.js', import.meta.url), 'utf8'), /placeholderResendCache: makePlaceholderCache\(\)/);
});

test('Baileys connection errors the session handles go to the log file, not the pop-up (515 "restart required")', async () => {
    const { sessionHandledLog } = await import('../src/baileys-fixes.js');
    const seen = [];
    const fake = (tag) => ({
        level: 'warn',
        info: (...a) => seen.push([tag, 'info', a.find((x) => typeof x === 'string')]),
        warn: (...a) => seen.push([tag, 'warn', a.find((x) => typeof x === 'string')]),
        error: (...a) => seen.push([tag, 'error', a.find((x) => typeof x === 'string')]),
        trace() {}, debug() {}, fatal() {},
        child: () => fake(`${tag}+`),
    });
    const log = sessionHandledLog(fake('baileys'), fake('session'));

    log.error({ node: { tag: 'stream:error', attrs: { code: '515' } } }, 'stream errored out');
    log.child({ class: 'socket' }).error({ err: 'Connection Closed' }, 'error in validating connection');
    log.warn({ msgId: 'A1', type: 17, from: '123@lid' }, 'dropping spoofed self-only protocolMessage from non-self origin');
    log.error({ err: 'x' }, 'failed to decrypt message');
    assert.deepEqual(seen, [
        ['session', 'info', 'stream errored out'],
        ['session+', 'info', 'error in validating connection'],
        ['session', 'info', 'dropping spoofed self-only protocolMessage from non-self origin'],
        ['baileys', 'error', 'failed to decrypt message'],
    ]);
    assert.equal(log.level, 'warn');
});
