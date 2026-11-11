import './setup.js';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

import { updateAiSettings } from '../src/ai-settings.js';
import { deleteFaq, listFaq, listTopics, saveFaq, saveTopic } from '../src/bot/knowledge.js';
import { forgetProducts, listProducts } from '../src/bot/products.js';
import { saveConversation } from '../src/bot/store.js';
import { config } from '../src/config.js';
import { get, getSetting, run, setSetting } from '../src/db.js';
import { backup, listBackups, restoreContent } from '../src/maintenance.js';
import { currentSettings, updateSettings } from '../src/settings.js';

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'restore-'));

test('restoring a backup brings back shop content but leaves chats, pairing and AI keys alone', async () => {
    const dir = folder();
    const productsBefore = listProducts().length;
    const topicsBefore = listTopics().length;
    saveFaq({ question: 'Pertanyaan yang ada di backup', answer: 'Jawaban lama' });
    const faqBefore = listFaq().length;
    updateSettings({ botName: 'Melati' });
    updateAiSettings({ key: 'key-backup-0000000001' });
    const made = await backup(dir, 14);

    for (const faq of listFaq()) deleteFaq(faq.id);
    for (const topic of listTopics()) run('DELETE FROM store_info WHERE id = ?', [topic.id]);
    run(`DELETE FROM products WHERE "key" = (SELECT "key" FROM products LIMIT 1)`);
    forgetProducts();
    updateSettings({ botName: 'Dahlia' });
    updateAiSettings({ key: 'key-sesudah-000000002' });
    saveConversation('toko', '628111@s.whatsapp.net', { step: 'chat', name: 'Budi' });
    run(`INSERT OR REPLACE INTO settings ("key", value, updated_at) VALUES ('ai:key_state', '{"current":2}', datetime('now'))`);

    assert.equal(listFaq().length, 0);
    assert.equal(listProducts().length, productsBefore - 1);

    const result = await restoreContent(path.basename(made.file), dir);

    assert.equal(listFaq().length, faqBefore);
    assert.ok(listFaq().some((f) => f.question === 'Pertanyaan yang ada di backup'));
    assert.equal(listTopics().length, topicsBefore);
    assert.equal(listProducts().length, productsBefore);
    assert.equal(currentSettings().botName, 'Melati');
    assert.equal(config.bot.botName, 'Melati');
    assert.equal(result.restored.faq, faqBefore);
    assert.ok(result.restored.products >= productsBefore);

    assert.equal(get(`SELECT name FROM conversations WHERE jid = '628111@s.whatsapp.net'`).name, 'Budi', 'conversations are not restored');
    assert.equal(getSetting('ai:ollama_key'), 'key-sesudah-000000002', 'the AI key is not restored');
    assert.equal(getSetting('ai:key_state'), '{"current":2}');

    assert.ok(fs.existsSync(path.join(dir, result.safety)), 'a copy of the state before restoring is kept');
    assert.deepEqual(listBackups(dir).map((b) => b.name), [path.basename(made.file)], 'the safety copy is not offered as a backup');

    updateSettings({ botName: 'Mawar' });
    updateAiSettings({ key: '' });
});

test('only real backup names are accepted and a missing file is refused', async () => {
    const dir = folder();

    await assert.rejects(restoreContent('../../etc/passwd', dir), /tidak valid/);
    await assert.rejects(restoreContent('chatbot-2020-01-01.sqlite', dir), /tidak ditemukan/);
    await assert.rejects(restoreContent('sebelum-pulih-20260101000000.sqlite', dir), /tidak valid/);
});

test('a damaged backup file is refused and nothing changes', async () => {
    const dir = folder();
    const file = path.join(dir, 'chatbot-2026-01-01.sqlite');
    fs.writeFileSync(file, 'ini bukan database sqlite sama sekali');
    const before = listFaq().length;

    await assert.rejects(restoreContent('chatbot-2026-01-01.sqlite', dir));
    assert.equal(listFaq().length, before);
});

test('the list shows newest first and the routes restore through the API', async () => {
    const dir = folder();
    fs.writeFileSync(path.join(dir, 'chatbot-2026-02-01.sqlite'), 'x');
    fs.writeFileSync(path.join(dir, 'chatbot-2026-03-01.sqlite'), 'x');
    fs.writeFileSync(path.join(dir, 'catatan.txt'), 'x');
    assert.deepEqual(listBackups(dir).map((b) => b.date), ['2026-03-01', '2026-02-01']);

    const before = config.maintenance.backupDir;
    config.maintenance.backupDir = dir;
    const { app } = await import('../src/index.js');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;

    try {
        const listed = await (await fetch(`${base}/backups`)).json();
        assert.equal(listed.backups.length, 2);

        const bad = await fetch(`${base}/backups/passwd/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(bad.status, 422);
    } finally {
        config.maintenance.backupDir = before;
        server.close();
    }
});
