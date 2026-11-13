# ChatBot Prema

## Working rules

- Customer content uses Indonesian; identifiers use English.
- Keep all project code free of comments. Document decisions here or in README.md.
- Use descriptive names and focused functions. Avoid duplicated state and unnecessary abstractions.
- Never inspect workspace data/, logs/, .env, or production databases to diagnose a client's PC. Use evidence supplied from that PC.
- Set DB_PATH=:memory: or a temporary path before importing application modules in tests. Simulate WhatsApp and AI. Never connect real accounts in automated tests.
- Run npm.cmd test after changes. Add regression tests for behavior fixes; do not delete coverage to make tests pass.
- Never modify node_modules. Apply narrow compatibility wrappers in application code.
- Add numbered migrations for existing databases and new seeds. Preserve shop edits and deletions; never change shipped seeds to update clients.

## Product

ChatBot Prema is Mawar, the WhatsApp Business assistant for Prema Konveksi. It is separate from PREMA OS and shares no API or database with it. Do not add integration without an explicit request.

Production uses AI mode only. Settings cannot reactivate naskah. Historical scripted code and tests remain for regression coverage. Do not restore pattern or teaching HTTP routes or menus.

The shop edits Produk, Pengetahuan, Sapaan & pesan, Promo, Atur AI, Media, and Pengaturan through the dashboard. Saved changes apply without restart. Clients should not need to edit files.

Ollama is the only AI provider. Answers use shop knowledge, product details, and active promotions in the shop timezone. Never invent facts, prices, discounts, totals, delivery promises, or missing knowledge. Prices, negotiations, and final offers go to CS. Owner-approved fixed surcharges/design fees can be quoted exactly under the reply guards. Approved promotion wording is allowed.

Code maintains order answers, follow-up questions, completion, and media. Pending size lists wait for detailWaitDays. Send uploaded size charts and measurement guidance before asking for sizes. Ask which product when unknown.

Default activity: Monday–Saturday 17:30–07:30 and all Sunday, Asia/Jakarta. Editable windows can cross midnight or run during the day. Bot and CS names are configuration.

## Multi-device decisions

The intended deployment is one bot, the owner, and two admins on one account. Their linked devices are legitimate. Never tell the client to unlink all devices except the bot.

- Device 0 means main phone.
- The socket's own device number means the sender claims the bot's identity; this alone does not prove another bot exists.
- Other nonzero device numbers mean other linked devices, including admins.
- Missing or invalid sender addresses mean unknown, never assumed to be the phone.

fromMe identifies the account, not a physical device. remoteJid identifies the conversation, not necessarily the sender. Preserve device numbers when translating LID addresses to phone addresses.

Readable IDs survive restart through seen_messages. Ignore failed re-deliveries of already readable messages. MessageCounterError alone proves neither duplication nor broken pairing. Track unproven messages; do not renew sessions based only on a used counter.

Admin session recovery targets the exact sender address with a persisted ten-minute cooldown per device. Admin and unknown-sender failures must not reconnect the entire account, including through the stuck-repair watchdog. Allow a newly renewed phone session time to work before reconnecting.

Bound each recovery network operation to twenty seconds so an unresponsive admin does not block every other recovery. Persist confirmed phone recovery timestamps so restart cannot turn older pending messages into a fresh phone alarm.

Only completed phone renewals count toward relink escalation. Do not trust legacy success counts. Unknown senders and admins cannot trigger phone relink. Readable admin messages cannot declare the main phone repaired. Scan ulang is a last resort after at least two completed phone renewals and thirty minutes of failed phone recovery, not proof of corrupt pairing.

An unreadable fromMe message may be an admin reply. Hold the affected customer's outgoing replies for three minutes. If still unreadable, cancel that customer's pending work and hand the chat to CS with reason pesan perangkat toko belum terbaca. Other chats continue. Persist the decision across restart; never resume merely because the hold expired.

Recheck cancellation and unreadable own-message holds after typing, immediately before socket.sendMessage. Takeover and reset invalidate old queued replies and late AI results. An already submitted network send cannot be recalled.

Never restore consumed Signal keys, erase pairing for network failures, or trust changed identities automatically. Preserve raw errors during repair. Warnings must describe evidence without asserting bot duplication, database restoration, or corrupt pairing without proof.

Catalog timeouts are independent of decryption. Preserve the last catalog and uploaded files, retry with limits, and never claim a timeout proves an empty catalog or a non-Business account.

## Reliability

SQLite uses WAL and synchronous FULL. One process per account database. Pairing survives restart; official logout clears it. Stop reconnecting on a connection conflict rather than fighting another connection.

Journal input and its log atomically before debounce/AI. Count attempts before execution. Commit conversation state, outgoing messages, and input completion together. Retry transient failures with backoff; after five attempts or fifteen minutes, mark for CS. Never invent fallback replies after AI failure/refusal.

Allocate and log outgoing IDs before sending. Reuse IDs after reconnect/restart. Cancel customer replies older than fifteen minutes. Store original outgoing protobuf messages for seven days, including media keys, for retry requests.

Save the prepared outgoing protobuf through patchMessageBeforeSending before encryption and network relay. A linked owner/admin device may request it before sendMessage returns. Use an AsyncLocalStorage context per send so parallel customer messages cannot overwrite each other's retry data. Store the original message, not the deviceSentMessage wrapper used for own-device copies. Retry prepared messages using relayMessage with the same ID, media keys, and a refreshed device list; do not regenerate media for an existing ID. Recheck takeover while media is being prepared.

Prepared payloads are immutable per session/message ID; later echoes cannot replace their keys. Retry lookup verifies the original conversation, accepting learned LID/phone aliases. Retention must not prune payloads still in the durable outgoing queue. sendText must use the same logged, durable sender as other outgoing messages.

Baileys 6.7.24's direct retry relay treats own LID participants as non-self when compared with the own phone ID. The application intercepts only retry receipts from its authenticated own LID to direct chats. Route the participant through the authenticated own phone alias, preserving device number, so Baileys generates deviceSentMessage and the recipient attribute correctly. Renew the actual encryption session: own LID for LID conversations, own phone alias for phone conversations. Acknowledge the original unmodified LID receipt. Serialize retries per physical device, coalesce simultaneous duplicates, cap attempts at five, and bound network operations. Customer receipts, PN receipts, groups, and normal acknowledgements keep their original handling. Never infer an alias from an unrelated sender.

Supply a per-connection device cache with the original five-minute TTL and invalidate affected users on devices notifications. Invalidate both authenticated own aliases when the shop's device list changes. Stopped sockets cannot change own identity mappings. Late catch-up messages from active hours must reach CS without aborting the rest of the batch.

Use separate deadlines for AI, WhatsApp sends, handshake, and recovery. Late work cannot overwrite reset or newer recovery. Keep recap content and per-recipient IDs until all recipients have been served.

Daily backup/cleanup retries missed work at startup. Defaults: fourteen backup copies and ninety days of history. Updates preserve data/, media/, logs/, and .env.

## AI keys

Up to four Ollama keys (Atur AI, columns 1-4; env OLLAMA_API_KEY, OLLAMA_API_KEY_2..4 as first defaults). They are used in order and the working key stays in use: key 1 until Ollama answers 429, then key 2, and so on (src/ai-keys.js). A refusal moves to the next key inside the same request, so no customer waits for a retry. The working key and each rest time are saved in settings (ai:key_state, keyed by a sha256 prefix, never the key), so a restart continues on the working key and does not ask exhausted keys again. A damaged saved state starts clean.
- The Atur AI page is four numbered sections (Kunci API, Model dan koneksi, Gaya bicara dan contoh, Batas pemakaian) with a sticky save bar that says when changes are unsaved. Each key is a card whose state is shown in words and colour (Sedang dipakai, Cadangan, Habis jatah, Ditolak, Kosong); the key field opens only on Ganti. Design rules used: existing tokens only, calm hover (no lift), instant press feedback, 44px touch targets on coarse pointers, reduced motion and reduced transparency respected, no colour-only state. Keep the field names the save code reads (aiKey1..4, aiKeyCooldown, aiModel, aiHost, aiChatPrompt, aiChatExamples, aiPerCustomer, aiTotal, aiTimeout).
- Dashboard look (src/console.html): warm paper palette in light, warm charcoal in dark, emerald accent; page titles, card titles, the hero and KPI numbers use a serif stack (`--serif`, system fonts only, no external fonts); the sidebar floats as a rounded translucent panel with groups (Percakapan, Isi bot, Sistem) and a solid accent pill for the open page; every page has a one-line subtitle (`SUBS`, one entry per `TITLES` key); on Ringkasan the bot status leads and "Siap mulai" is one line of chips when everything is ready, listing only the problems otherwise. Below 760px the sidebar becomes a horizontal bar. The sidebar is the only `<aside>`: a stray or unclosed one once swallowed the whole main area. The page HTML is read once at boot, so a running bot shows the old page until it is restarted and the browser reloaded (Ctrl+F5).
- Dashboard design system (whole console, src/console.html): one shared layer at the end of the stylesheet. A hint is a `<small>` under its label (never inline text after it); form controls (select, checkbox, radio, textarea, scrollbars) follow the theme; links use the accent colour; charts use the accent colour (`--series`); buttons give instant press feedback, a visible keyboard focus ring and 44px targets on touch; reduced motion and reduced transparency are respected; accordion headers (`.pola-sum`) work from the keyboard; the help button must never cover a Save button (`.aisave` keeps room for it); long editors keep Save and Delete in a sticky side card. The class `check` belongs to the readiness list: use `lb-check` for checkbox labels. Verify layout by screenshots against an in-memory database, not by reading code.
- No remaining-quota display: Ollama gives no usable token count for free keys, and the shop chose plain rotation. When a key is out the bot moves on silently; only when every key has been checked and is out does one warning ("semua kunci AI sudah dicek satu per satu dan semuanya habis jatahnya") and the red Siap mulai appear.

- The admin can pick the key to use now (button Pakai sekarang, POST /ai/key/:slot/use). It becomes the working key, is saved across restarts, and clears that key's rest mark. If it runs out the bot still moves on to the next key instead of going silent. Choosing an empty column is refused.
- 429 with a usage-limit message rests the key for the editable time (Jeda kunci, default 30 min). Any other 429 rests it for one minute, because short rate limits are not quota.
- 401/403 rests the key for a day and raises a warning with its guide (replace the key).
- 402 (Ollama asks for credits or a subscription) is treated like a spent quota: the key rests for the editable time and the request moves to the next key in the same call. The retry rule counts 402 as transient, so when every key is out the message waits and retries (five attempts or fifteen minutes) instead of going straight to CS. Incident 2026-11-12: the shop's keys answered 402, the old code only rotated on 401/403/429, so every chat was handed to CS with "AI tidak dapat menjawab" and the bot stayed silent for each of them for 24 hours.
- Chats handed over with a reason starting "AI tidak dapat menjawab" return to the bot by themselves (src/ai-recovery.js, every minute) once the AI is verified: when chats waiting on a failed AI exist (or the last AI call failed) and a key is no longer resting, the bot sends one tiny test request (healAi, at most every five minutes, nothing when all is well) so no customer is the first to find out, and only a successful answer releases the chats. No manual button; chats handed over for any other reason (customer asked for CS, CS replied, complaint) are never released this way. The customer's earlier unanswered message is not re-answered (replies older than fifteen minutes are cancelled); CS still sees it in the recap.
- All keys resting raises one warning per episode and a retryable 429 error. The input retries as before and, after five attempts or fifteen minutes, goes to CS. Siap mulai fails only when every key is out and names the resting ones otherwise.
- The same key cannot fill two columns. Only the last four characters reach the dashboard. Keys are never logged.
- No keys with a configured host (local Ollama) sends no Authorization header and never rotates.
- Test with simulated fetch only; automated tests never call Ollama.

## Token saving, owner alerts, unanswered questions, restore

- Token saving (Atur AI, "Hemat token", default on, setting ai:trim_knowledge): the prompt sends full text only for the Info toko topics and Tanya-jawab related to the current message (word overlap with the message, the last two customer messages and the product, src/bot/relevance.js). Short topics (240 characters or less) and topics pinned by title ("Jam kerja", which the WAKTU SEKARANG block points to) always stay; the rest become one line saying the content exists but is not shown. Safety net in askChat: if the AI gives up (hands over as tidak_bisa_bantu, or its fakta says tidak ada di data with no reply) or the reply guard refuses after data was left out, the same message is asked once more with the full data. Never remove the safety net; without it a missed word match turns into a false "tanya CS". Product details are already trimmed by focus.
- Owner alerts (src/alerts.js, Pengaturan > Rekap pagi dan peringatan, setting alertsOn): the recap numbers also receive WhatsApp messages when a known tindak-level error appears (the same guide text the dashboard shows; entries marked push:false in GUIDE, such as the update reminder, are skipped) and after the bot was disconnected for more than ten minutes. A disconnected bot cannot send WhatsApp, so the gap is reported after reconnecting, using the persisted alert:connected_at stamp; it also covers a PC that was off. The same cause is repeated at most every six hours (alert:sent). A failed send leaves the cause pending for the next check. The text states the length of the gap and never guesses a cause.
- Unanswered questions (table unanswered, migration 025, Pengetahuan page): when the AI hands a chat over as tidak_bisa_bantu, or says the fact is not in the data and names what is missing, chatTurn returns unanswered and the bot records it inside the same transaction that queues the replies. Real chats only: self-tests and retryable failures are not recorded. The same question is counted once (fingerprint of the normalised text). "Jawab sebagai tanya-jawab" opens a new tanya-jawab prefilled with the question and closes the item when it is saved; "Abaikan" keeps it dismissed even if asked again; an answered one reopens if customers ask it again, which means the answer does not match.
- Handover brief (src/bot/brief.js): GET /conversations/:session/:jid returns brief (want, have, missing, note) computed in code from order_info and notes, never by the AI. Answers marked menyusul count as missing. The conversation pane shows it above the full detail, and "Jadikan uji" saves the customer messages of the chat as an Uji AI scenario with #angka-uang forbidden.
- Restore (maintenance.js restoreContent, Pengaturan > Pulihkan isi toko): only shop content is restored from a daily backup (products, custom_keywords, store_info, faq, promotions, ai_scenarios and the settings keys cfg:, reply:, link:, catmap: plus the four AI prompt texts). Conversations, message history, WhatsApp pairing and Signal keys, AI keys and rest state, and job/alert bookkeeping are never restored: restoring old Signal keys is forbidden. A safety copy (sebelum-pulih-*.sqlite, last five kept, not offered as a backup) is taken first; the backup is checked with quick_check; the whole replacement is one transaction. Only names matching chatbot-YYYY-MM-DD.sqlite are accepted.
- Catalog reading (Media > Katalog WhatsApp Business): a failed sync warns once per episode (Ringkasan table and pop-up); the quiet retries that follow back off 30 minutes, 2 hours, then 6 hours until one succeeds (session.catalogFailures), and the Media page keeps showing the last error. "Tes koneksi" (POST /catalog/test, testCatalog in src/bot/catalog.js) asks WhatsApp for five products with a 25 second limit and answers in plain words: ok with a sample, kosong, timeout (never claimed to mean an empty catalog), tidak_ada_katalog, belum_tersambung. It runs by itself after a katalog link is saved, using the number in that link, and a successful test syncs the catalog at once.
- Guide matching: a specific guide whose text appears in the error detail now beats a generic one that matched only the message (guides marked generic: true, currently "gagal memproses pesan"). "AI gagal membalas" is deliberately not generic: its detail never takes over. File upload failures and a missing media file have their own guides, so a failing catalog or size chart send is explained in the Ringkasan table.

- Statistik no longer shows intent labels (AI-only mode labels everything "ai"); it shows the share of conversations handed to CS, the most discussed products and the open unanswered questions. On narrow screens the menu bar must keep its own row height: the .app grid uses grid-template-rows:auto minmax(0,1fr) so a tall viewport does not stretch it.

- Ringkasan lists the problems of the last 24 hours as a table Jam, Kode, Masalah, Solusinya (src/error-summary.js, table error_log, migration 026). Rows come from recordError through a sink, so they survive restarts; notes (guide level info) are skipped; the same message within ten minutes is one row with a count; rows older than fourteen days are pruned by the daily job. Kode is the technical code found in the message or detail (HTTP status such as 402, errno such as ECONNRESET, a named error), otherwise the guide number G01..., otherwise ?. Every warning and error is listed with its meaning and solution: quiet log lines (retries) and info-level notes are included, and only quiet ones skip the pop-up; the order is tindak, cek, then notes, and up to sixty causes are shown. Known problems group by their guide meaning, unknown ones by their raw message so a new error is never hidden inside another.

- Self-healing record: every automatic recovery is written to the activity log with source pemulihan (src/heal-log.js) and shown on Ringkasan under "Dipulihkan otomatis": key switches, chats returned after the AI came back, the catalog read again after failures, WhatsApp reconnected after a gap. Already self-healing before this and left alone: delivery flush every 30 seconds, resuming pending incoming messages, reconnect with backoff, decryption recovery, catalog retries, daily jobs retried at startup and the process watchdog. New recoveries should call healed() so the owner can see them.

## Architecture

| Location | Responsibility |
| --- | --- |
| src/index.js, src/console.html | HTTP API, boot, dashboard; escape untrusted content |
| src/session.js, src/manager.js | Socket lifecycle, events, transport, sessions |
| src/auth-state.js | SQLite pairing and atomic key batches |
| src/message-healing.js | Persistent decryption recovery and device diagnostics |
| src/lid.js, src/baileys-fixes.js | Address mapping, fallback, compatibility wrappers |
| src/bot/bot.js, src/bot/chat.js | Per-chat queues, takeover, guarded AI conversation |
| src/inbox.js, src/delivery.js, src/bot/store.js | Durable work, conversations, history |
| src/outgoing-messages.js | Per-send prepared protobuf persistence and stable outgoing retries |
| src/own-device-retry.js | Bounded own-LID retry routing, original acknowledgements, per-device serialization |
| src/bot/catalog.js, src/bot/media.js | Catalog and uploaded assets |
| src/db.js, src/migrations.js | Initialization and in-place migrations |
| src/settings.js, src/ai-settings.js | Editable runtime configuration |
| src/maintenance.js | Backup, retention, recap, restore of shop content |
| src/alerts.js | WhatsApp alerts to the owner numbers |
| src/error-summary.js, src/ai-recovery.js | Persistent problem table for Ringkasan, automatic return of chats handed over by a failing AI |
| src/bot/relevance.js, src/bot/unanswered.js, src/bot/brief.js | Prompt trimming, unanswered question list, handover brief |
| src/errors.js, src/activity.js | Guidance and activity feed |
| scripts/launcher.ps1, scripts/health-watchdog.ps1 | Windows install, update, startup, owned-process supervision |
| test/multidevice.test.js | Multi-device recovery and takeover simulations |

Importing index.js must not connect WhatsApp or install process-wide signal/crash handlers. Listen on HTTP before WhatsApp boot so a busy port stops a second instance.

Keep exactly two client batch files: Mulai ChatBot Prema.bat and Update ChatBot Prema.bat. Mulai checks updates except in git checkouts. Update installs and stops, then asks the user to run Mulai. Never kill unrelated Node processes. Watchdog verifies supervisor ancestry and exact entry paths.

## Validation

- npm.cmd test: full suite using isolated storage.
- node --test test/multidevice.test.js: focused simulations.
- node --test test/runtime.test.js: HTTP dashboard and connected socket lifecycle using a simulated transport.
- node --test test/outgoing-sync.test.js: early own-device retries, stable media/PDF keys, parallel sends, and cancellation during media preparation.
- node --test test/own-device-retry.test.js: own-LID receipt routing, request isolation, retry budgets, deadlines, and acknowledgements.
- test/baileys-relay-fixture.js executes the installed Baileys relay with simulated network/key storage under a VM, comparing baseline and corrected PN/LID routing for text, images, and PDFs. It does not modify node_modules or connect WhatsApp.
- Integrity checks cover JavaScript/dashboard syntax, control characters, templates, seeds, and launcher encoding.
- Windows tests exercise launcher/watchdog code against simulated process lists.
- Simulation proves the tested behavior, not decryption on real client devices. Validate four-device operation on the client PC after installing the update.
