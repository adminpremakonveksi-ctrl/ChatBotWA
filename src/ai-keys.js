import { createHash } from 'node:crypto';

import { config } from './config.js';
import { getSetting, setSetting } from './db.js';
import { logger } from './logger.js';

export const MAX_KEYS = 4;
export const DEFAULT_COOLDOWN_MINUTES = 30;
export const TRANSIENT_COOLDOWN_MS = 60000;
export const REJECTED_COOLDOWN_MS = 24 * 60 * 60000;

const STATE_KEY = 'ai:key_state';
const USAGE_LIMIT = /usage|limit|quota|upgrade|exceeded|weekly|daily|hourly|session/i;

const resting = new Map();
let current = 0;
let announcedAllResting = false;
let loaded = false;

const fingerprint = (key) => createHash('sha256').update(key).digest('hex').slice(0, 16);

const persist = (now = Date.now()) => {
    try {
        const live = Object.fromEntries([...resting].filter(([, hold]) => hold.until > now));
        setSetting(STATE_KEY, JSON.stringify({ current, resting: live }));
    } catch (error) {
        logger.info({ err: error.message }, 'status kunci AI tidak tersimpan, hanya diingat selama bot jalan');
    }
};

const load = () => {
    if (loaded) return;
    loaded = true;

    try {
        const stored = JSON.parse(getSetting(STATE_KEY) || 'null');
        if (Number.isInteger(stored?.current) && stored.current >= 0 && stored.current < MAX_KEYS) current = stored.current;
        for (const [hash, hold] of Object.entries(stored?.resting ?? {})) {
            if (Number.isFinite(hold?.until) && (hold.reason === 'habis' || hold.reason === 'ditolak')) resting.set(hash, { until: hold.until, reason: hold.reason });
        }
    } catch {
        resting.clear();
        current = 0;
    }
};

export const keySlots = () => Array.from({ length: MAX_KEYS }, (_, index) => (index === 0 ? config.ollama.apiKey : config.ollama.extraKeys?.[index - 1]) || '');

export const hasKeys = () => keySlots().some(Boolean);

const restingMs = () => (config.ollama.keyCooldownMinutes || DEFAULT_COOLDOWN_MINUTES) * 60000;

const holdOf = (key) => resting.get(fingerprint(key));

const isResting = (key, now) => (holdOf(key)?.until ?? 0) > now;

const firstUsable = (slots, now) => {
    for (let step = 0; step < MAX_KEYS; step++) {
        const index = (current + step) % MAX_KEYS;
        if (slots[index] && !isResting(slots[index], now)) return index;
    }

    return -1;
};

export function pickKey(now = Date.now()) {
    load();
    const slots = keySlots();
    if (!slots.some(Boolean)) return { slot: 0, key: '' };

    const index = firstUsable(slots, now);
    if (index < 0) return null;

    if (index !== current) {
        logger.info({ from: current + 1, to: index + 1 }, `kunci AI ${current + 1} sedang tidak bisa dipakai, pindah ke kunci ${index + 1}`);
        current = index;
        persist(now);
    }
    announcedAllResting = false;

    return { slot: index + 1, key: slots[index] };
}

export function chooseKey(slot, now = Date.now()) {
    load();
    const number = Number(slot);
    const key = Number.isInteger(number) ? keySlots()[number - 1] : '';
    if (!key) throw Object.assign(new Error(`Kunci ${slot} belum diisi: isi kunci itu dulu di Atur AI`), { statusCode: 422 });

    resting.delete(fingerprint(key));
    current = number - 1;
    announcedAllResting = false;
    persist(now);
    logger.info({ slot: number }, `kunci AI ${number} dipilih admin untuk dipakai sekarang`);

    return keyStatus(now);
}

export const currentKey = () => pickKey()?.key ?? keySlots().find(Boolean) ?? '';

export function markKey(key, status, message = '', now = Date.now()) {
    if (!key) return;
    load();

    const rejected = status === 401 || status === 403;
    const duration = rejected ? REJECTED_COOLDOWN_MS : USAGE_LIMIT.test(String(message)) ? restingMs() : TRANSIENT_COOLDOWN_MS;
    resting.set(fingerprint(key), { until: now + duration, reason: rejected ? 'ditolak' : 'habis' });
    persist(now);

    if (rejected) {
        const slot = keySlots().indexOf(key) + 1;
        logger.warn({ slot, status }, `kunci AI ${slot} ditolak Ollama (tidak valid), dilewati`);
    }
}

export function allRestingError(now = Date.now()) {
    load();
    const filled = keySlots().filter(Boolean);
    const recovery = Math.min(...filled.map((key) => holdOf(key)?.until ?? now));

    if (!announcedAllResting) {
        announcedAllResting = true;
        logger.warn({ keys: filled.length, recoversAt: new Date(recovery).toISOString() }, 'semua kunci AI sudah dicek satu per satu dan semuanya habis jatahnya: bot diam sampai ada yang pulih');
    }

    return Object.assign(new Error('Ollama 429: semua kunci AI sudah dicek satu per satu dan semuanya habis jatahnya'), { status: 429 });
}

export function keyStatus(now = Date.now()) {
    load();
    const slots = keySlots();
    const active = firstUsable(slots, now);

    return slots.map((key, index) => {
        const slot = index + 1;
        if (!key) return { slot, state: 'kosong', until: null };

        const hold = holdOf(key);
        if (hold && hold.until > now) return { slot, state: hold.reason, until: new Date(hold.until).toISOString() };

        return { slot, state: index === active ? 'aktif' : 'siap', until: null };
    });
}

export function resetKeyStates() {
    loaded = true;
    resting.clear();
    current = 0;
    announcedAllResting = false;
    persist();
}

export function reloadKeyStates() {
    loaded = false;
    resting.clear();
    current = 0;
    announcedAllResting = false;
}
