import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

await import('./setup.js');
const { OutgoingMessages } = await import('../src/outgoing-messages.js');
const { proto, unpadRandomMax16 } = await import('baileys');
const require = createRequire(import.meta.url);
const sourceUrl = new URL('./Socket/messages-send.js', pathToFileURL(require.resolve('baileys')));
const encrypted = [], stanzas = [];
const log = { debug() {}, info() {}, trace() {}, warn() {}, error() {} };
const base = {
    ev: new EventEmitter(), user: { id: '628999999999:12@s.whatsapp.net', lid: '999:12@lid' },
    authState: { creds: { me: { id: '628999999999:12@s.whatsapp.net', lid: '999:12@lid' } }, keys: { transaction: async (work) => work(), get: async (type, ids) => Object.fromEntries(ids.map((id) => [id, {}])) } },
    signalRepository: {
        jidToSignalProtocolAddress: (jid) => jid,
        encryptMessage: async ({ jid, data }) => { encrypted.push({ jid, message: proto.Message.decode(unpadRandomMax16(data)) }); return { type: 'msg', ciphertext: data }; },
    },
    sendNode: async (node) => stanzas.push(node),
};
const outgoing = new OutgoingMessages('relay-fixture');
const source = new vm.SourceTextModule(await fs.readFile(sourceUrl, 'utf8'), { identifier: sourceUrl.href });
await source.link(async (specifier) => {
    const url = specifier.startsWith('.') ? new URL(specifier, sourceUrl).href : specifier;
    let exports = { ...await import(url) };
    if (specifier === './groups.js') exports.makeGroupsSocket = () => base;
    if (specifier === './newsletter.js') exports.makeNewsletterSocket = (socket) => socket;
    return new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    });
});
await source.evaluate();
const socket = source.namespace.makeMessagesSocket({ logger: log, patchMessageBeforeSending: (message, jids) => outgoing.prepare(message, jids) });
const customers = ['628111111111@s.whatsapp.net', '711111111111@lid'];
const payloads = [
    { conversation: 'Halo Kak.' },
    { imageMessage: { url: 'https://example.com/catalog.jpg', mediaKey: Buffer.from([1, 2, 3]) } },
    { documentMessage: { url: 'https://example.com/catalog.pdf', mediaKey: Buffer.from([4, 5, 6]), fileName: 'Catalog.pdf' } },
];
for (const customer of customers) for (const [index, message] of payloads.entries()) {
    await socket.relayMessage(customer, message, { messageId: `baseline-${index}`, participant: { jid: '999:66@lid', count: 1 } });
    assert.equal(encrypted.at(-1).message.deviceSentMessage, null);
    assert.equal(stanzas.at(-1).attrs.recipient, undefined);
    assert.equal(encrypted.at(-1).jid, customer.endsWith('@lid') ? '999:66@lid' : '999:66@s.whatsapp.net');
    await outgoing.retryOwnDevice(socket, { id: `fixed-${index}`, remoteJid: customer, fromMe: true }, '628999999999:66@s.whatsapp.net', 1, message, () => true);
    assert.equal(stanzas.at(-1).attrs.to, '628999999999:66@s.whatsapp.net');
    assert.equal(encrypted.at(-1).jid, customer.endsWith('@lid') ? '999:66@lid' : '628999999999:66@s.whatsapp.net');
    assert.equal(stanzas.at(-1).attrs.recipient, customer);
    assert.equal(stanzas.at(-1).attrs.id, `fixed-${index}`);
    const recovered = encrypted.at(-1).message.deviceSentMessage;
    assert.equal(recovered.destinationJid, customer);
    assert.deepEqual(proto.Message.toObject(recovered.message, { bytes: String }), proto.Message.toObject(proto.Message.fromObject(message), { bytes: String }));
}
process.stdout.write(JSON.stringify({ payloads: payloads.length * customers.length, baselineMissingWrapper: true, fixedDestinationAndPayload: true }));
