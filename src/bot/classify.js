import Anthropic from '@anthropic-ai/sdk';

import { logger } from '../logger.js';
import { aiEnabled, classifyWithAi } from './classify-ai.js';
import { classifyWithRules } from './classify-rules.js';
import { patternForBuiltin } from './patterns.js';

// AI labels whose answers are seeded answer patterns (Lokasi, Pengiriman, Ragu, Minimal order).
const PATTERN_LABELS = ['location', 'shipping', 'trust', 'moq'];

const pack = (p) => ({ id: p.id, name: p.name, bubbles: p.bubbles, after: p.after, builtin: p.builtin });

/**
 * The AI still says "location" or "moq"; those answers are now patterns the
 * team edits or deletes. Point each label at its pattern. A label whose
 * pattern was deleted becomes "other", so CS takes the question.
 */
function toPatterns(result) {
    const labels = [result.intent, ...result.extras].filter((label) => PATTERN_LABELS.includes(label));
    const patterns = labels.map(patternForBuiltin).filter(Boolean).map(pack);
    const extras = result.extras.filter((label) => !PATTERN_LABELS.includes(label));

    if (!PATTERN_LABELS.includes(result.intent)) return { ...result, extras, patterns: [...(result.patterns ?? []), ...patterns] };

    return patterns.length
        ? { ...result, intent: 'custom', extras, patterns, pattern: patterns[0] }
        : { ...result, intent: 'other', extras, patterns: [], pattern: null };
}

/**
 * AI first when configured, keywords otherwise. Any AI failure (no network,
 * rate limit, timeout, refusal) falls back to keywords so the bot keeps
 * answering instead of going quiet.
 */
export async function classify(input) {
    const rules = classifyWithRules(input);

    // A team pattern is matched by its own keywords: use it as is, no AI.
    if (!aiEnabled() || rules.intent === 'custom') {
        return rules;
    }

    try {
        return toPatterns(await classifyWithAi(input));
    } catch (error) {
        const reason =
            error instanceof Anthropic.RateLimitError ? 'rate limit' :
            error instanceof Anthropic.AuthenticationError ? 'API key ditolak' :
            error instanceof Anthropic.APIConnectionError ? 'tidak ada koneksi' :
            error instanceof Anthropic.APIError ? `API error ${error.status}` :
            error.message;

        logger.warn({ reason }, 'AI gagal, memakai kata kunci');

        return rules;
    }
}
