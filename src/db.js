import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Local SQLite. Holds only WhatsApp pairing credentials and conversation
 * state - no business data. Pairing lives here rather than as files so a
 * restart or an update keeps the numbers linked without a new QR scan.
 *
 * Run exactly one bot process per database file: two processes would fight
 * over the same WhatsApp sockets.
 */
export function openDatabase(file) {
    if (file !== ':memory:') {
        fs.mkdirSync(path.dirname(file), { recursive: true });
    }

    const database = new Database(file, { timeout: 5000 });

    database.pragma('journal_mode = WAL');
    database.pragma('busy_timeout = 5000');
    database.pragma('synchronous = NORMAL');
    database.pragma('foreign_keys = ON');

    migrate(database);

    return database;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wa_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'disconnected',
    phone_number TEXT,
    push_name TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    auto_connect INTEGER NOT NULL DEFAULT 1,
    last_connected_at TEXT,
    last_error TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS wa_auth_creds (
    wa_session_id INTEGER PRIMARY KEY REFERENCES wa_sessions(id) ON DELETE CASCADE,
    creds TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS wa_auth_keys (
    wa_session_id INTEGER NOT NULL REFERENCES wa_sessions(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    key_id TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    PRIMARY KEY (wa_session_id, category, key_id)
);

-- Where each customer is in the reply flow, per bot number.
CREATE TABLE IF NOT EXISTS conversations (
    session_key TEXT NOT NULL,
    jid TEXT NOT NULL,
    step TEXT NOT NULL DEFAULT 'new',
    name TEXT,
    origin TEXT,
    product TEXT,
    return_step TEXT,
    handed_over_at TEXT,
    handover_reason TEXT,
    last_message_at TEXT,
    created_at TEXT,
    updated_at TEXT,
    PRIMARY KEY (session_key, jid)
);

-- Every message in and out. Doubles as the daily volume counter.
CREATE TABLE IF NOT EXISTS message_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_key TEXT NOT NULL,
    jid TEXT NOT NULL,
    direction TEXT NOT NULL,
    wa_message_id TEXT,
    text TEXT,
    intent TEXT,
    created_at TEXT NOT NULL
);

-- Small key/value store: when each daily job last ran, etc.
CREATE TABLE IF NOT EXISTS settings (
    "key" TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS message_log_jid ON message_log (session_key, jid, created_at);
CREATE INDEX IF NOT EXISTS message_log_wa_id ON message_log (wa_message_id);
CREATE INDEX IF NOT EXISTS message_log_created ON message_log (created_at);
`;

function migrate(database) {
    database.exec(SCHEMA);
}

export const db = openDatabase(config.dbPath);

export const all = (sql, params = []) => db.prepare(sql).all(...params);
export const get = (sql, params = []) => db.prepare(sql).get(...params);
export const run = (sql, params = []) => db.prepare(sql).run(...params);

/** UTC timestamp, sortable as text. */
export const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export const getSetting = (key) => get('SELECT value FROM settings WHERE "key" = ?', [key])?.value ?? null;

export const setSetting = (key, value) =>
    run(
        `INSERT INTO settings ("key", value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT("key") DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, value, now()],
    );

export function describeDatabase() {
    logger.info({ database: config.dbPath }, 'database siap');
}
