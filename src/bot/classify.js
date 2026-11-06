import { config } from '../config.js';
import { logger } from '../logger.js';
import { answerQuestion, openingLine } from './ai-text.js';
import { classifyWithOllama, ollamaEnabled } from './classify-ollama.js';
import { classifyWithRules } from './classify-rules.js';
import { patternForBuiltin } from './patterns.js';

const PATTERN_LABELS = ['location', 'shipping', 'trust', 'moq'];

const pack = (p) => ({ id: p.id, name: p.name, bubbles: p.bubbles, after: p.after, builtin: p.builtin });

function toPatterns(result) {
    const labels = [result.intent, ...result.extras].filter((label) => PATTERN_LABELS.includes(label));
    const patterns = labels.map(patternForBuiltin).filter(Boolean).map(pack);
    const extras = result.extras.filter((label) => !PATTERN_LABELS.includes(label));

    if (!PATTERN_LABELS.includes(result.intent)) return { ...result, extras, patterns: [...(result.patterns ?? []), ...patterns] };

    return patterns.length
        ? { ...result, intent: 'custom', extras, patterns, pattern: patterns[0] }
        : { ...result, intent: 'other', extras, patterns: [], pattern: null };
}

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

export const aiProvider = () => (ollamaEnabled() ? 'ollama' : null);

export async function classify(input, ai = { openingLine, answerQuestion }) {
    const result = await label(input);

    if (!aiProvider()) return result;

    try {
        if ((result.intent === 'other' || isFlowQuestion(result, input)) && input.text?.trim() && allowAiCall(input.who)) {
            result.aiAnswer = await ai.answerQuestion({ text: input.text, history: input.history ?? [], product: result.product ?? input.knownProduct ?? null });
        } else if (wantsOpening(result, input) && allowAiCall(input.who)) {
            result.opening = await ai.openingLine({ text: input.text, history: input.history ?? [] });
        }
    } catch (error) {
        logger.warn({ reason: error.name === 'TimeoutError' ? 'waktu habis' : error.message }, 'AI gagal menulis, memakai naskah');
    }

    return result;
}

const FLOW_QUESTION_INTENTS = new Set(['product', 'has_reference', 'no_reference']);
const isFlowQuestion = (result, input) =>
    result.isQuestion &&
    FLOW_QUESTION_INTENTS.has(result.intent) &&
    !result.quantity &&
    !result.patterns?.length &&
    (!result.product || !input.knownProduct || result.product === input.knownProduct);

const NO_OPENING = new Set(['greeting', 'ack', 'other', 'human', 'voice', 'image', 'introduction']);
const wantsOpening = (result, input) =>
    !NO_OPENING.has(result.intent) && !['new', 'awaiting_intro'].includes(input.step) && String(input.text ?? '').trim().length >= 6;

async function label(input) {
    const rules = classifyWithRules(input);
    const provider = aiProvider();

    const unsure = rules.intent === 'other' || rules.intent === 'product_unknown' || (rules.guessed && rules.intent !== 'custom');

    if (!provider || !unsure) {
        return rules;
    }

    if (!allowAiCall(input.who)) {
        logger.info({ who: input.who }, 'batas pemakaian AI tercapai, memakai kata kunci');

        return rules;
    }

    try {
        const result = toPatterns(await classifyWithOllama(input));

        if (result.intent === 'other' && rules.intent !== 'other') return rules;

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
