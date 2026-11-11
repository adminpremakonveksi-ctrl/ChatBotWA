import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..');

const number = (key, fallback) => {
    const value = process.env[key];

    return value === undefined || value === '' ? fallback : Number(value);
};

const text = (key, fallback = '') => {
    const value = process.env[key];

    return value === undefined || value === '' ? fallback : value;
};

export const config = {
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
        botName: text('BOT_NAME', 'Mawar'),
        csName: text('CS_NAME', 'Anggun'),

        timezone: text('TIMEZONE', 'Asia/Jakarta'),
        activeFrom: text('ACTIVE_FROM', '17:30'),
        activeUntil: text('ACTIVE_UNTIL', '07:30'),
        forceMode: text('BOT_FORCE'),

        debounceMs: number('DEBOUNCE_MS', 6000),
        typingMs: number('TYPING_MS', 1500),

        handoverHours: number('HANDOVER_HOURS', 24),
        maxMisses: number('MAX_MISSES', 3),
        mode: 'ai',
        resetHours: number('RESET_HOURS', 24),
        detailWaitDays: 14,

        holidays: [],

        jerseyPromo: text('JERSEY_PROMO_TEXT').replace(/\\n/g, '\n'),
    },

    maintenance: {
        backupDir: process.env.BACKUP_DIR
            ? path.resolve(process.env.BACKUP_DIR)
            : path.join(root, 'data', 'backups'),
        backupAt: text('BACKUP_AT', '03:00'),
        backupKeepDays: number('BACKUP_KEEP_DAYS', 14),
        logKeepDays: number('LOG_KEEP_DAYS', 90),
    },

    recap: {
        to: text('REKAP_KE')
            .split(',')
            .map((value) => value.replace(/\D/g, ''))
            .filter(Boolean),
        at: text('REKAP_JAM', text('ACTIVE_UNTIL', '07:30')),
        atSetting: text('REKAP_JAM'),
        alerts: true,
    },

    ollama: {
        apiKey: text('OLLAMA_API_KEY', text('API_URL_OLLAMA')),
        extraKeys: [text('OLLAMA_API_KEY_2'), text('OLLAMA_API_KEY_3'), text('OLLAMA_API_KEY_4')],
        keyCooldownMinutes: number('OLLAMA_KEY_COOLDOWN_MINUTES', 30),
        host: text('OLLAMA_HOST', 'https://ollama.com').replace(/\/+$/, ''),
        hostSet: Boolean(text('OLLAMA_HOST')),
        model: text('OLLAMA_MODEL', 'gemma4:31b'),
        timeoutMs: number('OLLAMA_TIMEOUT_MS', 60000),
        numCtx: number('OLLAMA_NUM_CTX', 16384),
    },
};
