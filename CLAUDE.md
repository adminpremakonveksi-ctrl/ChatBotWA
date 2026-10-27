# CLAUDE.md

**ChatBot Prema**: the WhatsApp bot of Prema Konveksi ("Proyek 2"). Node 20+, ESM,
Baileys 6.7.24 (pinned: `latest` is a 7.0 RC), better-sqlite3. Runs on a physical
PC that stays on.

It shares **nothing** with PREMA OS (the Laravel admin site): no API, no database.
That holds only because the bot never computes prices. If a task seems to need
PREMA OS data, stop and ask.

The spec and decisions live in `D:\Code\Web\ChatBotWA`: `SPEK-CHATBOT.md` (reply
texts, flow) and `CATATAN-DISKUSI.md`. Read them before changing behaviour.

Content language is Indonesian. Code and comments are English.

## Rules that are easy to break

- **Two modes** (Pengaturan > Mode bot, `config.bot.mode`, default `ai`; client's
  decision 2026-10-21):
  - `ai` (`src/bot/chat.js`): the fixed greeting template, then the AI writes the
    replies like a usual chatbot, ONLY from the shop's data (`src/bot/knowledge.js`:
    Info toko topics, Tanya-jawab, product details in `products.info`, Pola jawaban).
    Code keeps the guards: greeting, "minta CS" and voice notes are fixed templates;
    every reply passes `checkReply` (no money, Kamus `larangan_chat`, numbers and
    links only if in the data or the customer's words), refused → retried once with
    the reason → still refused, AI down or not set up → **silent** (client's choice)
    with the error in the pop-up. Broken JSON from the model is also asked again once.
    **Code holds the order** (`conversations.order_info`): the product being discussed
    (keywords, earlier lines, or the AI), the answers per item of the product's
    "Yang perlu ditanyakan" (team's list and order), the item being asked (`ditanya`:
    when the AI leaves `terjawab` empty, code files the reply there; "menyusul" waits).
    Code, not the AI, decides "complete" → AI reply + [7] + [8] + handover with a
    summary built from the answers. The AI gets full details only for that product
    (`knowledgeBlock(media, { focus })`). Refused replies go to `ai_log`; the team's
    red-team chats are `ai_scenarios` (Coba bot > Uji AI, run against the real AI).
    Never fill the shop's data with guesses: empty means "ask CS".
  - `naskah`: the scripted flow (`engine.js`), replies are fixed templates copied
    word for word from the spec; AI only labels intent, may add one opening line and
    answer from the same data, all through `safeAiText`. The old tests run in this
    mode (`test/setup.js`).
- **Night guard only**: active Mon–Sat 17.30–07.30 and all of Sunday (`schedule.js`).
  The hours are editable; `inWindow` handles both night (crosses midnight) and day windows.
- Follow-up questions (size list last) come at the end, just before the order goes to CS.
  The size list often arrives days later: `awaiting_detail` lives `detailWaitDays`
  (Pengaturan), and "nanti saya kabari" (Kamus `jawaban_menyusul`) keeps the question open.
- **No prices** in replies. Catalog files may be sent. Exception (client, 2026-10-24),
  AI mode only: fixed amounts the owner wrote in the shop's data (size surcharges,
  the design fee range) may be quoted exactly as written; `checkReply` lets an amount
  through only if it is in the shop's data (never from the customer's words) and not
  in a sentence with Kamus `kata_harga` (harga, total, per pcs). Product prices and
  totals stay with CS. The owner's 75 answers are seeded once (`src/seeds-prema.js`,
  migration 019) into what the team edits; they fill only empty fields.
- Bot and CS names are config (`BOT_NAME`, `CS_NAME`), not literals.
- Unrecognised → ask again ("clarify" template); hand over to CS only after
  `maxMisses` in a row (Pengaturan, default 3) or when they ask for a person
  (intent `human`). The client relaxed spec rule 1: closing chats too fast was the complaint.
- AI is Ollama only (Claude removed at the client's request), asked only when the
  keywords return `other`; its labels are validated (open models invent labels).
- WhatsApp Business automatic messages (Salam) arrive as `fromMe`: `auto-messages.js`
  recognises them so they are not taken for CS typing.
- Every warn/error log line reaches the console's error pop-up (`src/errors.js`,
  logger hook). Show errors raw; do not soften or hide them: fix the cause.
- WhatsApp addresses people (and our own phone) by LID or by number. `src/lid.js`
  learns the mapping (table lid_map), keeps one conversation per customer, and
  retries a failed LID decrypt with the number's session (CS replies typed on the
  phone were unreadable without it). Our own LID arrives after connecting
  (creds.update) and is kept in memory too. One number, one bot: on
  "conflict" (440) the session stops instead of reconnecting; never copy
  `data/` between PCs. Library bugs are fixed from our code in
  `src/baileys-fixes.js`, never by editing node_modules (installs skip scripts).
- New seeds go in `SEED_ADDITIONS` with a NEW migration id; never edit a shipped one.

## Layout

```
src/index.js          HTTP API + boot; listens BEFORE WhatsApp so a busy port stops a 2nd bot
src/console.html      admin console (vanilla JS); escape customer text, it is untrusted
src/maintenance.js    daily jobs in-process: backup, prune, morning recap to CS
src/settings.js       console-editable settings (stored in SQLite, applied live); .env is only the first default
src/session.js        one WhatsApp number: socket, reconnect, transport for the bot
src/manager.js        all numbers; seeds session "utama" on first run
src/auth-state.js     Baileys auth store in SQLite (no re-scan after restart)
src/db.js             schema (created on boot) + helpers
src/bot/bot.js        debounce, per-customer queue, CS-reply detection, sending
src/bot/chat.js       AI chat mode: chatTurn(conv, input) -> { actions, patch } like decide; askChat + checkReply
src/bot/knowledge.js  the shop's data for the AI: Info toko topics, Tanya-jawab (tables store_info, faq) + knowledgeBlock()
src/bot/ai-log.js     replies the guards stopped (table ai_log, newest 500)
src/bot/ai-scenarios.js  Uji AI: the team's test chats (table ai_scenarios), run in memory through chatTurn
src/bot/engine.js     the scripted flow (naskah mode) as a pure function: decide(conv, intent, media)
src/bot/classify*.js  intent: keywords first, Ollama (optional) for what they miss; returns intent + extras
src/bot/auto-messages.js  WhatsApp Business Salam/away texts, so they are not read as CS
src/errors.js         recent warn/error feed for the console's error pop-up
src/migrations.js     numbered migrations; src/seeds.js holds the built-in data they seed
src/bot/keywords.js   team-taught keywords (console "Latih bot"), merged into the rules at match time
src/bot/patterns.js   team answer patterns ("Pola jawaban"): keywords + bubbles; matched before built-in answers
src/bot/catalog.js    WhatsApp Business catalog sync (Baileys getCatalog), item->product mapping, wa.me/p links
src/bot/store.js      conversation state, handover expiry, message log
src/bot/simulator.js  "Coba bot" in the console: real classifier + flow, nothing sent
media/                files the bot sends; uploaded from the console, type sniffed from bytes
scripts/launcher.ps1  mulai/update/install (Task Scheduler, SYSTEM, at startup) + admin menu; ASCII only (PS 5.1)
scripts/repo.txt      GitHub repo that "Update" pulls from (public; ZIP download, no git on client PCs)
*.bat                 exactly two for clients: Mulai and Update. Do not add more.
                      Mulai checks GitHub first and installs a newer version before starting
                      (skipped on a git checkout); Update installs it and stops the bot, does
                      NOT start it, and tells them to click Mulai (client, 2026-10-27).
```

The bot logs each outgoing message id **before** sending: WhatsApp echoes the
bot's own messages back as `fromMe`, and any `fromMe` id it does not know is
treated as CS typing on the phone, which hands the customer over.

Clients never edit files: everything they need is in the console. Keep it that way.
New columns on existing tables need an in-place migration (see patterns.js): client
databases already exist and `CREATE TABLE IF NOT EXISTS` will not add them.
Edit regex/escape-heavy code, and any string containing `\n`, with the Edit tool:
scripted edits (Python/sed through Git Bash) have written invisible control
characters (\x08) into regexes and turned `\n` into real line breaks inside strings,
breaking files the tests did not import. `test/integrity.test.js` catches these,
plus unparseable files, a broken console script, non-ASCII in the launcher,
unknown template placeholders and seed phrases with two meanings.
`npm test` must pass before every commit; add a regression test for every bug
fixed (see `test/review-fixes.test.js`). When a change of behaviour breaks an old
test (e.g. "unknown -> CS"), update that test on purpose; never delete it to get green.
Update must never overwrite `data/`, `media/`, `logs/` or `.env` on a client PC.

## Commands

```bash
npm start
npm test        # node:test, in-memory SQLite, no WhatsApp needed
```

Kill stray processes on Windows with PowerShell (`pkill` from Git Bash is
unreliable here) and check `netstat` that port 3001 is free before restarting.
