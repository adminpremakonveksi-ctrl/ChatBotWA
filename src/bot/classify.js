import { config } from '../config.js';
import { logger } from '../logger.js';
import { answerQuestion, openingLine } from './ai-text.js';
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
// One message can use the AI up to twice (label, then an answer or an opening
// line). The numbers are set in Pengaturan > AI (ai-settings.js); the windows are fixed.
export const AI_LIMITS = {
    get perCustomer() {
        return config.ollama.limits?.perCustomer ?? 40;
    },
    perCustomerMinutes: 10,
    get total() {
        return config.ollama.limits?.total ?? 60;
    },
    totalMinutes: 1,
};
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
export async function classify(input, ai = { openingLine, answerQuestion }) {
    const result = await label(input);

    if (!aiProvider()) return result;

    // What the AI may write (ai-text.js), each checked before it is sent.
    try {
        if ((result.intent === 'other' || isFlowQuestion(result, input)) && input.text?.trim() && allowAiCall(input.who)) {
            // A question the bot has no text for: answered from the shop's facts, or "belum tahu".
            result.aiAnswer = await ai.answerQuestion({ text: input.text, history: input.history ?? [], product: result.product ?? input.knownProduct ?? null });
        } else if (wantsOpening(result, input) && allowAiCall(input.who)) {
            // One sentence before the fixed reply that picks up what they said.
            result.opening = await ai.openingLine({ text: input.text, history: input.history ?? [] });
        }
    } catch (error) {
        logger.warn({ reason: error.name === 'TimeoutError' ? 'waktu habis' : error.message }, 'AI gagal menulis, memakai naskah');
    }

    return result;
}

/**
 * A question asked in the middle of the order ("sablonnya pakai apa kak?",
 * "bahannya apa aja?") that the keywords read as the step's answer or as the
 * product. Asked to the AI, so it is answered and the flow waits. Not an
 * amount ("bisa 50 pcs?"), and not a question the bot has a text for.
 */
const FLOW_QUESTION_INTENTS = new Set(['product', 'has_reference', 'no_reference']);
const isFlowQuestion = (result, input) =>
    result.isQuestion &&
    FLOW_QUESTION_INTENTS.has(result.intent) &&
    !result.quantity &&
    !result.patterns?.length &&
    (!result.product || !input.knownProduct || result.product === input.knownProduct);

// No opening line for a greeting, an "ok", the first message (the Salam
// answers it), or anything that ends with CS.
const NO_OPENING = new Set(['greeting', 'ack', 'other', 'human', 'voice', 'image', 'introduction']);
const wantsOpening = (result, input) =>
    !NO_OPENING.has(result.intent) && !['new', 'awaiting_intro'].includes(input.step) && String(input.text ?? '').trim().length >= 6;

/** What the message means: keywords first, the AI when they are unsure. */
async function label(input) {
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
