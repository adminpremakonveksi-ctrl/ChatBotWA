import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { config, root } from './config.js';
import { all, setSetting } from './db.js';

/**
 * Settings the team changes from the console, so nobody has to edit .env.
 * Stored in the bot's own database and applied to the running config at once;
 * .env only supplies the first defaults.
 */

const fail = (message) => {
    throw Object.assign(new Error(message), { statusCode: 422 });
};

const time = (label) => (value) => {
    const match = String(value ?? '').trim().replace('.', ':').match(/^(\d{1,2}):(\d{2})$/);

    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) fail(`${label}: tulis jam seperti 17:30`);

    return `${match[1].padStart(2, '0')}:${match[2]}`;
};

const name = (label) => (value) => {
    const clean = String(value ?? '').trim().replace(/\s+/g, ' ');

    if (!/^[\p{L}' .-]{2,30}$/u.test(clean)) fail(`${label}: 2-30 huruf`);

    return clean;
};

/** "0812-3456 7890", "+62 812..." -> "6281234567890". */
export function normalisePhone(value) {
    let digits = String(value ?? '').replace(/\D/g, '');

    if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
    if (digits.startsWith('8')) digits = `62${digits}`;

    return digits;
}

const phones = (value) => {
    const list = (Array.isArray(value) ? value : String(value ?? '').split(/[,;\n]/))
        .map(normalisePhone)
        .filter(Boolean);

    for (const number of list) {
        if (!/^62\d{8,13}$/.test(number)) fail(`Nomor ${number} tidak valid. Contoh: 081234567890`);
    }

    return [...new Set(list)].slice(0, 5);
};

const folder = (value) => {
    const dir = String(value ?? '').trim();

    if (!dir) return path.join(root, 'data', 'backups');
    if (!path.isAbsolute(dir)) fail('Folder backup harus lengkap, mis. G:\\My Drive\\Backup Bot');

    // Prove it is writable now, not at 03.00 when nobody is watching.
    try {
        fs.mkdirSync(dir, { recursive: true });
        const probe = path.join(dir, '.chatbot-test');
        fs.writeFileSync(probe, 'ok');
        fs.rmSync(probe);
    } catch (error) {
        fail(`Folder backup tidak bisa ditulis: ${error.code ?? error.message}`);
    }

    return path.resolve(dir);
};

/**
 * "2027-03-08 - 2027-03-14 Lebaran", "2026-12-25 Natal", one per line.
 * A range may also be written with "s/d" or "sampai".
 */
export function parseHolidays(value) {
    const lines = Array.isArray(value) ? value.map((h) => (typeof h === 'string' ? h : `${h.from} - ${h.to} ${h.label ?? ''}`)) : String(value ?? '').split('\n');
    const holidays = [];

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        const m = line.match(/^(\d{4}-\d{2}-\d{2})(?:\s*(?:-|–|s\/d|sd|sampai)\s*(\d{4}-\d{2}-\d{2}))?\s*(.*)$/i);
        if (!m) fail(`Baris libur tidak dimengerti: "${line}". Contoh: 2027-03-08 - 2027-03-14 Lebaran`);

        const [, from, to = from, label] = m;
        for (const d of [from, to]) if (Number.isNaN(Date.parse(`${d}T00:00:00Z`))) fail(`Tanggal tidak valid: ${d}`);
        if (to < from) fail(`Tanggal selesai sebelum tanggal mulai: "${line}"`);

        holidays.push({ from, to, label: label.trim().slice(0, 40) });
    }

    return holidays.sort((a, b) => a.from.localeCompare(b.from)).slice(0, 50);
}

/** key -> how to validate it and where it lives in config. */
const FIELDS = {
    botName: { validate: name('Nama bot'), get: () => config.bot.botName, set: (v) => (config.bot.botName = v) },
    csName: { validate: name('Nama CS'), get: () => config.bot.csName, set: (v) => (config.bot.csName = v) },
    activeFrom: { validate: time('Mulai aktif'), get: () => config.bot.activeFrom, set: (v) => (config.bot.activeFrom = v) },
    activeUntil: { validate: time('Selesai aktif'), get: () => config.bot.activeUntil, set: (v) => (config.bot.activeUntil = v) },
    handoverHours: {
        validate: (v) => {
            const hours = Number(v);
            if (!Number.isInteger(hours) || hours < 1 || hours > 168) fail('Lama diam setelah handover: 1-168 jam');
            return hours;
        },
        get: () => config.bot.handoverHours,
        set: (v) => (config.bot.handoverHours = v),
    },
    jerseyPromo: {
        validate: (v) => {
            const text = String(v ?? '').replace(/\r\n/g, '\n').trim();
            if (text.length > 1000) fail('Teks promo maksimal 1000 huruf');
            return text;
        },
        get: () => config.bot.jerseyPromo,
        set: (v) => (config.bot.jerseyPromo = v),
    },
    recapTo: { validate: phones, get: () => config.recap.to, set: (v) => (config.recap.to = v) },
    holidays: { validate: parseHolidays, get: () => config.bot.holidays, set: (v) => (config.bot.holidays = v) },
    recapAt: {
        validate: (v) => (String(v ?? '').trim() ? time('Jam rekap')(v) : ''),
        get: () => config.recap.atSetting ?? '',
        set: (v) => {
            config.recap.atSetting = v;
            config.recap.at = v || config.bot.activeUntil;
        },
    },
    backupDir: { validate: folder, get: () => config.maintenance.backupDir, set: (v) => (config.maintenance.backupDir = v) },
};

/** Applies stored settings on boot. A stored value that no longer validates is skipped, not fatal. */
export function loadSettings() {
    for (const row of all(`SELECT "key", value FROM settings WHERE "key" LIKE 'cfg:%'`)) {
        const field = FIELDS[row.key.slice(4)];

        if (!field) continue;

        try {
            field.set(JSON.parse(row.value));
        } catch {
            /* keep the .env default */
        }
    }

    // A recap time left empty follows the end of the night window.
    if (!config.recap.atSetting) config.recap.at = config.bot.activeUntil;
}

export function currentSettings() {
    return Object.fromEntries(Object.entries(FIELDS).map(([key, field]) => [key, field.get()]));
}

/** Validates everything first, then applies: a bad field leaves nothing half-saved. */
export function updateSettings(values) {
    const validated = {};

    for (const [key, value] of Object.entries(values ?? {})) {
        if (!FIELDS[key]) continue;
        validated[key] = FIELDS[key].validate(value);
    }

    for (const [key, value] of Object.entries(validated)) {
        FIELDS[key].set(value);
        setSetting(`cfg:${key}`, JSON.stringify(value));
    }

    if ('activeUntil' in validated && !config.recap.atSetting) config.recap.at = config.bot.activeUntil;

    return currentSettings();
}

/**
 * Folders that leave this PC on their own: Google Drive and OneDrive sync
 * folders, and removable drives. The service runs as SYSTEM, so every user's
 * profile is searched, not only the current one.
 */
export function backupSuggestions() {
    const found = [];
    const add = (dir, label) => {
        try {
            if (fs.existsSync(dir) && fs.statSync(dir).isDirectory() && !found.some((f) => f.dir.toLowerCase() === dir.toLowerCase())) {
                found.push({ dir: path.join(dir, 'Backup ChatBot Prema'), label });
            }
        } catch {
            /* unreadable: skip */
        }
    };

    if (process.platform === 'win32') {
        const usersDir = path.join(process.env.SystemDrive ?? 'C:', 'Users');
        const users = (() => {
            try {
                return fs.readdirSync(usersDir).filter((u) => !['Public', 'Default', 'Default User', 'All Users'].includes(u));
            } catch {
                return [];
            }
        })();

        for (const user of users) {
            const home = path.join(usersDir, user);
            let entries = [];
            try {
                entries = fs.readdirSync(home);
            } catch {
                continue;
            }

            for (const entry of entries) {
                if (/^OneDrive/i.test(entry)) add(path.join(home, entry), `OneDrive (${user})`);
                if (/^Google Drive/i.test(entry)) add(path.join(home, entry), `Google Drive (${user})`);
            }
        }

        // Google Drive for desktop mounts a drive letter with "My Drive" / "Drive Saya".
        for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
            for (const sub of ['My Drive', 'Drive Saya']) add(`${letter}:\\${sub}`, `Google Drive (${letter}:)`);
        }
    } else {
        add(path.join(os.homedir(), 'Google Drive'), 'Google Drive');
        add(path.join(os.homedir(), 'OneDrive'), 'OneDrive');
    }

    return found;
}
