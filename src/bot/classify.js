import Anthropic from '@anthropic-ai/sdk';

import { logger } from '../logger.js';
import { aiEnabled, classifyWithAi } from './classify-ai.js';
import { classifyWithRules } from './classify-rules.js';

/**
 * AI first when configured, keywords otherwise. Any AI failure (no network,
 * rate limit, timeout, refusal) falls back to keywords so the bot keeps
 * answering instead of going quiet.
 */
export async function classify(input) {
    if (!aiEnabled()) {
        return classifyWithRules(input);
    }

    try {
        return await classifyWithAi(input);
    } catch (error) {
        const reason =
            error instanceof Anthropic.RateLimitError ? 'rate limit' :
            error instanceof Anthropic.AuthenticationError ? 'API key ditolak' :
            error instanceof Anthropic.APIConnectionError ? 'tidak ada koneksi' :
            error instanceof Anthropic.APIError ? `API error ${error.status}` :
            error.message;

        logger.warn({ reason }, 'AI gagal, memakai kata kunci');

        return classifyWithRules(input);
    }
}
