import './setup.js';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import { app } from '../src/index.js';
import { Bot } from '../src/bot/bot.js';
import { Session } from '../src/session.js';
import { config } from '../src/config.js';
import { now, run } from '../src/db.js';
import { loadConversation } from '../src/bot/store.js';

test('runtime smoke: HTTP dashboard, connected socket, incoming reply, own echo and admin takeover', async () => {
    const previous = { mode: config.bot.mode, typingMs: config.bot.typingMs, forceMode: config.bot.forceMode };
    Object.assign(config.bot, { mode: 'ai', typingMs: 0, forceMode: 'always' });
    const bot = new Bot({ isActive: () => true, debounceMs: 0, chat: async () => ({ actions: [{ type: 'text', text: 'Halo, saya bantu ya.' }], patch: { step: 'chat' } }) });
    const stamp = now();
    const id = Number(run('INSERT INTO wa_sessions ("key", label, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', ['runtime', 'Runtime simulation', 'disconnected', stamp, stamp]).lastInsertRowid);
    const ev = new EventEmitter();
    const delivered = [];
    const socket = {
        ev, ws: new EventEmitter(), user: { id: '628999999999:12@s.whatsapp.net' },
        signalRepository: { decryptMessage: async () => Buffer.from('simulation') },
        sendPresenceUpdate: async () => {}, end() {},
        sendMessage: async (jid, content, options) => {
            delivered.push(content.text);
            const message = { key: { id: options.messageId, fromMe: true, remoteJid: jid }, message: { conversation: content.text }, messageTimestamp: Math.floor(Date.now() / 1000) };
            ev.emit('messages.upsert', { type: 'notify', messages: [message] });
            return message;
        },
    };
    const session = new Session({ id, key: 'runtime', label: 'Runtime simulation' }, bot, {
        fetchVersion: async () => ({ version: [2, 3000, 1] }),
        authState: async () => ({ state: { creds: {}, keys: { get: async () => ({}), set: async () => {} } }, saveCreds: async () => {}, clear: async () => {} }),
        makeSocket: () => socket,
    });
    const server = app.listen(0, '127.0.0.1');
    try {
        await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}`;
        const health = await fetch(`${base}/health`).then((response) => response.json());
        assert.equal(health.ok, true);
        assert.equal(health.botActive, true);
        const dashboard = await fetch(base);
        assert.equal(dashboard.status, 200);
        assert.match(await dashboard.text(), /<html/);
        const info = await fetch(`${base}/info`).then((response) => response.json());
        assert.equal(info.botMode, 'ai');
        await session.start();
        ev.emit('connection.update', { connection: 'open' });
        await new Promise(setImmediate);
        assert.equal(session.state, 'connected');
        const jid = '628111111111@s.whatsapp.net';
        ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { id: 'runtime-customer', remoteJid: jid, fromMe: false }, message: { conversation: 'Halo kak' }, messageTimestamp: Math.floor(Date.now() / 1000) }] });
        await bot.drain();
        assert.deepEqual(delivered, ['Halo, saya bantu ya.']);
        assert.equal(loadConversation('runtime', jid).step, 'chat');
        ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { id: 'runtime-admin', remoteJid: jid, fromMe: true }, message: { conversation: 'Saya admin, saya bantu.' } }] });
        await new Promise(setImmediate);
        assert.equal(loadConversation('runtime', jid).handover_reason, 'CS membalas');
        const conversation = await fetch(`${base}/conversations/runtime/${encodeURIComponent(jid)}`).then((response) => response.json());
        assert.equal(conversation.conversation.step, 'handed_over');
    } finally {
        await session.stop();
        await new Promise((resolve) => server.close(resolve));
        Object.assign(config.bot, previous);
    }
});
