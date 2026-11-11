import { createHash } from 'node:crypto';

import { config } from './config.js';
import { getSetting, setSetting } from './db.js';
import { errorsSince, latestErrorId } from './errors.js';
import { logger } from './logger.js';

const log = logger.child({ part: 'alerts' });

export const REPEAT_AFTER_MS = 6 * 3600000;
export const GAP_MS = 10 * 60000;
const MAX_ITEMS = 3;
const SENT_KEY = 'alert:sent';
const SEEN_KEY = 'alert:connected_at';

const state = { cursor: 0 };

export const resetAlertState = (cursor = 0) => {
    state.cursor = cursor;
};

const readSent = () => {
    try {
        return JSON.parse(getSetting(SENT_KEY) || '{}');
    } catch {
        return {};
    }
};

const clock = (date) => new Intl.DateTimeFormat('id-ID', { timeZone: config.bot.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date).replace(':', '.');

const length = (ms) => {
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes} menit`;

    return `${Math.floor(minutes / 60)} jam${minutes % 60 ? ` ${minutes % 60} menit` : ''}`;
};

export function actionAlerts(entries, sent, at = Date.now()) {
    const fresh = new Map();

    for (const entry of entries) {
        if (entry.guide?.level !== 'tindak' || !entry.guide.known || !entry.guide.push) continue;
        const key = entry.guide.meaning;
        if (fresh.has(key) || at - (sent[key] ?? 0) < REPEAT_AFTER_MS) continue;
        fresh.set(key, entry.guide);
    }

    return [...fresh.entries()].slice(0, MAX_ITEMS).map(([key, guide]) => ({ key, meaning: guide.meaning, todo: guide.todo }));
}

export function actionText(items) {
    const blocks = items.map((item) => `*${item.meaning}*\n${item.todo}`).join('\n\n');

    return `⚠️ ${config.bot.botName} perlu dicek\n\n${blocks}\n\nRincian lengkap ada di dashboard bot, halaman Ringkasan.`;
}

export function gapText(from, to) {
    return `ℹ️ ${config.bot.botName} sempat tidak tersambung ke WhatsApp sekitar ${length(to - from)} (${clock(new Date(from))} sampai ${clock(new Date(to))}). Pelanggan yang menulis di jam itu belum dibalas bot. Cek chat masuk pada jam tersebut di WhatsApp Business. Sekarang bot sudah tersambung lagi.`;
}

async function deliver({ session, bot }, text, tag) {
    for (const number of config.recap.to) {
        const id = `3EB0${createHash('sha256').update(`${session.key}|${tag}|${number}|${text}`).digest('hex').slice(0, 28).toUpperCase()}`;
        await bot.sendNotice(session.key, session, `${number}@s.whatsapp.net`, text, id);
    }
}

export async function checkAlerts({ manager, bot }, at = Date.now()) {
    if (!config.recap.alerts || !config.recap.to.length) {
        state.cursor = latestErrorId();

        return { sent: [] };
    }

    const session = await manager.defaultSession().catch(() => null);
    if (!session || session.state !== 'connected') return { sent: [] };

    const sent = [];
    const lastSeen = Number(getSetting(SEEN_KEY) || 0);

    if (lastSeen && at - lastSeen >= GAP_MS) {
        await deliver({ session, bot }, gapText(lastSeen, at), `gap-${lastSeen}`);
        sent.push('terputus');
    }
    setSetting(SEEN_KEY, String(at));

    const remembered = readSent();
    const entries = errorsSince(state.cursor);
    const items = actionAlerts(entries, remembered, at);

    if (items.length) {
        await deliver({ session, bot }, actionText(items), `act-${at}`);
        for (const item of items) remembered[item.key] = at;
        setSetting(SENT_KEY, JSON.stringify(remembered));
        sent.push(...items.map((item) => item.meaning));
    }

    state.cursor = latestErrorId();

    return { sent };
}

export function startAlerts({ manager, bot }) {
    let running = false;

    const tick = async () => {
        if (running) return;
        running = true;

        try {
            const { sent } = await checkAlerts({ manager, bot });
            if (sent.length) log.info({ sent }, 'peringatan dikirim ke pemilik');
        } catch (error) {
            log.info({ err: error.message }, 'peringatan ke pemilik belum terkirim, dicoba lagi');
        } finally {
            running = false;
        }
    };

    const first = setTimeout(tick, 45000);
    const timer = setInterval(tick, 60000);

    return () => {
        clearTimeout(first);
        clearInterval(timer);
    };
}
