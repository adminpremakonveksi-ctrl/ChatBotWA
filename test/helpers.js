import { SEED_PATTERNS } from '../src/seeds.js';

export const seedText = (builtin, index = 0) => {
    const bubble = SEED_PATTERNS.find((p) => p.builtin === builtin).bubbles[index];

    return bubble.text ?? bubble.url;
};

export const patternNames = (result) => (result.patterns ?? []).map((p) => p.name);
