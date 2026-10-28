import { config } from './config.js';
import { lastOllamaCall, ollamaEnabled } from './bot/classify-ollama.js';
import { meaningOf } from './errors.js';
import { updateStatus } from './update-check.js';

// "Siap mulai" on Ringkasan: what this PC needs before the bot can work, checked
// live, each with what to do in plain words. Raw errors are kept beside them.

const NET_TIMEOUT_MS = 8000;
const CLOCK_SKEW_MS = 2 * 60 * 1000;
const CACHE_MS = 60 * 1000;

let cached = null;

const check = (key, title, ok, detail, fix = '', raw = '') => ({ key, title, ok, detail, fix, raw });

/** Reaches WhatsApp's servers; their Date header also tells whether the PC clock is right. */
async function internet(fetchImpl) {
    const started = Date.now();
    try {
        const response = await fetchImpl('https://web.whatsapp.com/', { method: 'HEAD', signal: AbortSignal.timeout(NET_TIMEOUT_MS) });

        return { ok: true, ms: Date.now() - started, serverTime: Date.parse(response.headers.get('date') ?? '') || null };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function whatsapp(main) {
    const raw = main?.lastError ?? '';
    if (!main) return check('wa', 'Nomor WhatsApp tersambung', false, 'Belum ada nomor.', 'Tambahkan nomor dan scan QR di kartu WhatsApp.');
    if (main.connected) return check('wa', 'Nomor WhatsApp tersambung', true, `+${main.phoneNumber ?? ''}`);
    const fixes = {
        qr: 'Buka WhatsApp Business di HP toko > Perangkat tertaut > Tautkan perangkat, lalu scan QR di kartu WhatsApp.',
        logged_out: 'Perangkat ini dilepas dari HP. Scan QR lagi di kartu WhatsApp.',
        replaced: 'Nomor ini dipakai bot lain (PC lain / jendela kedua). Matikan yang lain, lalu klik "Sambungkan lagi" di kartu WhatsApp.',
        connecting: 'Sedang menyambung, tunggu sebentar.',
    };

    return check('wa', 'Nomor WhatsApp tersambung', false,
        main.state === 'connecting' ? 'Sedang menyambung…' : `Status: ${main.state}`,
        fixes[main.state] ?? meaningOf(raw) ?? 'Cek internet PC ini; bot menyambung ulang sendiri.', raw);
}

async function ai(fetchImpl) {
    const title = 'AI bisa menjawab';
    if (!ollamaEnabled()) {
        return check('ai', title, false, 'Kunci AI belum diisi: setelah sapaan bot diam.', 'Isi kunci di Pengaturan > AI.');
    }
    const headers = config.ollama.apiKey ? { Authorization: `Bearer ${config.ollama.apiKey}` } : {};
    const started = Date.now();
    try {
        const response = await fetchImpl(`${config.ollama.host}/api/tags`, { headers, signal: AbortSignal.timeout(NET_TIMEOUT_MS) });
        if (!response.ok) throw new Error(`Ollama ${response.status}`);
    } catch (error) {
        return check('ai', title, false, `Server AI (${config.ollama.host}) tidak terjangkau.`, meaningOf(error.message) ?? 'Cek internet PC ini.', error.message);
    }
    const ms = Date.now() - started;
    const last = lastOllamaCall();
    const limit = Math.round(config.ollama.timeoutMs / 1000);
    if (last && !last.ok) {
        return check('ai', title, false, `Server AI terjangkau (${ms} ms), tapi jawaban terakhir gagal.`, meaningOf(last.error) ?? '', last.error);
    }

    return check('ai', title, true, last ? `jawaban terakhir ${(last.ms / 1000).toFixed(1)} detik (batas ${limit} detik)` : `server terjangkau (${ms} ms), batas ${limit} detik`);
}

function version() {
    const up = updateStatus();
    if (up.available) {
        return check('versi', 'Bot versi terbaru', false, `terpasang ${up.installed}, terbaru ${up.latest}`, 'Tutup jendela bot, lalu klik "Mulai ChatBot Prema": pembaruan dipasang otomatis, data dan chat tidak hilang.');
    }

    return check('versi', 'Bot versi terbaru', true, up.latest ? `versi ${up.installed}` : up.error ? `belum bisa dicek (${up.error})` : 'dicek otomatis tiap beberapa jam');
}

/** All checks; cached a minute so opening Ringkasan repeatedly does not hammer the network. */
export async function startupChecks({ manager, fresh = false, fetchImpl = fetch, now = Date.now } = {}) {
    if (!fresh && cached && now() - cached.at < CACHE_MS) return cached.result;

    const [net, aiCheck] = await Promise.all([internet(fetchImpl), config.bot.mode === 'ai' ? ai(fetchImpl) : null]);
    const checks = [
        net.ok
            ? check('internet', 'Internet tersambung', true, `WhatsApp terjangkau (${net.ms} ms)`)
            : check('internet', 'Internet tersambung', false, 'PC ini tidak bisa menjangkau WhatsApp.', 'Cek Wi-Fi atau kabel LAN, pastikan modem nyala dan kuota ada. Bot jalan lagi sendiri begitu internet kembali.', net.error),
    ];
    if (net.ok && net.serverTime) {
        const skew = now() - net.serverTime;
        checks.push(Math.abs(skew) > CLOCK_SKEW_MS
            ? check('jam', 'Jam PC benar', false, `Jam PC ${skew > 0 ? 'lebih cepat' : 'lebih lambat'} ${Math.round(Math.abs(skew) / 60000)} menit.`, 'Windows: Settings > Time & language > Date & time > nyalakan "Set time automatically", lalu klik "Sync now". Jam salah membuat WhatsApp gagal tersambung dan jam jaga bot meleset.')
            : check('jam', 'Jam PC benar', true, 'sesuai jam internet'));
    }
    checks.push(whatsapp(manager?.list?.()[0]));
    if (aiCheck) checks.push(aiCheck);
    checks.push(version());

    const result = { ready: checks.every((c) => c.ok), checkedAt: new Date(now()).toISOString(), checks };
    cached = { at: now(), result };

    return result;
}
