import { z } from 'zod';

import { pickKey } from './ai-keys.js';
import { lastOllamaCall, ollamaEnabled, ollamaJson } from './bot/classify-ollama.js';
import { countAiFailures, releaseAiFailures } from './bot/store.js';
import { healed } from './heal-log.js';
import { logger } from './logger.js';

const log = logger.child({ part: 'ai-recovery' });

export const PROBE_EVERY_MS = 5 * 60000;

const probeSchema = z.object({ ok: z.boolean() });
const probeState = { at: 0 };

export const resetProbe = () => {
    probeState.at = 0;
};

export const aiIsUsable = () => ollamaEnabled() && Boolean(pickKey()) && lastOllamaCall()?.ok !== false;

export function recoverAiHandovers() {
    if (!aiIsUsable()) return 0;

    const released = releaseAiFailures();
    if (released) healed(`AI bisa dipakai lagi: ${released} chat yang dioper karena AI gagal dikembalikan ke bot`, 'otomatis');

    return released;
}

export const needsProbe = () => countAiFailures() > 0 || lastOllamaCall()?.ok === false;

export async function probeAi({ fetchImpl, now = Date.now() } = {}) {
    if (!ollamaEnabled() || !pickKey()) return 'dilewati';
    if (now - probeState.at < PROBE_EVERY_MS) return 'baru dicek';
    probeState.at = now;

    try {
        await ollamaJson({ system: 'Balas hanya dengan {"ok": true}.', user: 'tes', schema: probeSchema }, fetchImpl ? { fetchImpl } : {});

        return 'ok';
    } catch {
        return 'gagal';
    }
}

export async function healAi({ fetchImpl, now = Date.now() } = {}) {
    if (!needsProbe()) return { probe: 'tidak perlu', released: 0 };

    const probe = await probeAi({ fetchImpl, now });

    return { probe, released: probe === 'ok' ? recoverAiHandovers() : 0 };
}

export function startAiRecovery() {
    let running = false;

    const tick = async () => {
        if (running) return;
        running = true;

        try {
            const { released } = await healAi();
            if (released) log.info({ released }, 'AI sudah bisa dipakai lagi: chat yang dioper karena AI gagal dikembalikan ke bot');
        } catch (error) {
            log.info({ err: error.message }, 'pengembalian chat ke bot belum berhasil, dicoba lagi');
        } finally {
            running = false;
        }
    };

    const first = setTimeout(tick, 30000);
    const timer = setInterval(tick, 60000);

    return () => {
        clearTimeout(first);
        clearInterval(timer);
    };
}
