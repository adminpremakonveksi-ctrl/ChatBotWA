import pino from 'pino';
import { config } from './config.js';
import { recordError } from './errors.js';

const WARN = 40;

export const logger = pino({
    level: config.logLevel,
    hooks: {
        logMethod(args, method, level) {
            if (level >= WARN) {
                const [first, second] = args;
                const detail = first && typeof first === 'object' ? first : {};

                if (!detail.quiet) {
                    recordError({
                        level: level >= 50 ? 'error' : 'peringatan',
                        source: this.bindings?.().part ?? 'bot',
                        message: typeof first === 'string' ? first : second ?? detail.err ?? detail.reason ?? '',
                        detail,
                    });
                }
            }

            return method.apply(this, args);
        },
    },
    transport: process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production'
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
                translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
                ignore: 'pid,hostname',
                colorize: Boolean(process.stdout.isTTY),
            },
        },
});
