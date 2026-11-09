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

The shop edits Produk, Pengetahuan, Sapaan & pesan, Promo, Gaya bicara AI, Media, and Pengaturan through the dashboard. Saved changes apply without restart. Clients should not need to edit files.

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
| src/maintenance.js | Backup, retention, recap |
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
