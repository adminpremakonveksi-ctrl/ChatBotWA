import fs from 'node:fs';
import path from 'node:path';

import { pruneActivity } from './activity.js';
import { localClock } from './bot/schedule.js';
import { listConversations, phoneOf, prune } from './bot/store.js';
import { productName } from './bot/products.js';
import { config } from './config.js';
import { db, getSetting, now, setSetting } from './db.js';
import { logger } from './logger.js';

/**
 * Daily jobs, run inside the bot process so there is nothing extra to install:
 *  - backup  copy the database to BACKUP_DIR, keep BACKUP_KEEP_DAYS copies
 *  - prune   delete chat text older than LOG_KEEP_DAYS
 *  - recap   morning list of overnight customers for CS (REKAP_KE)
 *
 * A job runs once per local day at or after its time, so a PC that was off at
 * 03.00 still backs up when it comes back.
 */

const log = logger.child({ part: 'maintenance' });

const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm).split(/[:.]/).map(Number);

    return h * 60 + (m || 0);
};

/** Local calendar date, YYYY-MM-DD, in the shop's timezone. */
export const localDate = (date = new Date()) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: config.bot.timezone }).format(date);

/* --------------------------------------------------------------- backup --- */

export async function backup(dir = config.maintenance.backupDir, keepDays = config.maintenance.backupKeepDays) {
    fs.mkdirSync(dir, { recursive: true });

    const file = path.join(dir, `chatbot-${localDate()}.sqlite`);
    await db.backup(file);

    const old = fs
        .readdirSync(dir)
        .filter((name) => /^chatbot-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name))
        .sort()
        .reverse()
        .slice(keepDays);

    for (const name of old) fs.rmSync(path.join(dir, name), { force: true });

    // Shown in the console, for scheduled and "Backup sekarang" runs alike.
    setSetting('backup:last', new Intl.DateTimeFormat('id-ID', { timeZone: config.bot.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date()));

    return { file, removed: old.length };
}

/* ---------------------------------------------------------------- recap --- */

const STEP_LABEL = {
    new: 'baru menyapa',
    awaiting_intro: 'belum memperkenalkan diri',
    awaiting_product: 'belum menyebut produk',
    awaiting_design: 'ditanya desain, belum menjawab',
    awaiting_quantity: 'ditanya jumlah, belum menjawab',
    awaiting_size_chart_product: 'minta size chart, belum menyebut produk',
    awaiting_detail: 'ditanya detail produk, belum menjawab',
};

const describe = (row) => {
    if (row.step !== 'handed_over') return STEP_LABEL[row.step] ?? row.step;
    if (row.handover_reason === 'alur selesai') return 'alur selesai, menunggu CS';
    if (row.handover_reason === 'CS membalas') return 'sudah dibalas CS';

    return 'pertanyaan di luar naskah, perlu CS';
};

/** Text of the morning recap, or null when nobody chatted. */
export function buildRecap(since) {
    const rows = listConversations(since).filter((row) => row.handover_reason !== 'CS membalas');

    if (!rows.length) return null;

    const lines = rows.map((row, index) => {
        const who = row.name ? `Kak ${row.name}${row.origin ? ` (${row.origin})` : ''}` : 'Tanpa nama';
        const product = row.product ? ` · ${productName(row.product)}${row.quantity ? ` ${row.quantity}` : ''}` : '';
        let answers = [];
        try {
            answers = JSON.parse(row.details ?? '[]');
        } catch {
            /* none */
        }
        const details = answers.map((d) => `\n   - ${String(d.a).slice(0, 80)}`).join('');
        let notes = [];
        try {
            notes = JSON.parse(row.notes ?? '[]');
        } catch {
            /* none */
        }
        // AI mode: what the customer answered per item, and the AI's note (its first note repeats the answers).
        let order = null;
        try {
            order = JSON.parse(row.order_info ?? 'null');
        } catch {
            /* none */
        }
        const ordered = order?.jawaban ? Object.entries(order.jawaban).map(([hal, isi]) => `\n   - ${hal}: ${String(isi).slice(0, 80)}`).join('') : '';
        if (order) notes = notes.filter((n) => !String(n).startsWith('Pesanan '));
        const questions = ordered + notes.map((n) => `\n   ${order ? '📝' : '❓'} ${String(n).slice(0, 160)}`).join('');
        const contact = row.phone ? `wa.me/${row.phone}` : 'nomor disembunyikan WhatsApp, cari di daftar chat';
        const last = row.last_text ? `\n   "${row.last_text.slice(0, 120)}${row.last_text.length > 120 ? '…' : ''}"` : '';

        return `${index + 1}. ${who}${product}${details}${questions}\n   ${describe(row)}\n   ${contact}${last}`;
    });

    return `Rekap ${config.bot.botName} semalam: ${rows.length} pelanggan perlu ditindaklanjuti\n\n${lines.join('\n\n')}`;
}

/** Sends a message to every recap number through the default WhatsApp number. */
async function sendToRecap({ manager, bot }, text) {
    const session = await manager.defaultSession();

    for (const number of config.recap.to) {
        await bot.sendNotice(session.key, session, `${number}@s.whatsapp.net`, text);
    }
}

/** "Kirim rekap uji" in the console: proves the number and WhatsApp work, without moving the recap window. */
export async function sendTestRecap({ manager, bot }) {
    if (!config.recap.to.length) throw Object.assign(new Error('Isi dulu nomor penerima rekap'), { statusCode: 422 });

    const since = getSetting('recap:last_sent') ?? new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const text = buildRecap(since) ?? `Tes rekap ${config.bot.botName} berhasil. Saat ini belum ada pelanggan yang perlu ditindaklanjuti.`;

    await sendToRecap({ manager, bot }, `[TES] ${text}`);

    return config.recap.to.length;
}

async function recap({ manager, bot }) {
    if (!config.recap.to.length) return 'dilewati (nomor rekap kosong)';

    // Everything since the previous recap; the first one covers the last 24 hours.
    const since = getSetting('recap:last_sent') ?? new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const text = buildRecap(since);
    const sentAt = now();

    if (!text) {
        setSetting('recap:last_sent', sentAt);

        return 'tidak ada pelanggan semalam';
    }

    await sendToRecap({ manager, bot }, text);

    setSetting('recap:last_sent', sentAt);

    return `terkirim ke ${config.recap.to.length} nomor`;
}

/* ------------------------------------------------------------ scheduler --- */

export function startMaintenance({ manager, bot }) {
    const jobs = [
        // Times are read on every tick, so a change in the console applies at once.
        { name: 'backup', at: () => config.maintenance.backupAt, run: () => backup().then((r) => `${r.file} (${r.removed} lama dihapus)`) },
        { name: 'prune', at: () => config.maintenance.backupAt, run: async () => JSON.stringify({ ...prune(config.maintenance.logKeepDays), aktivitas: pruneActivity(config.maintenance.logKeepDays) }) },
        // Sunday is a 24-hour bot day, so Monday's recap covers Saturday night and Sunday.
        { name: 'recap', at: () => config.recap.at, skipSunday: true, run: () => recap({ manager, bot }) },
    ];

    const running = new Set();

    const tick = async () => {
        const today = localDate();
        const { day, minutes } = localClock(new Date(), config.bot.timezone);

        for (const job of jobs) {
            if (running.has(job.name)) continue;
            if (job.skipSunday && day === 0) continue;
            if (minutes < toMinutes(job.at())) continue;
            if (getSetting(`job:${job.name}`) === today) continue;

            running.add(job.name);

            try {
                const result = await job.run();
                setSetting(`job:${job.name}`, today);
                log.info({ job: job.name, result }, 'tugas harian selesai');
            } catch (error) {
                // Not marked done: retried on the next tick (e.g. WhatsApp reconnecting).
                log.warn({ job: job.name, err: error.message }, 'tugas harian gagal, dicoba lagi nanti');
            } finally {
                running.delete(job.name);
            }
        }
    };

    // Give WhatsApp time to connect before the first run.
    const first = setTimeout(tick, 60000);
    const timer = setInterval(tick, 5 * 60000);

    return () => {
        clearTimeout(first);
        clearInterval(timer);
    };
}
