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

// How often the AI may be asked: per customer, and for the whole bot.
export const AI_LIMITS = { perCustomer: 12, perCustomerMinutes: 10, total: 60, totalMinutes: 1 };
const aiCalls = new Map();
let allCalls = [];

/** Counts one AI call; false when this customer or the bot as a whole is over its limit. */
export function allowAiCall(who = 'anon', now = Date.now()) {
    const recent = (list, minutes) => list.filter((t) => now - t < minutes * 60000);

    allCalls = recent(allCalls, AI_LIMITS.totalMinutes);
    const mine = recent(aiCalls.get(who) ?? [], AI_LIMITS.perCustomerMinutes);

    if (allCalls.length >= AI_LIMITS.total || mine.length >= AI_LIMITS.perCustomer) return false;

    allCalls.push(now);
    aiCalls.set(who, [...mine, now]);
    if (aiCalls.size > 5000) aiCalls.delete(aiCalls.keys().next().value);

    return true;
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

    // The AI is asked when the keywords did not understand, only guessed from a
    // typo, or think the product is not on the list. A team pattern matched by
    // its own words is never second-guessed.
    const unsure = rules.intent === 'other' || rules.intent === 'product_unknown' || (rules.guessed && rules.intent !== 'custom');

    if (!provider || !unsure) {
        return rules;
    }

    // Spam or a flood of messages must not spend the AI quota: past the limits, keywords only.
    if (!allowAiCall(input.who)) {
        logger.info({ who: input.who }, 'batas pemakaian AI tercapai, memakai kata kunci');

        return rules;
    }

    try {
        const result = toPatterns(await classifyWithOllama(input));

        // The AI has no better idea: keep what the keywords made of it.
        if (result.intent === 'other' && rules.intent !== 'other') return rules;

        // The amount as written ("2000 pcs") and what they said about a design come from the keyword reading.
        result.quantity ??= rules.quantity;
        result.design ??= rules.design;
        result.text = input.text ?? '';
        result.attachments = rules.attachments;

        logger.info({ text: input.text?.slice(0, 80), intent: result.intent, via: provider }, 'AI mengenali pesan yang tidak dikenali kata kunci');

        return result;
    } catch (error) {
        const reason = error.name === 'TimeoutError' ? 'waktu habis' : error.message;

        logger.warn({ reason }, 'AI gagal, memakai kata kunci');

        return rules;
    }
}
