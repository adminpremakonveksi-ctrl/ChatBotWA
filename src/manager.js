import { all, get, now, run } from './db.js';
import { logger } from './logger.js';
import { Session } from './session.js';

/** Owns every WhatsApp number the gateway knows about. */
class Manager {
    constructor() {
        this.sessions = new Map();
        this.bot = null;
    }

    async boot(bot) {
        this.bot = bot;

        // First run: one number to pair, so the QR shows up without any setup.
        if (!get('SELECT id FROM wa_sessions LIMIT 1')) {
            const stamp = now();
            run(
                `INSERT INTO wa_sessions ("key", label, status, is_default, auto_connect, created_at, updated_at)
                 VALUES ('utama', 'Nomor bot', 'disconnected', 1, 1, ?, ?)`,
                [stamp, stamp],
            );
            logger.info('sesi "utama" dibuat, scan QR untuk menautkan nomor bot');
        }

        const rows = all('SELECT * FROM wa_sessions ORDER BY id');

        for (const row of rows) {
            const session = new Session(row, this.bot);
            this.sessions.set(row.key, session);

            if (row.auto_connect) {
                session.start().catch((error) => logger.error(error, `gagal memulai sesi ${row.key}`));
            } else {
                run('UPDATE wa_sessions SET status = ?, updated_at = ? WHERE id = ?', ['disconnected', now(), row.id]);
            }
        }

        logger.info({ count: rows.length }, 'sesi dimuat dari database');
    }

    list() {
        return [...this.sessions.values()].map((session) => session.status());
    }

    get(key) {
        const session = this.sessions.get(key);

        if (!session) {
            throw Object.assign(new Error(`Sesi "${key}" tidak ditemukan`), { statusCode: 404 });
        }

        return session;
    }

    async create(key, label) {
        if (this.sessions.has(key)) {
            throw Object.assign(new Error(`Sesi "${key}" sudah ada`), { statusCode: 409 });
        }

        const stamp = now();

        const result = run(
            `INSERT INTO wa_sessions ("key", label, status, is_default, auto_connect, created_at, updated_at)
             VALUES (?, ?, 'disconnected', 0, 1, ?, ?)`,
            [key, label, stamp, stamp],
        );

        const id = Number(result.lastInsertRowid);
        const row = get('SELECT * FROM wa_sessions WHERE id = ?', [id]);

        const session = new Session(row, this.bot);
        this.sessions.set(key, session);

        this.#ensureOneDefault();

        await session.start();

        return session;
    }

    async remove(key) {
        const session = this.get(key);

        await session.stop();

        try {
            await session.logout();
        } catch {
            /* the pairing is going away regardless */
        }

        // wa_auth_creds and wa_auth_keys cascade from the session row.
        run('DELETE FROM wa_sessions WHERE id = ?', [session.id]);
        this.sessions.delete(key);

        this.#ensureOneDefault();
    }

    /** The number used when a send request does not name one. */
    async defaultSession() {
        const row = get('SELECT "key" FROM wa_sessions WHERE is_default = 1 LIMIT 1');

        if (!row) {
            throw Object.assign(new Error('Belum ada nomor WhatsApp yang didaftarkan'), { statusCode: 409 });
        }

        return this.get(row.key);
    }

    /** Exactly one number carries the default flag, as long as one exists. */
    #ensureOneDefault() {
        if (get('SELECT id FROM wa_sessions WHERE is_default = 1 LIMIT 1')) {
            return;
        }

        const first = get('SELECT id FROM wa_sessions ORDER BY id LIMIT 1');

        if (first) {
            run('UPDATE wa_sessions SET is_default = 1, updated_at = ? WHERE id = ?', [now(), first.id]);
        }
    }

    async shutdown() {
        for (const session of this.sessions.values()) {
            await session.stop().catch(() => {});
        }
    }
}

export const manager = new Manager();
