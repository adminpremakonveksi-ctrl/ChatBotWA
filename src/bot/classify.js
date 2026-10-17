import { logger } from '../logger.js';
import { classifyWithOllama, ollamaEnabled } from './classify-ollama.js';
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

/** The AI that is set up: Ollama (cloud key or local host), or none. */
export const aiProvider = () => (ollamaEnabled() ? 'ollama' : null);

/**
 * Keywords first: they are instant, free and tested on every chat level. The
 * AI (Ollama) is asked only about a message the keywords did not
 * recognise, which would otherwise go straight to CS. Any AI failure (no
 * network, rate limit, timeout, a label outside the list) keeps the keyword
 * result, so the bot never goes quiet because of the AI.
 */
export async function classify(input) {
    const rules = classifyWithRules(input);
    const provider = aiProvider();

    if (!provider || rules.intent !== 'other') {
        return rules;
    }

    try {
        const result = toPatterns(await classifyWithOllama(input));
        // The amount as written ("2000 pcs") comes from the keyword reading.
        result.quantity ??= rules.quantity;
        result.text = input.text ?? '';

        logger.info({ text: input.text?.slice(0, 80), intent: result.intent, via: provider }, 'AI mengenali pesan yang tidak dikenali kata kunci');

        return result;
    } catch (error) {
        const reason = error.name === 'TimeoutError' ? 'waktu habis' : error.message;

        logger.warn({ reason }, 'AI gagal, memakai kata kunci');

        return rules;
    }
}
