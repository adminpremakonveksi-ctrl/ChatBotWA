import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('project JavaScript, dashboard and Windows scripts contain no code comments', () => {
    const script = `
        const fs = require('node:fs');
        const path = require('node:path');
        const acorn = require('internal/deps/acorn/acorn/dist/acorn');
        const bad = [];
        for (const dir of ['src', 'test']) {
            for (const rel of fs.readdirSync(dir, { recursive: true })) {
                if (!rel.endsWith('.js')) continue;
                const file = path.join(dir, rel);
                const comments = [];
                acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', onComment: comments });
                if (comments.length) bad.push(file);
            }
        }
        const html = fs.readFileSync('src/console.html', 'utf8');
        for (const match of html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)) {
            const comments = [];
            acorn.parse(match[1], { ecmaVersion: 'latest', onComment: comments });
            if (comments.length) bad.push('dashboard script');
        }
        if (/<!--[\\s\\S]*?-->/.test(html)) bad.push('dashboard markup');
        for (const match of html.matchAll(/<style>([\\s\\S]*?)<\\/style>/g)) {
            if (/\\/\\*[\\s\\S]*?\\*\\//.test(match[1])) bad.push('dashboard CSS');
        }
        process.stdout.write(JSON.stringify(bad));
    `;
    const result = spawnSync(process.execPath, ['--expose-internals', '-e', script], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), []);
    for (const file of fs.readdirSync(root).filter((name) => name.endsWith('.bat'))) {
        assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /^\s*(rem(?:\s|$)|::)/im);
    }
    if (process.platform === 'win32') {
        const check = spawnSync('powershell.exe', ['-NoProfile', '-Command', "$bad = @(); Get-ChildItem scripts -Filter *.ps1 | ForEach-Object { $tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count -or @($tokens | Where-Object Kind -eq Comment).Count) { $bad += $_.Name } }; if ($bad.Count) { Write-Output $bad; exit 1 }"], { cwd: root, encoding: 'utf8' });
        assert.equal(check.status, 0, check.stdout + check.stderr);
    }
});
