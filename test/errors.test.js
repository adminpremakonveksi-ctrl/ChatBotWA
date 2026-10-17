import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { errorsSince, latestErrorId } from '../src/errors.js';
import { logger } from '../src/logger.js';

test('every warning and error the bot logs reaches the console pop-up, raw', () => {
    const before = latestErrorId();
    const level = logger.level;
    logger.level = 'warn';

    logger.child({ part: 'catalog' }).warn({ err: 'Timed Out' }, 'katalog WhatsApp gagal dibaca');
    logger.error(new Error('boom'), 'gagal memproses pesan');
    logger.warn({ quiet: true }, 'file media belum ada');
    logger.info('biasa saja');
    logger.level = level;

    const fresh = errorsSince(before);
    assert.equal(fresh.length, 2);
    assert.deepEqual([fresh[0].level, fresh[0].source, fresh[0].message, fresh[0].detail.err], ['peringatan', 'catalog', 'katalog WhatsApp gagal dibaca', 'Timed Out']);
    assert.equal(fresh[1].level, 'error');
    assert.match(fresh[1].detail.stack, /boom/);
});
