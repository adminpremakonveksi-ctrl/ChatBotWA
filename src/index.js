import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { Bot } from './bot/bot.js';
import { aiEnabled } from './bot/classify-ai.js';
import { classifyWithRules } from './bot/classify-rules.js';
import { TEACHABLE, addKeyword, customKeywords, removeKeyword, seedStarterKeywords } from './bot/keywords.js';
import { media } from './bot/media.js';
import { productKeys, productName } from './bot/products.js';
import { listTemplates, render, resetTemplate, templateText, updateTemplate } from './bot/replies.js';
import { isBotActive, localClock, nextChange } from './bot/schedule.js';
import { resetSimulation, simulate } from './bot/simulator.js';
import { analytics, listConversations, loadConversation, markHandover, messagesOf, stats, unrecognised } from './bot/store.js';
import { config, root } from './config.js';
import { db, describeDatabase, getSetting, now, run } from './db.js';
import { logger } from './logger.js';
import { backup, buildRecap, sendTestRecap, startMaintenance } from './maintenance.js';
import { manager } from './manager.js';
import { backupSuggestions, currentSettings, loadSettings, updateSettings } from './settings.js';

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

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

app.get('/health', (req, res) => res.json({ ok: true, botActive: isBotActive(), ai: aiEnabled() }));

app.use(requireApiKey);

/* -------------------------------------------------------------- console --- */

const consolePage = path.join(path.dirname(fileURLToPath(import.meta.url)), 'console.html');

/** Admin console: QR, conversations, try-the-bot, media checklist. */
app.get('/', (req, res) => {
    res.type('html').send(fs.readFileSync(consolePage, 'utf8'));
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
        botName: config.bot.botName,
        csName: config.bot.csName,
        schedule: `aktif Sen–Sab ${config.bot.activeFrom}–${config.bot.activeUntil}, Minggu 24 jam`,
        botActive: isBotActive(),
        nextChange: nextChange()?.toISOString() ?? null,
        activeFrom: config.bot.activeFrom,
        activeUntil: config.bot.activeUntil,
        clock: localClock(new Date(), config.bot.timezone),
        forceMode: config.bot.forceMode || null,
        ai: aiEnabled() ? `AI (${config.ai.model}), cadangan kata kunci` : 'kata kunci saja',
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
    });
}));

/* ------------------------------------------------------------- sessions --- */

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
    run(
        `UPDATE conversations SET step = 'new', product = NULL, return_step = NULL, handed_over_at = NULL, handover_reason = NULL
         WHERE session_key = ? AND jid = ?`,
        [req.params.session, req.params.jid],
    );

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
    const { id, text, hasImage } = req.body ?? {};

    if (!id) return res.status(422).json({ error: 'Butuh "id"' });

    res.json(await simulate(String(id), { text: String(text ?? '').slice(0, 2000), hasImage: Boolean(hasImage) }));
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
    const rows = unrecognised(Number(req.query.days ?? 30)).map((row) => {
        const now = classifyWithRules({ text: row.text, step: 'awaiting_product' });

        return { ...row, nowIntent: now.intent, nowProduct: now.product };
    });

    res.json({ messages: rows });
}));

app.get('/keywords', wrap(async (req, res) => {
    res.json({
        keywords: customKeywords(),
        intents: TEACHABLE,
        products: productKeys.map((key) => ({ key, name: productName(key) })),
    });
}));

app.post('/keywords', wrap(async (req, res) => {
    const phrase = addKeyword(req.body ?? {});

    res.status(201).json({ ok: true, phrase });
}));

app.delete('/keywords/:id', wrap(async (req, res) => {
    removeKeyword(req.params.id);

    res.json({ ok: true });
}));

app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') {
        return res.status(413).json({ error: 'File lebih dari 15 MB' });
    }

    logger.error({ err: error.message }, 'request gagal');
    res.status(error.statusCode ?? 500).json({ error: error.message });
});

/* ----------------------------------------------------------------- boot --- */

const bot = new Bot();

async function main() {
    describeDatabase();
    loadSettings();
    seedStarterKeywords();

    logger.info(
        {
            bot: config.bot.botName,
            cs: config.bot.csName,
            ai: aiEnabled() ? config.ai.model : 'mati (kata kunci saja)',
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

    const missing = media.checklist().filter((item) => !item.ok);
    if (missing.length) {
        logger.warn({ belumAda: missing.map((item) => item.expected) }, `${missing.length} file media belum ada (lihat tab Media di konsol)`);
    }
}

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
