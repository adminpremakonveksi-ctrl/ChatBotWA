import { SEED_ADDITIONS, SEED_KEYWORDS, SEED_NEW_PRODUCTS, SEED_PATTERNS, SEED_PRODUCTS, SEED_STARTER_KEYWORDS, seedQuestions } from './seeds.js';
import { cleanPhrase, textRulesVersion } from './text.js';

/**
 * Numbered schema migrations with their seeders. Each runs once per database
 * and is recorded in `migrations`; a client database that already exists
 * gets only the ones it is missing, in order, each in a transaction.
 *
 * Rules: never edit a migration that has shipped (clients already ran it):
 * add a new one. Seeders must keep what the team already changed.
 */

const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

const hasColumn = (db, table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

const MIGRATIONS = [
    {
        id: '001_base_tables',
        up(db) {
            db.exec(`
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

-- Every message in and out, plus handover and step markers. Doubles as the volume counter.
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

-- Small key/value store: settings, when each daily job last ran, etc.
CREATE TABLE IF NOT EXISTS settings (
    "key" TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS custom_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phrase TEXT NOT NULL UNIQUE,
    intent TEXT NOT NULL,
    product TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS catalog_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    position INTEGER,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    bubbles TEXT NOT NULL DEFAULT '[]',
    after TEXT NOT NULL DEFAULT 'stay',
    enabled INTEGER NOT NULL DEFAULT 1,
    starts_on TEXT,
    ends_on TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS message_log_jid ON message_log (session_key, jid, created_at);
CREATE INDEX IF NOT EXISTS message_log_wa_id ON message_log (wa_message_id);
CREATE INDEX IF NOT EXISTS message_log_created ON message_log (created_at);
`);

            // Pattern tables from before the date window existed.
            for (const column of ['starts_on', 'ends_on']) {
                if (!hasColumn(db, 'patterns', column)) db.exec(`ALTER TABLE patterns ADD COLUMN ${column} TEXT`);
            }
        },
    },

    {
        id: '002_products',
        up(db) {
            db.exec(`
CREATE TABLE IF NOT EXISTS products (
    "key" TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'design',
    size_chart INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);`);

            const insert = db.prepare(
                `INSERT OR IGNORE INTO products ("key", name, kind, size_chart, position, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
            );

            for (const p of SEED_PRODUCTS) insert.run(p.key, p.name, p.catalog ? 'catalog' : 'design', p.sizeChart ? 1 : 0, p.position, stamp(), stamp());
        },
    },

    {
        id: '003_keywords_in_database',
        up(db) {
            if (!hasColumn(db, 'custom_keywords', 'source')) {
                db.exec(`ALTER TABLE custom_keywords ADD COLUMN source TEXT NOT NULL DEFAULT 'tim'`);
            }

            // Team keywords saved before shorthand expansion ("blm ada"): store them
            // the way messages are now compared ("belum ada"); drop exact duplicates.
            for (const row of db.prepare('SELECT id, phrase FROM custom_keywords').all()) {
                const clean = cleanPhrase(row.phrase);
                if (clean === row.phrase) continue;

                const taken = db.prepare('SELECT 1 FROM custom_keywords WHERE phrase = ? AND id <> ?').get(clean, row.id);
                if (taken || !clean) db.prepare('DELETE FROM custom_keywords WHERE id = ?').run(row.id);
                else db.prepare('UPDATE custom_keywords SET phrase = ? WHERE id = ?').run(clean, row.id);
            }

            const insert = db.prepare(
                `INSERT OR IGNORE INTO custom_keywords (phrase, intent, product, source, created_at) VALUES (?, ?, ?, ?, ?)`,
            );

            for (const [intent, phrases] of Object.entries(SEED_KEYWORDS)) {
                for (const phrase of phrases) insert.run(phrase, intent, null, 'bawaan', stamp());
            }

            for (const p of SEED_PRODUCTS) {
                for (const phrase of p.keywords) insert.run(phrase, 'product', p.key, 'bawaan', stamp());
            }

            // A fresh install gets a few examples; an existing one already had its own.
            const seeded = db.prepare(`SELECT 1 FROM settings WHERE "key" = 'keywords:seeded'`).get();
            if (!seeded) {
                for (const k of SEED_STARTER_KEYWORDS) insert.run(cleanPhrase(k.phrase), k.intent, k.product ?? null, 'tim', stamp());
                db.prepare(`INSERT OR REPLACE INTO settings ("key", value, updated_at) VALUES ('keywords:seeded', ?, ?)`).run(stamp(), stamp());
            }
        },
    },

    {
        id: '004_builtin_answers_as_patterns',
        up(db) {
            if (!hasColumn(db, 'patterns', 'builtin')) db.exec('ALTER TABLE patterns ADD COLUMN builtin TEXT');

            const setting = (key) => db.prepare('SELECT value FROM settings WHERE "key" = ?').get(key)?.value ?? null;

            for (const seed of SEED_PATTERNS) {
                if (db.prepare('SELECT 1 FROM patterns WHERE builtin = ?').get(seed.builtin)) continue;

                // Keywords the team taught to this answer before it became a pattern come along.
                const taught = db.prepare('SELECT phrase FROM custom_keywords WHERE intent = ?').all(seed.builtin).map((r) => r.phrase);
                db.prepare('DELETE FROM custom_keywords WHERE intent = ?').run(seed.builtin);

                // So do the team's edits of its templates (Template balasan).
                const bubbles = seed.bubbles.map((bubble, i) => {
                    const edited = seed.templates[i] ? setting(`reply:${seed.templates[i]}`) : null;
                    if (!edited) return bubble;

                    return bubble.type === 'link' ? { ...bubble, url: edited } : { ...bubble, text: edited };
                });
                for (const key of seed.templates) db.prepare('DELETE FROM settings WHERE "key" = ?').run(`reply:${key}`);

                db.prepare(
                    `INSERT INTO patterns (name, keywords, bubbles, after, enabled, builtin, created_at, updated_at) VALUES (?, ?, ?, 'stay', 1, ?, ?, ?)`,
                ).run(seed.name, JSON.stringify([...new Set([...seed.keywords, ...taught])]), JSON.stringify(bubbles), seed.builtin, stamp(), stamp());
            }
        },
    },

    {
        // More ways customers say things, three new intents (ask_first, ack, price),
        // and a memory of what the team deleted so later seeds never bring it back.
        id: '005_smarter_seeds',
        up(db) {
            db.exec(`CREATE TABLE IF NOT EXISTS seed_removed (kind TEXT NOT NULL, value TEXT NOT NULL, removed_at TEXT, PRIMARY KEY (kind, value))`);
            renormaliseKeywords(db);
            syncSeeds(db, '005_smarter_seeds');
        },
    },

    {
        // Follow-up questions per product ("kemeja apa? ukuran apa?"), and what
        // the customer answered plus the quantity they named, kept for CS.
        id: '006_order_details',
        up(db) {
            if (!hasColumn(db, 'products', 'questions')) db.exec(`ALTER TABLE products ADD COLUMN questions TEXT NOT NULL DEFAULT '[]'`);
            for (const column of ['quantity TEXT', 'details TEXT', 'detail_index INTEGER']) {
                if (!hasColumn(db, 'conversations', column.split(' ')[0])) db.exec(`ALTER TABLE conversations ADD COLUMN ${column}`);
            }

            const removed = (value) => Boolean(db.prepare(`SELECT 1 FROM seed_removed WHERE kind = 'product' AND value = ?`).get(value));
            const insertKeyword = db.prepare(`INSERT OR IGNORE INTO custom_keywords (phrase, intent, product, source, created_at) VALUES (?, 'product', ?, 'bawaan', ?)`);

            for (const p of SEED_NEW_PRODUCTS) {
                if (removed(p.key) || db.prepare('SELECT 1 FROM products WHERE "key" = ?').get(p.key)) continue;

                const position = (db.prepare('SELECT MAX(position) AS p FROM products').get()?.p ?? -1) + 1;
                db.prepare(`INSERT INTO products ("key", name, kind, size_chart, position, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
                    .run(p.key, p.name, p.catalog ? 'catalog' : 'design', p.sizeChart ? 1 : 0, position, stamp(), stamp());
                for (const phrase of p.keywords) insertKeyword.run(cleanPhrase(phrase), p.key, stamp());
            }

            // Seeded products get their questions; one the team made itself starts with none.
            for (const row of db.prepare(`SELECT "key", size_chart FROM products WHERE builtin = 1 AND questions = '[]'`).all()) {
                db.prepare('UPDATE products SET questions = ? WHERE "key" = ?').run(JSON.stringify(seedQuestions({ key: row.key, sizeChart: Boolean(row.size_chart) })), row.key);
            }
        },
    },

    {
        // More ways of saying the same things (see SEED_ADDITIONS in seeds.js).
        id: '007_more_variations',
        up(db) {
            // How many messages in a row the bot did not understand (it asks again before handing over).
            if (!hasColumn(db, 'conversations', 'misses')) db.exec('ALTER TABLE conversations ADD COLUMN misses INTEGER NOT NULL DEFAULT 0');
            syncSeeds(db, '007_more_variations');
        },
    },
];

/** Re-stores keywords the way messages are now compared; drops the duplicates that makes. */
function renormaliseKeywords(db) {
    for (const row of db.prepare('SELECT id, phrase FROM custom_keywords').all()) {
        const clean = cleanPhrase(row.phrase);
        if (clean === row.phrase) continue;

        const taken = db.prepare('SELECT 1 FROM custom_keywords WHERE phrase = ? AND id <> ?').get(clean, row.id);
        if (taken || !clean) db.prepare('DELETE FROM custom_keywords WHERE id = ?').run(row.id);
        else db.prepare('UPDATE custom_keywords SET phrase = ? WHERE id = ?').run(clean, row.id);
    }

    for (const row of db.prepare('SELECT id, keywords FROM patterns').all()) {
        const before = JSON.parse(row.keywords || '[]');
        const after = [...new Set(before.map(cleanPhrase).filter(Boolean))];
        if (JSON.stringify(after) !== JSON.stringify(before)) db.prepare('UPDATE patterns SET keywords = ? WHERE id = ?').run(JSON.stringify(after), row.id);
    }
}

/**
 * Brings one SEED_ADDITIONS entry to this database without undoing the team:
 * - a phrase the team deleted or renamed (seed_removed) is not added again;
 * - a phrase already in use, for any intent or product, keeps its meaning;
 * - a product or built-in pattern the team deleted gets nothing;
 * - pattern keywords are appended, the team's own stay.
 */
export function syncSeeds(db, migration) {
    for (const add of SEED_ADDITIONS.filter((a) => a.migration === migration)) applySeed(db, add);
}

function applySeed(db, add) {

    const removed = (kind, value) => Boolean(db.prepare('SELECT 1 FROM seed_removed WHERE kind = ? AND value = ?').get(kind, value));
    const insert = db.prepare(`INSERT OR IGNORE INTO custom_keywords (phrase, intent, product, source, created_at) VALUES (?, ?, ?, 'bawaan', ?)`);

    for (const [intent, phrases] of Object.entries(add.keywords ?? {})) {
        for (const phrase of phrases.map(cleanPhrase)) {
            if (!removed('keyword', phrase)) insert.run(phrase, intent, null, stamp());
        }
    }

    for (const [key, phrases] of Object.entries(add.products ?? {})) {
        if (!db.prepare('SELECT 1 FROM products WHERE "key" = ?').get(key)) continue;

        for (const phrase of phrases.map(cleanPhrase)) {
            if (!removed('keyword', phrase)) insert.run(phrase, 'product', key, stamp());
        }
    }

    for (const [builtin, phrases] of Object.entries(add.patterns ?? {})) {
        const row = db.prepare('SELECT id, keywords FROM patterns WHERE builtin = ?').get(builtin);
        if (!row) continue;

        const current = JSON.parse(row.keywords || '[]');
        const fresh = phrases.map(cleanPhrase).filter((p) => !current.includes(p) && !removed(`pattern:${builtin}`, p));
        if (fresh.length) {
            db.prepare('UPDATE patterns SET keywords = ?, updated_at = ? WHERE id = ?').run(JSON.stringify([...current, ...fresh]), stamp(), row.id);
        }
    }
}

/** Remembers that the team removed a built-in seed, so no later migration re-adds it. */
export function rememberRemoved(db, kind, value) {
    db.prepare(`INSERT OR IGNORE INTO seed_removed (kind, value, removed_at) VALUES (?, ?, ?)`).run(kind, value, stamp());
}

/** Applies every migration this database has not had yet. Returns the ids applied now. */
export function runMigrations(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);

    const done = new Set(db.prepare('SELECT id FROM migrations').all().map((r) => r.id));
    const applied = [];

    for (const migration of MIGRATIONS) {
        if (done.has(migration.id)) continue;

        db.transaction(() => {
            migration.up(db);
            db.prepare('INSERT INTO migrations (id, applied_at) VALUES (?, ?)').run(migration.id, stamp());
        })();

        applied.push(migration.id);
    }

    // Keywords are stored the way messages are compared. When the comparison
    // rules change (new shorthand, Javanese words, ...), re-store them, so an
    // update never leaves a client with keywords that can no longer match.
    const version = textRulesVersion();
    const saved = db.prepare(`SELECT value FROM settings WHERE "key" = 'text:rules'`).get()?.value;
    if (saved !== version) {
        db.transaction(() => {
            renormaliseKeywords(db);
            db.prepare(`INSERT OR REPLACE INTO settings ("key", value, updated_at) VALUES ('text:rules', ?, ?)`).run(version, stamp());
        })();
    }

    return applied;
}

export const migrationIds = () => MIGRATIONS.map((m) => m.id);
