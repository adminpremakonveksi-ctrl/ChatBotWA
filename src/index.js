import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { Bot } from './bot/bot.js';
import { aiProvider } from './bot/classify.js';
import { catalogStatus, setItemProduct } from './bot/catalog.js';
import { media } from './bot/media.js';
import { createProduct, deleteProduct, listProducts, productKeywords, productName, updateProduct } from './bot/products.js';
import { listTemplates, render, resetTemplate, updateTemplate } from './bot/replies.js';
import { describeHours, holidayOn, isBotActive, localClock, nextChange } from './bot/schedule.js';
import { resetSimulation, simulate } from './bot/simulator.js';
import { analytics, listConversations, loadConversation, markHandover, messagesOf, resetConversation, stats } from './bot/store.js';
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
import { deletePromotion, listPromotions, promotionActive, savePromotion } from './bot/promotions.js';

const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host);

if (!loopback && !config.apiKey) {
    throw new Error('HOST bukan localhost, jadi API_KEY wajib diisi');
}

export const app = express();
app.use(express.json({ limit: '2mb' }));

const requireApiKey = (req, res, next) => {
    if (config.apiKey && req.get('X-Api-Key') !== config.apiKey && req.query.key !== config.apiKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
};

const VERSION = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

const aiLabel = () => {
    const provider = aiProvider();
    if (provider === 'ollama') return `AI Ollama (${config.ollama.model}), dari pengetahuan toko`;

    return 'AI belum terhubung';
};

app.get('/health', (req, res) => res.json({ ok: true, botActive: isBotActive(), ai: aiProvider() }));

app.use(requireApiKey);

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

app.get('/activity', wrap(async (req, res) => {
    res.json({ entries: listActivity({ limit: req.query.limit, source: req.query.source || null, q: String(req.query.q ?? '').slice(0, 80) }) });
}));

app.get('/logs/tail', wrap(async (req, res) => {
    const file = path.join(root, 'logs', 'bot.log');
    const lines = Math.min(Number(req.query.lines) || 300, 2000);

    if (!fs.existsSync(file)) return res.json({ file: 'logs/bot.log', exists: false, lines: [] });

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

app.get('/errors', (req, res) => res.json({ errors: errorsSince(req.query.after), latest: latestErrorId(), version: VERSION }));


const consolePage = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'console.html'), 'utf8');

app.get('/', (req, res) => {
    res.type('html').send(consolePage);
});

const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

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
        knowledge: (() => {
            const topics = listTopics();

            return { topics: topics.length, filled: topics.filter((t) => t.content.trim()).length, faq: listFaq().length };
        })(),
        activePromotions: listPromotions().filter((p) => promotionActive(p)).length,
        handoverHours: config.bot.handoverHours,
        recapTo: config.recap.to,
        recapAt: config.recap.at,
        backupDir: config.maintenance.backupDir,
        backupOutside: !path.resolve(config.maintenance.backupDir).toLowerCase().startsWith(path.resolve(root).toLowerCase()),
        lastBackup: getSetting('backup:last') ?? getSetting('job:backup'),
        mediaMissing: media.checklist().filter((item) => !item.ok).length,
        runtime: {
            node: process.version,
            os: `${os.type()} ${os.release()} (${os.arch()})`,
            host: os.hostname(),
            uptimeMinutes: Math.round(process.uptime() / 60),
            folder: root,
        },
    });
}));


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


app.get('/stats', wrap(async (req, res) => {
    res.json({ days: stats(Number(req.query.days ?? 30)) });
}));


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

app.post('/conversations/:session/:jid/reset', wrap(async (req, res) => {
    resetConversation(req.params.session, req.params.jid);

    res.json({ ok: true });
}));

app.post('/conversations/:session/:jid/handover', wrap(async (req, res) => {
    markHandover(req.params.session, req.params.jid, 'diambil alih dari konsol');

    res.json({ ok: true });
}));

app.get('/recap/preview', wrap(async (req, res) => {
    const since = getSetting('recap:last_sent') ?? new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ');

    res.json({ text: buildRecap(since) });
}));


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

app.post('/media/:slot', express.raw({ type: () => true, limit: '16mb' }), wrap(async (req, res) => {
    const saved = media.save(req.params.slot, req.body);

    logger.info({ slot: req.params.slot, file: path.basename(saved) }, 'media diunggah dari konsol');
    res.status(201).json({ slots: media.slots() });
}));



app.get('/catalog', wrap(async (req, res) => {
    res.json(catalogStatus());
}));

app.post('/catalog/sync', wrap(async (req, res) => {
    const count = await (await manager.defaultSession()).syncCatalog();

    res.json({ count, ...catalogStatus() });
}));

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


app.get('/settings', wrap(async (req, res) => {
    res.json({ values: currentSettings(), backupSuggestions: backupSuggestions(), lastBackup: getSetting('backup:last') ?? getSetting('job:backup') });
}));


app.get('/ai', wrap(async (req, res) => res.json(aiSettings())));

app.put('/ai', wrap(async (req, res) => {
    const settings = updateAiSettings(req.body ?? {});

    logger.info({ model: settings.model, host: settings.host, key: settings.keySource }, 'pengaturan AI diubah dari konsol');
    res.json(settings);
}));

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


app.get('/analytics', wrap(async (req, res) => {
    res.json(analytics(Math.min(90, Math.max(7, Number(req.query.days ?? 30)))));
}));



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

app.get('/promotions', wrap(async (req, res) => {
    res.json({ promotions: listPromotions().map((p) => ({ ...p, active: promotionActive(p) })) });
}));
app.post('/promotions', wrap(async (req, res) => {
    res.status(201).json({ promotion: savePromotion({ ...(req.body ?? {}), id: null }) });
}));
app.put('/promotions/:id', wrap(async (req, res) => {
    res.json({ promotion: savePromotion({ ...(req.body ?? {}), id: Number(req.params.id) }) });
}));
app.delete('/promotions/:id', wrap(async (req, res) => {
    deletePromotion(Number(req.params.id));
    res.json({ ok: true });
}));

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
        stack: status >= 500 ? error.stack : undefined,
    };

    if (status >= 500) logger.error({ err: error.message, stack: error.stack, path: req.originalUrl, method: req.method }, 'request gagal');
    else logger.info({ err: error.message, path: req.originalUrl, status }, 'request ditolak');

    res.status(status).json({ error: message, detail });
});


const bot = new Bot();

async function main() {
    describeDatabase();
    loadSettings();
    loadAiSettings();
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

const crash = (label) => (reason) => {
    logger.error({ err: reason?.message ?? String(reason), stack: reason?.stack }, label);
    setTimeout(() => process.exit(1), 500).unref();
};
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.on('unhandledRejection', crash('error tak tertangani (promise), bot dinyalakan ulang'));
    process.on('uncaughtException', crash('error tak tertangani, bot dinyalakan ulang'));
    let shuttingDown = false;
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, async () => {
            if (shuttingDown) return;
            shuttingDown = true;
            logger.info('menutup bot');
            await manager.shutdown();
            await bot.drain().catch(() => {});
            db.close();
            process.exit(0);
        });
    }
    main().catch((error) => {
        logger.error(error, 'bot gagal start');
        process.exit(1);
    });
}
