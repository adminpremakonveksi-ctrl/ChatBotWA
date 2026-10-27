import { AUTO_MESSAGES_KEY, SEED_ADDITIONS, SEED_AI_SCENARIOS, SEED_KEYWORDS, SEED_NEW_PRODUCTS, SEED_PATTERNS, SEED_PRODUCTS, SEED_STARTER_KEYWORDS, SEED_STORE_TOPICS, SEED_AWAY_MESSAGE, SEED_WORDS, seedQuestions } from './seeds.js';
import { cleanPhrase, setDictionary, textRulesVersion } from './text.js';
import { PREMA_FAQ, PREMA_NEW_PRODUCTS, PREMA_PRODUCTS, PREMA_SCENARIOS, PREMA_TOPICS } from './seeds-prema.js';

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

    {
        // From testing odd messages: anger and "call me" go to CS, "kamu bot?" is
        // answered, and two seeded phrases that caught the wrong thing are removed.
        id: '008_odd_messages',
        up(db) {
            // Questions only CS can answer ("bisa DP?"), noted for CS while the bot carries on.
            if (!hasColumn(db, 'conversations', 'notes')) db.exec('ALTER TABLE conversations ADD COLUMN notes TEXT');
            syncSeeds(db, '008_odd_messages');
        },
    },

    {
        // Every word list the bot reads (dictionary, fillers, cities, units, ...)
        // in the database, editable in the console (Latih bot > Kamus).
        id: '009_word_lists',
        up(db) {
            db.exec(`
CREATE TABLE IF NOT EXISTS word_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list TEXT NOT NULL,
    word TEXT NOT NULL,
    value TEXT,
    source TEXT NOT NULL DEFAULT 'bawaan',
    created_at TEXT,
    UNIQUE (list, word)
);`);

            const insert = db.prepare(`INSERT OR IGNORE INTO word_lists (list, word, value, source, created_at) VALUES (?, ?, ?, 'bawaan', ?)`);
            for (const [list, meta] of Object.entries(SEED_WORDS)) {
                for (const entry of meta.words) {
                    const [word, value] = Array.isArray(entry) ? entry : [entry, null];
                    insert.run(list, String(word).toLowerCase().trim(), value == null ? null : String(value).toLowerCase().trim(), stamp());
                }
            }
        },
    },

    {
        // What happened, in order: pages opened and changes made in the console,
        // what the bot did with each message, notes the team writes for the
        // developer. The Log page shows it; a photo of it explains a request.
        id: '010_activity_log',
        up(db) {
            db.exec(`
CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    source TEXT NOT NULL,
    page TEXT,
    action TEXT NOT NULL,
    detail TEXT
);
CREATE INDEX IF NOT EXISTS activity_log_at ON activity_log (at);`);
        },
    },

    {
        // WhatsApp addresses people by LID (a hidden id) as well as by phone
        // number. Which LID is which number, learnt from the messages, so a
        // chat is one conversation whatever the address, and a message whose
        // encryption session was made under the number can still be read.
        id: '011_lid_map',
        up(db) {
            db.exec(`
CREATE TABLE IF NOT EXISTS lid_map (
    lid TEXT PRIMARY KEY,
    pn TEXT NOT NULL,
    updated_at TEXT
);`);
        },
    },

    {
        // The AI may answer a question the bot has no text for; when it does not
        // know, it offers to hand over to CS. Remembered until the next message.
        id: '012_offer_cs',
        up(db) {
            if (!hasColumn(db, 'conversations', 'offered_cs')) db.exec('ALTER TABLE conversations ADD COLUMN offered_cs INTEGER NOT NULL DEFAULT 0');
            syncSeeds(db, '012_offer_cs');
        },
    },
    {
        // The shop's WhatsApp Business "Pesan tidak di tempat" was not in the
        // list of automatic messages, so it was read as CS typing and muted the bot.
        id: '013_away_message',
        up(db) {
            addAwayMessage(db);
        },
    },
    {
        // "nama ku haikal" was the name "Ku Haikal": more words around a name.
        id: '014_name_words',
        up(db) {
            syncSeeds(db, '014_name_words');
        },
    },
    {
        // A list saved from the console is also kept as the setting text
        // (cfg:autoMessages), which rewrites the list on every boot: 013's
        // addition was lost there. Both get the away message.
        id: '015_away_message_setting',
        up(db) {
            addAwayMessage(db);

            const row = db.prepare(`SELECT value FROM settings WHERE "key" = 'cfg:autoMessages'`).get();
            if (!row) return;

            let text;
            try {
                text = JSON.parse(row.value);
            } catch {
                return;
            }
            if (typeof text !== 'string' || text.includes(SEED_AWAY_MESSAGE)) return;

            db.prepare(`UPDATE settings SET value = ? WHERE "key" = 'cfg:autoMessages'`).run(JSON.stringify(`${text.trim()}\n---\n${SEED_AWAY_MESSAGE}`));
        },
    },
    {
        // "ok makasih sih", "halo malam dong hehe": the words chats add that say nothing.
        id: '016_chat_extras',
        up(db) {
            syncSeeds(db, '016_chat_extras');
        },
    },
    {
        // AI chat mode: what the bot knows, filled in by the team. Products get
        // their details (bahan, teknik, ...), the shop its topics and Q&A.
        // Everything starts empty except the topic titles; the old free-text
        // "Pengetahuan toko" becomes the first topic.
        id: '017_knowledge',
        up(db) {
            if (!hasColumn(db, 'products', 'info')) db.exec(`ALTER TABLE products ADD COLUMN info TEXT NOT NULL DEFAULT '{}'`);
            db.exec(`
CREATE TABLE IF NOT EXISTS store_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);
CREATE TABLE IF NOT EXISTS faq (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product TEXT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);`);

            if (!db.prepare('SELECT 1 FROM store_info LIMIT 1').get()) {
                const insert = db.prepare('INSERT INTO store_info (title, content, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
                let position = 0;

                const old = db.prepare(`SELECT value FROM settings WHERE "key" = 'cfg:storeKnowledge'`).get();
                let text = '';
                try {
                    text = old ? String(JSON.parse(old.value) ?? '').trim() : '';
                } catch {
                    /* unreadable: nothing to carry over */
                }
                if (text) insert.run('Catatan umum', text, position++, stamp(), stamp());

                for (const title of SEED_STORE_TOPICS) insert.run(title, '', position++, stamp(), stamp());
            }

            syncSeeds(db, '017_knowledge');
        },
    },
    {
        // AI chat: what the customer already answered per product (order_info),
        // the AI replies the guard refused (ai_log), and the team's test
        // scenarios (ai_scenarios, seeded once).
        id: '018_order_and_ai_checks',
        up(db) {
            if (!hasColumn(db, 'conversations', 'order_info')) db.exec('ALTER TABLE conversations ADD COLUMN order_info TEXT');
            db.exec(`
CREATE TABLE IF NOT EXISTS ai_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    who TEXT,
    message TEXT,
    reply TEXT,
    problem TEXT NOT NULL,
    outcome TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    messages TEXT NOT NULL,
    forbid TEXT NOT NULL DEFAULT '[]',
    expect TEXT NOT NULL DEFAULT '[]',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);`);

            if (!db.prepare('SELECT 1 FROM ai_scenarios LIMIT 1').get()) {
                const insert = db.prepare('INSERT INTO ai_scenarios (name, messages, forbid, expect, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
                SEED_AI_SCENARIOS.forEach((s, i) => insert.run(s.name, JSON.stringify(s.messages), JSON.stringify(s.forbid), JSON.stringify(s.expect), i, stamp(), stamp()));
            }

            syncSeeds(db, '018_order_and_ai_checks');
        },
    },
    {
        // The owner's answers (seeds-prema.js) as a one-time start for what the
        // team edits in the console: new products, empty topics and empty
        // product details filled, Q&A added. Anything the team already wrote is
        // kept; what it deletes later stays deleted (this runs once).
        id: '019_prema_knowledge',
        up(db) {
            const removed = (value) => Boolean(db.prepare(`SELECT 1 FROM seed_removed WHERE kind = 'product' AND value = ?`).get(value));
            for (const p of PREMA_NEW_PRODUCTS) {
                if (removed(p.key) || db.prepare('SELECT 1 FROM products WHERE "key" = ?').get(p.key)) continue;
                const position = (db.prepare('SELECT MAX(position) AS p FROM products').get()?.p ?? -1) + 1;
                db.prepare(`INSERT INTO products ("key", name, kind, size_chart, position, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
                    .run(p.key, p.name, p.catalog ? 'catalog' : 'design', p.sizeChart ? 1 : 0, position, stamp(), stamp());
            }
            syncSeeds(db, '019_prema_knowledge');

            for (const t of PREMA_TOPICS) {
                const row = db.prepare('SELECT id, content FROM store_info WHERE title = ?').get(t.title);
                if (row && !String(row.content).trim()) db.prepare('UPDATE store_info SET content = ?, updated_at = ? WHERE id = ?').run(t.content, stamp(), row.id);
                if (!row) {
                    const position = (db.prepare('SELECT MAX(position) AS p FROM store_info').get()?.p ?? -1) + 1;
                    db.prepare('INSERT INTO store_info (title, content, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(t.title, t.content, position, stamp(), stamp());
                }
            }

            const empty = (value) => (Array.isArray(value) ? !value.length : !String(value ?? '').trim());
            for (const [key, seed] of Object.entries(PREMA_PRODUCTS)) {
                const row = db.prepare('SELECT info FROM products WHERE "key" = ?').get(key);
                if (!row) continue;
                let info = {};
                try {
                    info = JSON.parse(row.info || '{}') ?? {};
                } catch {
                    /* unreadable: start from the seed */
                }
                for (const [field, value] of Object.entries(seed)) if (empty(info[field])) info[field] = value;
                db.prepare('UPDATE products SET info = ?, updated_at = ? WHERE "key" = ?').run(JSON.stringify(info), stamp(), key);
            }

            const named = new Set(db.prepare('SELECT name FROM ai_scenarios').all().map((r) => r.name));
            let scenarioAt = (db.prepare('SELECT MAX(position) AS p FROM ai_scenarios').get()?.p ?? -1) + 1;
            for (const s of PREMA_SCENARIOS) {
                if (named.has(s.name)) continue;
                db.prepare('INSERT INTO ai_scenarios (name, messages, forbid, expect, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    .run(s.name, JSON.stringify(s.messages), JSON.stringify(s.forbid), JSON.stringify(s.expect), scenarioAt++, stamp(), stamp());
            }

            const known = new Set(db.prepare('SELECT LOWER(question) AS q FROM faq').all().map((r) => r.q));
            let position = (db.prepare('SELECT MAX(position) AS p FROM faq').get()?.p ?? -1) + 1;
            for (const f of PREMA_FAQ) {
                if (known.has(f.question.toLowerCase())) continue;
                const product = f.product && db.prepare('SELECT 1 FROM products WHERE "key" = ?').get(f.product) ? f.product : null;
                db.prepare('INSERT INTO faq (product, question, answer, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(product, f.question, f.answer, position++, stamp(), stamp());
            }
        },
    },
];

/** Adds the away message to a list the team already saved, once; a fresh install gets it as the default. */
export function addAwayMessage(db) {
    const row = db.prepare(`SELECT value FROM settings WHERE "key" = ?`).get(AUTO_MESSAGES_KEY);
    if (!row) return;

    let list;
    try {
        list = JSON.parse(row.value);
    } catch {
        return;
    }
    if (!Array.isArray(list) || list.includes(SEED_AWAY_MESSAGE)) return;

    db.prepare(`UPDATE settings SET value = ? WHERE "key" = ?`).run(JSON.stringify([...list, SEED_AWAY_MESSAGE].slice(0, 10)), AUTO_MESSAGES_KEY);
}

/** Reads the dictionary lists from the database into normalise() (once the table exists). */
export function loadDictionary(db) {
    const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'word_lists'`).get();
    if (!exists) return false;

    const pairs = (list) => db.prepare('SELECT word, value FROM word_lists WHERE list = ?').all(list);
    setDictionary({ shorthand: pairs('singkatan'), regional: pairs('bahasa_daerah'), phrase: pairs('frasa') });

    return true;
}

/**
 * Keywords are stored the way messages are compared. When the comparison
 * rules change (a dictionary edit, an update), re-store them, so keywords
 * never stop matching.
 */
export function syncTextRules(db) {
    const version = textRulesVersion();
    const saved = db.prepare(`SELECT value FROM settings WHERE "key" = 'text:rules'`).get()?.value;
    if (saved === version) return false;

    db.transaction(() => {
        renormaliseKeywords(db);
        db.prepare(`INSERT OR REPLACE INTO settings ("key", value, updated_at) VALUES ('text:rules', ?, ?)`).run(version, stamp());
    })();

    return true;
}

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
    // Word lists (Kamus): new words, unless the team deleted them.
    for (const [list, entries] of Object.entries(add.words ?? {})) {
        for (const entry of entries) {
            const [word, value] = Array.isArray(entry) ? entry : [entry, null];
            const key = String(word).toLowerCase().trim();
            if (db.prepare('SELECT 1 FROM seed_removed WHERE kind = ? AND value = ?').get(`word:${list}`, key)) continue;
            db.prepare(`INSERT OR IGNORE INTO word_lists (list, word, value, source, created_at) VALUES (?, ?, ?, 'bawaan', ?)`)
                .run(list, key, value == null ? null : String(value).toLowerCase().trim(), stamp());
        }
    }


    const removed = (kind, value) => Boolean(db.prepare('SELECT 1 FROM seed_removed WHERE kind = ? AND value = ?').get(kind, value));
    const insert = db.prepare(`INSERT OR IGNORE INTO custom_keywords (phrase, intent, product, source, created_at) VALUES (?, ?, ?, 'bawaan', ?)`);

    for (const [intent, phrases] of Object.entries(add.keywords ?? {})) {
        for (const phrase of phrases.map(cleanPhrase)) {
            if (!removed('keyword', phrase)) insert.run(phrase, intent, null, stamp());
        }
    }

    // A built-in product keyword that belongs to another product ("pdh" was PDL;
    // it is Kemeja PDH): taken off before the additions give it its new owner.
    // Only the seeded one: a phrase the team put there itself is theirs.
    for (const [key, phrases] of Object.entries(add.remove?.products ?? {})) {
        for (const phrase of phrases.map(cleanPhrase)) {
            db.prepare(`DELETE FROM custom_keywords WHERE intent = 'product' AND product = ? AND phrase = ? AND source = 'bawaan'`).run(key, phrase);
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

    // Seeded phrases that proved to catch the wrong thing ("kantore" -> Lokasi).
    for (const [builtin, phrases] of Object.entries(add.remove?.patterns ?? {})) {
        const row = db.prepare('SELECT id, keywords FROM patterns WHERE builtin = ?').get(builtin);
        if (!row) continue;

        const drop = phrases.map(cleanPhrase);
        const current = JSON.parse(row.keywords || '[]');
        const kept = current.filter((k) => !drop.includes(k));
        if (kept.length !== current.length) db.prepare('UPDATE patterns SET keywords = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(kept), stamp(), row.id);
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

    // The dictionary the team edited, then keywords re-stored if it changed.
    loadDictionary(db);
    syncTextRules(db);

    return applied;
}

export const migrationIds = () => MIGRATIONS.map((m) => m.id);
