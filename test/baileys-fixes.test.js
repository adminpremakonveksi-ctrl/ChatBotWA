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
