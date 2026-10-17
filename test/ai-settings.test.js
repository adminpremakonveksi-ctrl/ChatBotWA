import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';

import { aiSettings, updateAiSettings } from '../src/ai-settings.js';
import { aiProvider } from '../src/bot/classify.js';
import { config } from '../src/config.js';

test('Ollama is set from the console: key masked, applied at once, removable', () => {
    assert.equal(aiProvider(), null, 'off by default in tests');

    const s = updateAiSettings({ key: 'abcdef0123456789.XYZW', model: 'gpt-oss:20b' });
    assert.equal(s.enabled, true);
    assert.equal(s.keySource, 'pengaturan');
    assert.match(s.keyMasked, /•+XYZW$/);
    assert.ok(!JSON.stringify(s).includes('abcdef0123456789'), 'the key itself never goes to the console');
    assert.equal(config.ollama.model, 'gpt-oss:20b');
    assert.equal(aiProvider(), 'ollama');

    // Saving without a key keeps it.
    updateAiSettings({ model: 'gemma4:31b' });
    assert.equal(aiSettings().keySource, 'pengaturan');

    assert.throws(() => updateAiSettings({ key: 'pendek' }), /tidak valid/);
    assert.throws(() => updateAiSettings({ model: 'model aneh!' }), /tidak valid/);

    updateAiSettings({ key: '', model: '' });
    assert.equal(aiProvider(), null);
    assert.equal(config.ollama.model, 'gemma4:31b', 'back to the default model');
});

test('a local Ollama needs only its address', () => {
    updateAiSettings({ host: 'localhost:11434' });
    assert.equal(config.ollama.host, 'http://localhost:11434');
    assert.equal(aiProvider(), 'ollama');

    updateAiSettings({ host: '' });
    assert.equal(aiProvider(), null);
});
