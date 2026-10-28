import fs from 'node:fs';
import path from 'node:path';
import { root } from './config.js';
import { logger } from './logger.js';

// Compares the installed commit (data/versi.txt, written by Mulai/Update) with
// the newest commit on GitHub, so the console can say "this is not the latest bot".
// Skipped on a git checkout (the developer's PC) and when versi.txt is missing.

const FIRST_CHECK_MS = 60 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 15 * 1000;

const state = { available: false, latest: null, installed: null, checkedAt: null, error: null };
let warnedFor = null;

/** scripts/repo.txt: "https://github.com/owner/repo [branch]", comments start with #. */
export const readRepo = (text) => {
    const line = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    const match = line?.match(/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?(?:\s+(\S+))?$/i);

    return match ? { owner: match[1], repo: match[2], branch: match[3] || 'main' } : null;
};

const readFile = (file) => {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return null;
    }
};

/** One check. `dir` and `fetchImpl` are injectable for tests. */
export async function checkUpdate({ dir = root, fetchImpl = fetch } = {}) {
    if (fs.existsSync(path.join(dir, '.git'))) return { ...state, skipped: 'git' };

    const installed = readFile(path.join(dir, 'data', 'versi.txt'))?.trim() || null;
    const repo = readRepo(readFile(path.join(dir, 'scripts', 'repo.txt')));
    if (!installed || !repo) return { ...state, skipped: installed ? 'repo' : 'versi' };

    state.installed = installed.slice(0, 7);
    state.checkedAt = new Date().toISOString();
    try {
        const response = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${repo.branch}`, {
            headers: { 'User-Agent': 'ChatBot-Prema-Updater', Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`GitHub menjawab ${response.status}`);
        const sha = String((await response.json())?.sha ?? '');
        if (!sha) throw new Error('GitHub tidak memberi nomor versi');

        state.latest = sha.slice(0, 7);
        state.available = sha !== installed;
        state.error = null;
        if (state.available && warnedFor !== sha) {
            warnedFor = sha;
            logger.warn(
                { installed: state.installed, latest: state.latest },
                'Bot ini belum versi terbaru: ada versi baru di GitHub. Tutup jendela bot, lalu klik "Mulai ChatBot Prema" (pembaruan dipasang otomatis).',
            );
        }
    } catch (error) {
        // No internet is normal on this PC now and then: keep the last answer, no pop-up.
        state.error = error.message;
        logger.info({ err: error.message }, 'cek versi terbaru gagal');
    }

    return { ...state };
}

export const updateStatus = () => ({ ...state });

export function startUpdateCheck(options) {
    const run = () => checkUpdate(options).catch((error) => logger.info({ err: error.message }, 'cek versi terbaru gagal'));
    setTimeout(run, FIRST_CHECK_MS).unref();
    setInterval(run, EVERY_MS).unref();
}
