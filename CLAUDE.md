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

- **Replies are fixed text**: templates in `src/bot/replies.js`, defaults copied word
  for word from the spec, editable by the team in the console ("Template balasan").
  Never generate reply text, never let AI write or rewrite one. AI only labels intent.
- **Night guard only**: active Mon–Sat 17.30–07.30 and all of Sunday (`schedule.js`).
- **No prices** in replies. Catalog files may be sent.
- Bot and CS names are config (`BOT_NAME`, `CS_NAME`), not literals.
- Unrecognised → reply [7] and hand over to CS (spec rule 1).

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
src/bot/engine.js     the flow as a pure function: decide(conv, intent, media)
src/bot/classify*.js  intent: AI (optional) with keyword fallback; returns intent + extras (multi-question)
src/bot/keywords.js   team-taught keywords (console "Latih bot"), merged into the rules at match time
src/bot/store.js      conversation state, handover expiry, message log
src/bot/simulator.js  "Coba bot" in the console: real classifier + flow, nothing sent
media/                files the bot sends; uploaded from the console, type sniffed from bytes
scripts/launcher.ps1  mulai/update/install (Task Scheduler, SYSTEM, at startup) + admin menu; ASCII only (PS 5.1)
scripts/repo.txt      GitHub repo that "Update" pulls from (public; ZIP download, no git on client PCs)
*.bat                 exactly two for clients: Mulai and Update. Do not add more.
```

The bot logs each outgoing message id **before** sending: WhatsApp echoes the
bot's own messages back as `fromMe`, and any `fromMe` id it does not know is
treated as CS typing on the phone, which hands the customer over.

Clients never edit files: everything they need is in the console. Keep it that way.
Update must never overwrite `data/`, `media/`, `logs/` or `.env` on a client PC.

## Commands

```bash
npm start
npm test        # node:test, in-memory SQLite, no WhatsApp needed
```

Kill stray processes on Windows with PowerShell (`pkill` from Git Bash is
unreliable here) and check `netstat` that port 3001 is free before restarting.
