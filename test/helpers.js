import { SEED_PATTERNS } from '../src/seeds.js';

/** Text of a seeded pattern's bubble, e.g. seedText('moq', 0) = the first minimal-order bubble. */
export const seedText = (builtin, index = 0) => {
    const bubble = SEED_PATTERNS.find((p) => p.builtin === builtin).bubbles[index];

    return bubble.text ?? bubble.url;
};

/** Names of the answer patterns a classifier result carries, in answer order. */
export const patternNames = (result) => (result.patterns ?? []).map((p) => p.name);
