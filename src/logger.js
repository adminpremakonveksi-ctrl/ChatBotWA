import pino from 'pino';
import { config } from './config.js';

// Readable lines everywhere; colours only on a real terminal, so the log file
// written by the auto-start service has no escape codes. LOG_FORMAT=json for raw pino.
export const logger = pino({
    level: config.logLevel,
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
