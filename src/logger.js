import pino from 'pino';
import { config } from './config.js';
import { recordError } from './errors.js';

const WARN = 40;

// Readable lines everywhere; colours only on a real terminal, so the log file
// written by the auto-start service has no escape codes. LOG_FORMAT=json for raw pino.
export const logger = pino({
    level: config.logLevel,
    hooks: {
        // Every warning and error also goes to the console's error pop-up, as
        // logged (no friendlier rewording). { quiet: true } keeps a line out.
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
