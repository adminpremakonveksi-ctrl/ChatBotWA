import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { Bot } from './bot/bot.js';
import { aiProvider } from './bot/classify.js';
import { catalogStatus, setItemProduct } from './bot/catalog.js';
import { addPatternKeyword, createPattern, deletePattern, getPattern, listPatterns, missingBuiltins, resetPattern, restoreBuiltin, updatePattern } from './bot/patterns.js';
import { classifyWithRules, findPattern, normalise } from './bot/classify-rules.js';
import { TEACHABLE, addKeyword, customKeywords, removeKeyword, updateKeyword } from './bot/keywords.js';
import { media } from './bot/media.js';
import { createProduct, deleteProduct, listProducts, productKeywords, productName, updateProduct } from './bot/products.js';
import { listTemplates, render, resetTemplate, templateText, updateTemplate } from './bot/replies.js';
import { describeHours, holidayOn, isBotActive, localClock, nextChange } from './bot/schedule.js';
import { resetSimulation, simulate } from './bot/simulator.js';
import { analytics, dismissKey, dismissText, dismissedTexts, listConversations, loadConversation, markHandover, messagesOf, resetConversation, stats, suggestPhrase, unrecognised } from './bot/store.js';
import { config, root } from './config.js';
import { db, describeDatabase, getSetting, now, run } from './db.js';
import { logger } from './logger.js';
import { errorsSince, latestErrorId } from './errors.js';
import { describeRequest, listActivity, recordActivity } from './activity.js';
import { WORD_LISTS, addWord, removeWord, updateWord, wordRows } from './bot/words.js';
import { aiSettings, listOllamaModels, loadAiSettings, updateAiSettings } from './ai-settings.js';
import { classifyWithOllama } from './bot/classify-ollama.js';
import { backup, buildRecap, sendTestRecap, startMaintenance } from './maintenance.js';
import { startUpdateCheck, updateStatus } from './update-check.js';
import { startupChecks } from './startup-check.js';
import { manager } from './manager.js';
import { backupSuggestions, currentSettings, loadSettings, updateSettings } from './settings.js';
import { releaseAutoHandovers } from './bot/auto-messages.js';
import { deleteFaq, deleteTopic, listFaq, listTopics, moveTopic, saveFaq, saveTopic } from './bot/knowledge.js';
import { deleteScenario, listScenarios, runScenario, saveScenario } from './bot/ai-scenarios.js';
import { clearAi, listAi } from './bot/ai-log.js';

const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host);

if (!loopback && !config.apiKey) {
    // Listening on the LAN without a key would let anyone there unlink the number.
    throw new Error('HOST bukan localhost, jadi API_KEY wajib diisi');
}

const app = express();
app.use(express.json({ limit: '2mb' }));

const requireApiKey = (req, res, next) => {
    if (config.apiKey && req.get('X-Api-Key') !== config.apiKey && req.query.key !== config.apiKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
};

const VERSION = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

/** What the console shows: keywords always first, the AI only for what they miss. */
const aiLabel = () => {
    const provider = aiProvider();
    if (provider === 'ollama') return `kata kunci + Ollama (${config.ollama.model}) untuk pesan yang tidak dikenali`;

    return 'kata kunci saja';
};

app.get('/health', (req, res) => res.json({ ok: true, botActive: isBotActive(), ai: aiProvider() }));

app.use(requireApiKey);

// Every change made in the console goes to the activity log (Log page), with
// the page it was made on (X-Page, sent by the console). Only what changed is
// written, never the values (keys, texts).
app.use((req, res, next) => {
    if (req.method === 'GET' || req.path === '/activity') return next();

    res.on('finish', () => {
        recordActivity({
            source: 'dashboard',
            page: req.get('X-Page') || null,
            action: describeRequest(req.method, req.path, req.body),
            detail: res.statusCode >= 400 ? `gagal (HTTP ${res.statusCode})` : null,
        });
    });

    next();
});

// The Log page: newest first; a page view is logged by the console itself.
app.get('/activity', wrap(async (req, res) => {
    res.json({ entries: listActivity({ limit: req.query.limit, source: req.query.source || null, q: String(req.query.q ?? '').slice(0, 80) }) });
}));

// The technical log for the developer: the last lines of logs/bot.log (written
// by the auto-start service), as they are.
app.get('/logs/tail', wrap(async (req, res) => {
    const file = path.join(root, 'logs', 'bot.log');
    const lines = Math.min(Number(req.query.lines) || 300, 2000);

    if (!fs.existsSync(file)) return res.json({ file: 'logs/bot.log', exists: false, lines: [] });

    // Only the end of the file: it can grow large between daily clean-ups.
    const size = fs.statSync(file).size;
    const length = Math.min(size, 512 * 1024);
    const handle = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, size - length);
    fs.closeSync(handle);

    const text = buffer.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
    res.json({ file: 'logs/bot.log', exists: true, size, lines: text.split(/\r?\n/).filter(Boolean).slice(-lines) });
}));

app.post('/activity', wrap(async (req, res) => {
    const page = String(req.body?.page ?? '').slice(0, 40);
    if (page) recordActivity({ source: 'dashboard', page, action: `Membuka halaman ${page}` });

    res.json({ ok: true });
}));

// New errors and warnings since the id the console last showed (the error pop-up polls this).
// Behind the API key: stacks and logged details may name customers.
app.get('/errors', (req, res) => res.json({ errors: errorsSince(req.query.after), latest: latestErrorId(), version: VERSION }));

/* -------------------------------------------------------------- console --- */

// Read once at boot: the console always matches the bot that serves it. Read on every
// request, a newer console.html on disk (an Update, an edit) called routes this
// running bot did not have yet: "GET /ai/scenarios (HTTP 404)" (2026-10-27).
const consolePage = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'console.html'), 'utf8');

/** Admin console: QR, conversations, try-the-bot, media checklist. */
app.get('/', (req, res) => {
    res.type('html').send(consolePage);
});

const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

/** Version shown in the console; the commit comes from the last "Update ChatBot Prema". */
const installedVersion = () => {
    try {
        return fs.readFileSync(path.join(root, 'data', 'versi.txt'), 'utf8').trim().slice(0, 7);
    } catch {
        return null;
    }
};

app.get('/info', wrap(async (req, res) => {
    res.json({
        version: packageVersion,
        commit: installedVersion(),
        // A newer version on GitHub (Ringkasan banner); checked every few hours.
        update: updateStatus(),
        botName: config.bot.botName,
        csName: config.bot.csName,
        schedule: describeHours(config.bot.activeFrom, config.bot.activeUntil),
        botActive: isBotActive(),
        nextChange: nextChange()?.toISOString() ?? null,
        activeFrom: config.bot.activeFrom,
        activeUntil: config.bot.activeUntil,
        clock: localClock(new Date(), config.bot.timezone),
        holiday: holidayOn(),
        forceMode: config.bot.forceMode || null,
        ai: aiLabel(),
        botMode: config.bot.mode,
        aiReady: Boolean(aiProvider()),
        // How much of Pengetahuan the team filled in (Kesiapan).
        knowledge: (() => {
            const topics = listTopics();

            return { topics: topics.length, filled: topics.filter((t) => t.content.trim()).length, faq: listFaq().length };
        })(),
        jerseyPromo: Boolean(templateText('jerseyPromo')),
        promoPamphlet: media.has('promo', 'jersey'),
        handoverHours: config.bot.handoverHours,
        recapTo: config.recap.to,
        recapAt: config.recap.at,
        backupDir: config.maintenance.backupDir,
        // A backup inside this folder dies with the PC; the console nags until it points elsewhere.
        backupOutside: !path.resolve(config.maintenance.backupDir).toLowerCase().startsWith(path.resolve(root).toLowerCase()),
        lastBackup: getSetting('backup:last') ?? getSetting('job:backup'),
        mediaMissing: media.checklist().filter((item) => !item.ok).length,
        // For the Log page's "Info untuk developer".
        runtime: {
            node: process.version,
            os: `${os.type()} ${os.release()} (${os.arch()})`,
            host: os.hostname(),
            uptimeMinutes: Math.round(process.uptime() / 60),
            folder: root,
        },
    });
}));

/* ------------------------------------------------------------- sessions --- */

/** "Siap mulai" on Ringkasan: internet, PC clock, WhatsApp, AI, version, checked live. */
app.get('/checks', wrap(async (req, res) => {
    res.json(await startupChecks({ manager, fresh: req.query.fresh === '1' }));
}));

app.get('/sessions', wrap(async (req, res) => {
    res.json({ sessions: manager.list(), botActive: isBotActive() });
}));

app.post('/sessions', wrap(async (req, res) => {
    const { key, label } = req.body ?? {};

    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(key ?? ''))) {
        return res.status(422).json({ error: 'Key hanya boleh huruf kecil, angka dan tanda hubung' });
    }

    if (!label || String(label).trim() === '') {
        return res.status(422).json({ error: 'Label wajib diisi' });
    }

    const session = await manager.create(String(key), String(label).trim());

    res.status(201).json(session.status());
}));

app.get('/sessions/:key', wrap(async (req, res) => {
    res.json(manager.get(req.params.key).status());
}));

app.get('/sessions/:key/qr', wrap(async (req, res) => {
    const session = manager.get(req.params.key);

    if (session.state === 'connected') {
        return res.status(409).json({ error: 'Nomor ini sudah tersambung' });
    }

    if (!session.qr) {
        return res.status(404).json({ error: 'QR belum tersedia' });
    }

    res.json({ qr: session.qr, expiresIn: Math.max(0, (session.qrExpiresAt ?? 0) - Date.now()) });
}));

app.post('/sessions/:key/connect', wrap(async (req, res) => {
    const session = manager.get(req.params.key);

    run('UPDATE wa_sessions SET auto_connect = 1, updated_at = ? WHERE id = ?', [now(), session.id]);
    await session.start();

    res.json(session.status());
}));

app.post('/sessions/:key/disconnect', wrap(async (req, res) => {
    const session = manager.get(req.params.key);

    run('UPDATE wa_sessions SET auto_connect = 0, updated_at = ? WHERE id = ?', [now(), session.id]);
    await session.stop();

    res.json(session.status());
}));

app.post('/sessions/:key/logout', wrap(async (req, res) => {
    await manager.get(req.params.key).logout();

    res.json(manager.get(req.params.key).status());
}));

/** Unlink, then start over so a different number can be scanned in its place. */
app.post('/sessions/:key/rescan', wrap(async (req, res) => {
    const session = manager.get(req.params.key);

    await session.logout();
    await session.start();

    res.json(session.status());
}));

app.delete('/sessions/:key', wrap(async (req, res) => {
    await manager.remove(req.params.key);

    res.json({ ok: true });
}));

/* ---------------------------------------------------------------- stats --- */

/** Messages per day. The volume decides the AI budget, so it is counted from day one. */
app.get('/stats', wrap(async (req, res) => {
    res.json({ days: stats(Number(req.query.days ?? 30)) });
}));

/* -------------------------------------------------------- conversations --- */

app.get('/conversations', wrap(async (req, res) => {
    const hours = Math.min(24 * 90, Math.max(1, Number(req.query.hours ?? 24)));
    const since = new Date(Date.now() - hours * 3600000).toISOString().slice(0, 19).replace('T', ' ');

    res.json({
        conversations: listConversations(since).map((row) => ({ ...row, product_name: row.product ? productName(row.product) : null })),
    });
}));

app.get('/conversations/:session/:jid', wrap(async (req, res) => {
    const { session, jid } = req.params;

    res.json({ conversation: loadConversation(session, jid), messages: messagesOf(session, jid) });
}));

/** Hands a customer back to the bot, e.g. after CS is done or after a test. */
app.post('/conversations/:session/:jid/reset', wrap(async (req, res) => {
    resetConversation(req.params.session, req.params.jid);

    res.json({ ok: true });
}));

/** CS takes a customer over from the console; the bot stops answering them. */
app.post('/conversations/:session/:jid/handover', wrap(async (req, res) => {
    markHandover(req.params.session, req.params.jid, 'diambil alih dari konsol');

    res.json({ ok: true });
}));

app.get('/recap/preview', wrap(async (req, res) => {
    const since = getSetting('recap:last_sent') ?? new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ');

    res.json({ text: buildRecap(since) });
}));

/* ---------------------------------------------------- simulator & media --- */

app.post('/simulate', wrap(async (req, res) => {
    const { id, text, hasImage, hasAudio } = req.body ?? {};

    if (!id) return res.status(422).json({ error: 'Butuh "id"' });

    res.json(await simulate(String(id), { text: String(text ?? '').slice(0, 2000), hasImage: Boolean(hasImage), hasAudio: Boolean(hasAudio) }));
}));

app.post('/simulate/reset', wrap(async (req, res) => {
    resetSimulation(String(req.body?.id ?? ''));

    res.json({ ok: true });
}));

app.get('/media', wrap(async (req, res) => {
    res.json({ slots: media.slots(), items: media.checklist() });
}));

/** Upload from the console: the raw file is the request body, its type is read from its bytes. */
app.post('/media/:slot', express.raw({ type: () => true, limit: '16mb' }), wrap(async (req, res) => {
    const saved = media.save(req.params.slot, req.body);

    logger.info({ slot: req.params.slot, file: path.basename(saved) }, 'media diunggah dari konsol');
    res.status(201).json({ slots: media.slots() });
}));

/* -------------------------------------------------------- answer patterns --- */

const patternView = (p) => ({ ...p, photos: media.files('pola', String(p.id)).map((file) => path.relative(config.mediaDir, file).replace(/\\/g, '/')) });

app.get('/patterns', wrap(async (req, res) => {
    res.json({ patterns: listPatterns().map(patternView), missingBuiltins: missingBuiltins() });
}));

/** "Kembalikan ke bawaan": a seeded pattern back to its original answer and keywords. */
app.post('/patterns/:id/reset', wrap(async (req, res) => {
    res.json({ pattern: patternView(resetPattern(req.params.id)) });
}));

/** Brings back a seeded pattern (Lokasi, ...) the team deleted. */
app.post('/patterns/restore/:builtin', wrap(async (req, res) => {
    const pattern = restoreBuiltin(req.params.builtin);

    res.status(201).json({ pattern: pattern ? patternView(pattern) : null });
}));

app.post('/patterns', wrap(async (req, res) => {
    res.status(201).json({ pattern: patternView(createPattern(req.body?.name)) });
}));

app.put('/patterns/:id', wrap(async (req, res) => {
    const pattern = updatePattern(req.params.id, req.body ?? {});

    logger.info({ pattern: pattern.name }, 'pola jawaban diubah dari konsol');
    res.json({ pattern: patternView(pattern) });
}));

app.delete('/patterns/:id', wrap(async (req, res) => {
    deletePattern(req.params.id);

    res.json({ ok: true });
}));

app.post('/patterns/:id/photos', express.raw({ type: () => true, limit: '16mb' }), wrap(async (req, res) => {
    const pattern = getPattern(req.params.id);
    media.savePattern(pattern.id, req.body);

    res.status(201).json({ pattern: patternView(pattern) });
}));

/** "Coba kalimat": which pattern (if any) a sentence triggers. */
app.post('/patterns/test', wrap(async (req, res) => {
    const hit = findPattern(normalise(String(req.body?.text ?? '').slice(0, 500)));

    res.json({ pattern: hit ? { id: hit.id, name: hit.name } : null });
}));

/* -------------------------------------------- WhatsApp Business catalog --- */

app.get('/catalog', wrap(async (req, res) => {
    res.json(catalogStatus());
}));

app.post('/catalog/sync', wrap(async (req, res) => {
    const count = await (await manager.defaultSession()).syncCatalog();

    res.json({ count, ...catalogStatus() });
}));

/** Correct which product an item belongs to: a product key, 'none', or '' for automatic. */
app.put('/catalog/:id', wrap(async (req, res) => {
    setItemProduct(req.params.id, req.body?.product);

    res.json(catalogStatus());
}));

app.put('/media/:slot/link', wrap(async (req, res) => {
    const url = media.setLink(req.params.slot, req.body?.url);

    logger.info({ slot: req.params.slot, url }, 'link katalog diubah dari konsol');
    res.json({ slots: media.slots() });
}));

app.get('/media/file', wrap(async (req, res) => {
    res.sendFile(media.resolve(req.query.path));
}));

app.delete('/media/file', wrap(async (req, res) => {
    media.remove(req.query.path);

    logger.info({ file: req.query.path }, 'media dihapus dari konsol');
    res.json({ slots: media.slots() });
}));

/* ------------------------------------------------------------ templates --- */

app.get('/templates', wrap(async (req, res) => {
    res.json({ templates: listTemplates() });
}));

app.put('/templates/:key', wrap(async (req, res) => {
    updateTemplate(req.params.key, req.body?.text);

    logger.info({ template: req.params.key }, 'template balasan diubah dari konsol');
    res.json({ templates: listTemplates(), preview: render(req.params.key, { nama: 'Budi', produk: 'Jersey' }) });
}));

app.delete('/templates/:key', wrap(async (req, res) => {
    resetTemplate(req.params.key);

    logger.info({ template: req.params.key }, 'template balasan dikembalikan ke naskah asli');
    res.json({ templates: listTemplates() });
}));

/* ------------------------------------------------------------- settings --- */

app.get('/settings', wrap(async (req, res) => {
    res.json({ values: currentSettings(), backupSuggestions: backupSuggestions(), lastBackup: getSetting('backup:last') ?? getSetting('job:backup') });
}));

/* ------------------------------------------------------------------ AI --- */

app.get('/ai', wrap(async (req, res) => res.json(aiSettings())));

app.put('/ai', wrap(async (req, res) => {
    const settings = updateAiSettings(req.body ?? {});

    logger.info({ model: settings.model, host: settings.host, key: settings.keySource }, 'pengaturan AI diubah dari konsol');
    res.json(settings);
}));

// "Tes koneksi": the models on offer, and one real label for a sample message.
app.post('/ai/test', wrap(async (req, res) => {
    if (!aiProvider()) throw Object.assign(new Error('Isi dulu kunci API Ollama (atau alamat Ollama lokal), lalu Simpan'), { statusCode: 422 });

    const models = await listOllamaModels();
    const text = String(req.body?.text || 'mas, menawi kulo mundhut kaos saged dikintun dumugi Makassar?');
    const started = Date.now();
    const result = await classifyWithOllama({ text, step: 'awaiting_product' });

    res.json({ models, text, intent: result.intent, product: result.product, extras: result.extras, ms: Date.now() - started, model: config.ollama.model });
}));

app.put('/settings', wrap(async (req, res) => {
    const values = updateSettings(req.body ?? {});

    logger.info({ fields: Object.keys(req.body ?? {}) }, 'pengaturan diubah dari konsol');
    res.json({ values });
}));

app.post('/backup/now', wrap(async (req, res) => {
    const result = await backup();

    res.json({ file: result.file });
}));

app.post('/recap/test', wrap(async (req, res) => {
    res.json({ sent: await sendTestRecap({ manager, bot }) });
}));

/* ------------------------------------------------- teaching & analytics --- */

app.get('/analytics', wrap(async (req, res) => {
    res.json(analytics(Math.min(90, Math.max(7, Number(req.query.days ?? 30)))));
}));

/** Messages the bot did not understand, and whether today's keywords would catch them. */
app.get('/unrecognised', wrap(async (req, res) => {
    const hidden = new Set(dismissedTexts());
    const rows = unrecognised(Number(req.query.days ?? 30)).map((row) => {
        const now = classifyWithRules({ text: row.text, step: 'awaiting_product' });

        return {
            ...row,
            nowIntent: now.intent,
            nowProduct: now.product,
            nowPattern: now.pattern?.name ?? null,
            suggest: suggestPhrase(row.text),
            dismissed: hidden.has(dismissKey(row.text)),
        };
    });

    res.json({ messages: rows });
}));

// "Abaikan" in Latih bot: a message that is CS's job (DP, a complaint) leaves the list; "Pulihkan" brings it back.
app.post('/unrecognised/dismiss', wrap(async (req, res) => {
    dismissText(req.body?.text, req.body?.undo === true);

    res.json({ ok: true });
}));

app.get('/keywords', wrap(async (req, res) => {
    res.json({
        keywords: customKeywords(),
        intents: TEACHABLE,
        patterns: listPatterns().map((p) => ({ id: p.id, name: p.name })),
        products: listProducts().map((p) => ({ key: p.key, name: p.name })),
    });
}));

app.post('/keywords', wrap(async (req, res) => {
    const target = String(req.body?.intent ?? '');

    if (target.startsWith('pola:')) {
        const pattern = addPatternKeyword(target.slice(5), req.body?.phrase);

        return res.status(201).json({ ok: true, phrase: pattern.keywords.at(-1), pattern: pattern.name });
    }

    const phrase = addKeyword(req.body ?? {});

    res.status(201).json({ ok: true, phrase });
}));

app.put('/keywords/:id', wrap(async (req, res) => {
    res.json({ ok: true, phrase: updateKeyword(req.params.id, req.body ?? {}) });
}));

app.delete('/keywords/:id', wrap(async (req, res) => {
    removeKeyword(req.params.id);

    res.json({ ok: true });
}));

/* --------------------------------------------------------------- Kamus --- */

// Every word list the bot reads (dictionary, fillers, cities, units, ...): see src/bot/words.js.
app.get('/words', wrap(async (req, res) => {
    const counts = Object.fromEntries(Object.keys(WORD_LISTS).map((name) => [name, wordRows(name).length]));

    res.json({ lists: Object.entries(WORD_LISTS).map(([name, meta]) => ({ name, ...meta, count: counts[name] })), words: req.query.list ? wordRows(String(req.query.list)) : [] });
}));

app.post('/words', wrap(async (req, res) => {
    const word = addWord(req.body ?? {});

    logger.info({ list: word.list, word: word.word }, 'kata ditambah ke kamus dari konsol');
    res.status(201).json({ word });
}));

app.put('/words/:id', wrap(async (req, res) => {
    res.json({ word: updateWord(req.params.id, req.body ?? {}) });
}));

app.delete('/words/:id', wrap(async (req, res) => {
    removeWord(req.params.id);

    res.json({ ok: true });
}));

/* ------------------------------------------------------------- products --- */

const productView = (p) => ({ ...p, keywords: productKeywords(p.key) });

app.get('/products', wrap(async (req, res) => {
    res.json({ products: listProducts().map(productView) });
}));

app.post('/products', wrap(async (req, res) => {
    const { product, taken } = createProduct(req.body ?? {});

    logger.info({ product: product.key }, 'produk ditambah dari konsol');
    res.status(201).json({ product: productView(product), taken });
}));

app.put('/products/:key', wrap(async (req, res) => {
    const { product, taken } = updateProduct(req.params.key, req.body ?? {});

    logger.info({ product: product.key }, 'produk diubah dari konsol');
    res.json({ product: productView(product), taken });
}));

app.delete('/products/:key', wrap(async (req, res) => {
    deleteProduct(req.params.key);

    logger.info({ product: req.params.key }, 'produk dihapus dari konsol');
    res.json({ ok: true });
}));

// Uji AI: the team's test chats, run through the real AI turn (nothing sent), and what the guards stopped.
app.get('/ai/scenarios', wrap(async (req, res) => {
    res.json({ scenarios: listScenarios() });
}));

app.post('/ai/scenarios', wrap(async (req, res) => {
    res.status(201).json({ scenario: saveScenario({ ...(req.body ?? {}), id: null }) });
}));

app.put('/ai/scenarios/:id', wrap(async (req, res) => {
    res.json({ scenario: saveScenario({ ...(req.body ?? {}), id: Number(req.params.id) }) });
}));

app.delete('/ai/scenarios/:id', wrap(async (req, res) => {
    deleteScenario(Number(req.params.id));
    res.json({ ok: true });
}));

app.post('/ai/scenarios/:id/run', wrap(async (req, res) => {
    if (!aiProvider()) throw Object.assign(new Error('Isi dulu kunci API Ollama di Pengaturan > AI, lalu Simpan'), { statusCode: 422 });

    res.json(await runScenario(Number(req.params.id), { media }));
}));

app.get('/ai/log', wrap(async (req, res) => {
    res.json({ log: listAi(Math.min(500, Number(req.query.limit) || 100)) });
}));

app.delete('/ai/log', wrap(async (req, res) => {
    clearAi();
    res.json({ ok: true });
}));

// What the AI chat knows (Pengetahuan): shop topics and Q&A; product details live on /products.
app.get('/knowledge', wrap(async (req, res) => {
    res.json({ topics: listTopics(), faq: listFaq() });
}));

app.post('/knowledge/topics', wrap(async (req, res) => {
    res.status(201).json({ topic: saveTopic({ ...(req.body ?? {}), id: null }) });
}));

app.put('/knowledge/topics/:id', wrap(async (req, res) => {
    res.json({ topic: saveTopic({ ...(req.body ?? {}), id: Number(req.params.id) }) });
}));

app.post('/knowledge/topics/:id/move', wrap(async (req, res) => {
    res.json({ topics: moveTopic(Number(req.params.id), Number(req.body?.by) || 0) });
}));

app.delete('/knowledge/topics/:id', wrap(async (req, res) => {
    deleteTopic(Number(req.params.id));
    res.json({ ok: true });
}));

app.post('/knowledge/faq', wrap(async (req, res) => {
    res.status(201).json({ faq: saveFaq({ ...(req.body ?? {}), id: null }) });
}));

app.put('/knowledge/faq/:id', wrap(async (req, res) => {
    res.json({ faq: saveFaq({ ...(req.body ?? {}), id: Number(req.params.id) }) });
}));

app.delete('/knowledge/faq/:id', wrap(async (req, res) => {
    deleteFaq(Number(req.params.id));
    res.json({ ok: true });
}));

// Errors go back raw, with where and when, so the console can show them as they are.
app.use((error, req, res, next) => {
    const status = error.type === 'entity.too.large' ? 413 : error.statusCode ?? 500;
    const message = error.type === 'entity.too.large' ? 'File lebih dari 15 MB' : error.message;
    const detail = {
        status,
        method: req.method,
        path: req.originalUrl,
        time: new Date().toISOString().replace('T', ' ').slice(0, 19),
        name: error.name,
        code: error.code,
        // A server fault shows its stack; a refused input (4xx) only its reason.
        stack: status >= 500 ? error.stack : undefined,
    };

    if (status >= 500) logger.error({ err: error.message, stack: error.stack, path: req.originalUrl, method: req.method }, 'request gagal');
    else logger.info({ err: error.message, path: req.originalUrl, status }, 'request ditolak');

    res.status(status).json({ error: message, detail });
});

/* ----------------------------------------------------------------- boot --- */

const bot = new Bot();

async function main() {
    describeDatabase();
    loadSettings();
    loadAiSettings();
    // Chats handed to CS only because a WhatsApp Business automatic message was taken for CS.
    const released = releaseAutoHandovers();
    if (released.length) logger.info({ chat: released.length }, 'chat dikembalikan ke bot: yang dikira CS ternyata pesan otomatis');

    logger.info(
        {
            bot: config.bot.botName,
            cs: config.bot.csName,
            ai: aiLabel(),
            jamAktif: `Sen-Sab ${config.bot.activeFrom}-${config.bot.activeUntil}, Minggu 24 jam`,
            rekap: config.recap.to.length ? `${config.recap.at} ke ${config.recap.to.join(', ')}` : 'mati',
            backup: `${config.maintenance.backupAt} ke ${config.maintenance.backupDir}`,
            aktifSekarang: isBotActive(),
        },
        'konfigurasi bot',
    );

    // Listen before touching WhatsApp: a busy port means another bot is
    // already running, and two bots on one number fight over the socket.
    await new Promise((resolve, reject) => {
        const server = app.listen(config.port, config.host);
        server.once('listening', resolve);
        server.once('error', (error) =>
            reject(error.code === 'EADDRINUSE'
                ? new Error(`Port ${config.port} sudah dipakai: bot lain sedang jalan? Hentikan dulu, atau ganti PORT di .env.`)
                : error));
    });

    logger.info({ url: `http://${config.host}:${config.port}/` }, 'ChatBot Prema berjalan');

    await manager.boot(bot);
    startMaintenance({ manager, bot });
    startUpdateCheck();

    const missing = media.checklist().filter((item) => !item.ok);
    if (missing.length) {
        logger.warn({ quiet: true, belumAda: missing.map((item) => item.expected) }, `${missing.length} file media belum ada (lihat tab Media di konsol)`);
    }
}

// Anything unexpected is logged first (so it reaches the console pop-up and
// logs/bot.log), then the process exits as Node would: the launcher's service
// loop starts a fresh bot, instead of a half-broken one holding the port.
const crash = (label) => (reason) => {
    logger.error({ err: reason?.message ?? String(reason), stack: reason?.stack }, label);
    setTimeout(() => process.exit(1), 500).unref();
};
process.on('unhandledRejection', crash('error tak tertangani (promise), bot dinyalakan ulang'));
process.on('uncaughtException', crash('error tak tertangani, bot dinyalakan ulang'));

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
        logger.info('menutup bot');
        await bot.drain().catch(() => {});
        await manager.shutdown();
        db.close();
        process.exit(0);
    });
}

main().catch((error) => {
    logger.error(error, 'bot gagal start');
    process.exit(1);
});
