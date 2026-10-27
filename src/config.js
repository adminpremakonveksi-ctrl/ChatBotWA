import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..');

const number = (key, fallback) => {
    const value = process.env[key];

    return value === undefined || value === '' ? fallback : Number(value);
};

// An empty line in .env ("REKAP_JAM=") means "use the default", not "empty".
const text = (key, fallback = '') => {
    const value = process.env[key];

    return value === undefined || value === '' ? fallback : value;
};

export const config = {
    // Local HTTP API (health, sessions, QR). Bound to localhost by default:
    // the QR console must only be reachable from this PC or its LAN.
    host: text('HOST', '127.0.0.1'),
    port: number('PORT', 3001),
    apiKey: text('API_KEY'),
    logLevel: text('LOG_LEVEL', 'info'),

    dbPath: !process.env.DB_PATH
        ? path.join(root, 'data', 'chatbot.sqlite')
        : process.env.DB_PATH === ':memory:'
            ? ':memory:'
            : path.resolve(process.env.DB_PATH),
    mediaDir: process.env.MEDIA_DIR
        ? path.resolve(process.env.MEDIA_DIR)
        : path.join(root, 'media'),

    printQrInTerminal: text('PRINT_QR', 'true') !== 'false',
    allowGroups: text('ALLOW_GROUPS') === 'true',

    bot: {
        // Names are configuration, not code: the CS person can change.
        botName: text('BOT_NAME', 'Mawar'),
        csName: text('CS_NAME', 'Anggun'),

        timezone: text('TIMEZONE', 'Asia/Jakarta'),
        // Bot is active Mon-Sat outside these hours, and all day Sunday.
        activeFrom: text('ACTIVE_FROM', '17:30'),
        activeUntil: text('ACTIVE_UNTIL', '07:30'),
        // Overrides the schedule: "always" for testing, "never" to mute the bot.
        forceMode: text('BOT_FORCE'),

        // Customers often split one thought over several bubbles. Wait this
        // long after the last bubble before answering them all at once.
        debounceMs: number('DEBOUNCE_MS', 6000),
        // Pause between consecutive bubbles, shown as "typing...".
        typingMs: number('TYPING_MS', 1500),

        // After handover the bot stays silent on that number this long.
        handoverHours: number('HANDOVER_HOURS', 24),
        // Messages in a row the bot may fail to understand before CS takes over.
        maxMisses: number('MAX_MISSES', 3),
        // 'ai': after the fixed greeting the AI chats from the shop's data (Pengetahuan);
        // 'naskah': the scripted flow from the spec. Pengaturan > Mode bot.
        mode: 'ai',
        // A conversation idle this long starts over from the greeting.
        resetHours: number('RESET_HOURS', 24),
        // Waiting for a follow-up answer (the size list) lasts this many days (Pengaturan).
        detailWaitDays: 14,

        // Dates the bot is on guard all day, set in the console: [{ from, to, label }].
        holidays: [],

        // Text for step [9]. The spec has none yet; empty means skip the step.
        jerseyPromo: text('JERSEY_PROMO_TEXT').replace(/\\n/g, '\n'),
    },

    maintenance: {
        // Daily database backup. Point this at a folder that leaves the machine
        // (Google Drive / OneDrive sync folder, NAS, USB): losing the database
        // means re-scanning every number.
        backupDir: process.env.BACKUP_DIR
            ? path.resolve(process.env.BACKUP_DIR)
            : path.join(root, 'data', 'backups'),
        backupAt: text('BACKUP_AT', '03:00'),
        backupKeepDays: number('BACKUP_KEEP_DAYS', 14),
        // Chat texts older than this are deleted (same 90 days as PREMA OS logs).
        logKeepDays: number('LOG_KEEP_DAYS', 90),
    },

    recap: {
        // WhatsApp number(s) that get the morning list of overnight customers,
        // comma separated, e.g. 6281234567890. Empty disables the recap.
        to: text('REKAP_KE')
            .split(',')
            .map((value) => value.replace(/\D/g, ''))
            .filter(Boolean),
        // Defaults to the end of the night window.
        at: text('REKAP_JAM', text('ACTIVE_UNTIL', '07:30')),
        // What the team set explicitly ('' = follow ACTIVE_UNTIL).
        atSetting: text('REKAP_JAM'),
    },

    // Ollama: Ollama Cloud with an API key (ollama.com), or a local Ollama
    // (OLLAMA_HOST=http://localhost:11434, no key).
    ollama: {
        apiKey: text('OLLAMA_API_KEY', text('API_URL_OLLAMA')),
        host: text('OLLAMA_HOST', 'https://ollama.com').replace(/\/+$/, ''),
        hostSet: Boolean(text('OLLAMA_HOST')),
        model: text('OLLAMA_MODEL', 'gemma4:31b'),
        timeoutMs: number('OLLAMA_TIMEOUT_MS', 20000),
        // Context size asked of Ollama: its default (2048-4096) silently cuts the shop's data off.
        numCtx: number('OLLAMA_NUM_CTX', 16384),
    },
};
