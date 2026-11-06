import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-media-'));

for (const file of ['katalog/jersey.pdf', 'katalog/umum.pdf', 'size-chart/kaos.jpg', 'size-chart/kaos-oversize.jpg', 'katalog-review.jpg']) {
    fs.mkdirSync(path.dirname(path.join(mediaDir, file)), { recursive: true });
    fs.writeFileSync(path.join(mediaDir, file), 'x');
}

Object.assign(process.env, {
    DOTENV_CONFIG_PATH: path.join(mediaDir, '.env.test'),
    DB_PATH: ':memory:',
    MEDIA_DIR: mediaDir,
    OLLAMA_API_KEY: '',
    API_URL_OLLAMA: '',
    OLLAMA_HOST: '',
    JERSEY_PROMO_TEXT: '',
    BOT_NAME: 'Mawar',
    CS_NAME: 'Anggun',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'production',
});

const { run } = await import('../src/db.js');
const { forgetProducts } = await import('../src/bot/products.js');
run(`UPDATE products SET questions = '[]'`);
forgetProducts();

const { config } = await import('../src/config.js');
config.bot.mode = 'naskah';
