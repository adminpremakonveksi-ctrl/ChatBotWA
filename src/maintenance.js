import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { pruneActivity } from './activity.js';
import { localClock } from './bot/schedule.js';
import { listConversations, phoneOf, prune } from './bot/store.js';
import { productName } from './bot/products.js';
import { config } from './config.js';
import { db, getSetting, now, setSetting } from './db.js';
import { logger } from './logger.js';
import { pruneRetryMessages } from './delivery.js';


const log = logger.child({ part: 'maintenance' });

const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm).split(/[:.]/).map(Number);

    return h * 60 + (m || 0);
};

export const localDate = (date = new Date()) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: config.bot.timezone }).format(date);


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

    setSetting('backup:last', new Intl.DateTimeFormat('id-ID', { timeZone: config.bot.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date()));

    return { file, removed: old.length };
}


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
        }
        const details = answers.map((d) => `\n   - ${String(d.a).slice(0, 80)}`).join('');
        let notes = [];
        try {
            notes = JSON.parse(row.notes ?? '[]');
        } catch {
        }
        let order = null;
        try {
            order = JSON.parse(row.order_info ?? 'null');
        } catch {
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

async function sendToRecap({ manager, bot }, text) {
    const session = await manager.defaultSession();

    for (const number of config.recap.to) {
        await bot.sendNotice(session.key, session, `${number}@s.whatsapp.net`, text);
    }
}

export async function sendTestRecap({ manager, bot }) {
    if (!config.recap.to.length) throw Object.assign(new Error('Isi dulu nomor penerima rekap'), { statusCode: 422 });

    const since = getSetting('recap:last_sent') ?? new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const text = buildRecap(since) ?? `Tes rekap ${config.bot.botName} berhasil. Saat ini belum ada pelanggan yang perlu ditindaklanjuti.`;

    await sendToRecap({ manager, bot }, `[TES] ${text}`);

    return config.recap.to.length;
}

export async function recap({ manager, bot }) {
    if (!config.recap.to.length) return 'dilewati (nomor rekap kosong)';

    const since = getSetting('recap:last_sent') ?? new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ');
    let pending = JSON.parse(getSetting('recap:pending') || 'null');
    const text = pending?.text ?? buildRecap(since);
    const sentAt = pending?.sentAt ?? now();

    if (!text) {
        setSetting('recap:last_sent', sentAt);

        return 'tidak ada pelanggan semalam';
    }

    if (!pending) {
        pending = { text, sentAt, recipients: [...config.recap.to] };
        setSetting('recap:pending', JSON.stringify(pending));
    }
    const session = await manager.defaultSession();
    for (const number of pending.recipients) {
        const id = '3EB0' + createHash('sha256').update(`${session.key}|${sentAt}|${number}|${text}`).digest('hex').slice(0, 28).toUpperCase();
        await bot.sendNotice(session.key, session, `${number}@s.whatsapp.net`, text, id);
    }

    setSetting('recap:last_sent', sentAt);
    setSetting('recap:pending', '');

    return `terkirim ke ${config.recap.to.length} nomor`;
}


export function startMaintenance({ manager, bot }) {
    const jobs = [
        { name: 'backup', at: () => config.maintenance.backupAt, run: () => backup().then((r) => `${r.file} (${r.removed} lama dihapus)`) },
        { name: 'prune', at: () => config.maintenance.backupAt, run: async () => { pruneRetryMessages(); return JSON.stringify({ ...prune(config.maintenance.logKeepDays), aktivitas: pruneActivity(config.maintenance.logKeepDays) }); } },
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
                log.warn({ job: job.name, err: error.message }, 'tugas harian gagal, dicoba lagi nanti');
            } finally {
                running.delete(job.name);
            }
        }
    };

    const first = setTimeout(tick, 60000);
    const timer = setInterval(tick, 5 * 60000);

    return () => {
        clearTimeout(first);
        clearInterval(timer);
    };
}
