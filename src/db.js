import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { config } from './config.js';
import { runMigrations } from './migrations.js';
import { logger } from './logger.js';

export function openDatabase(file) {
    if (file !== ':memory:') {
        fs.mkdirSync(path.dirname(file), { recursive: true });
    }

    const database = new Database(file, { timeout: 5000 });

    database.pragma('journal_mode = WAL');
    database.pragma('busy_timeout = 5000');
    database.pragma('synchronous = FULL');
    database.pragma('foreign_keys = ON');

    runMigrations(database);

    return database;
}





export const db = openDatabase(config.dbPath);

export const all = (sql, params = []) => db.prepare(sql).all(...params);
export const get = (sql, params = []) => db.prepare(sql).get(...params);
export const run = (sql, params = []) => db.prepare(sql).run(...params);

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
