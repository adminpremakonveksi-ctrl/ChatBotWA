import { recordActivity } from './activity.js';
import { all } from './db.js';

export const HEAL_SOURCE = 'pemulihan';

export const healed = (action, detail = null) => recordActivity({ source: HEAL_SOURCE, action, detail });

export const listHealed = (hours = 24, limit = 40) =>
    all(
        `SELECT at, action, detail FROM activity_log WHERE source = ? AND at >= datetime('now', ?) ORDER BY id DESC LIMIT ?`,
        [HEAL_SOURCE, `-${Math.min(24 * 14, Math.max(1, Number(hours) || 24))} hours`, limit],
    );
