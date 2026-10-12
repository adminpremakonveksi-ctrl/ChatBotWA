// Imported first by every test file, before anything reads config.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-media-'));

for (const file of ['katalog/jersey.pdf', 'katalog/umum.pdf', 'size-chart/kaos.jpg', 'size-chart/kaos-oversize.jpg', 'katalog-review.jpg']) {
    fs.mkdirSync(path.dirname(path.join(mediaDir, file)), { recursive: true });
    fs.writeFileSync(path.join(mediaDir, file), 'x');
}

Object.assign(process.env, {
    DB_PATH: ':memory:',
    MEDIA_DIR: mediaDir,
    ANTHROPIC_API_KEY: '',
    JERSEY_PROMO_TEXT: '',
    BOT_NAME: 'Mawar',
    CS_NAME: 'Anggun',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'production',
});
