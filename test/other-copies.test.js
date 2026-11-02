import './setup.js';

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The launcher is PowerShell for Windows client PCs. Its "other copies" block is run for real,
// against made-up folders and a made-up process list, so nothing is stopped.
const launcher = fs.readFileSync(new URL('../scripts/launcher.ps1', import.meta.url), 'utf8');
const block = launcher.slice(launcher.indexOf('# BEGIN other-copies'), launcher.indexOf('# END other-copies'));

const folder = (base, ...parts) => {
    const dir = path.join(base, ...parts);
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scripts', 'launcher.ps1'), '# launcher');
    fs.writeFileSync(path.join(dir, 'src', 'index.js'), '');

    return dir;
};
const project = (dir, name) => fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name }));

test('Mulai finds a second copy of THIS bot in another folder, and nothing else (2026-11-02)', { skip: process.platform !== 'win32' }, () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-copies-'));
    const mine = folder(base, 'ChatBotWA-main');
    const old = folder(base, 'Downloads', 'ChatBotWA-main (1)', 'ChatBotWA-main');
    const spaced = folder(base, 'Program Files', 'bot lama');
    const other = folder(base, 'Landing AI');
    for (const dir of [mine, old, spaced]) project(dir, 'chatbot-prema');
    project(other, 'landing-ai');

    const node = 'C:\\Program Files\\nodejs\\node.exe';
    const processes = [
        { ProcessId: 101, Name: 'node.exe', CommandLine: `"${node}" "${path.join(mine, 'src', 'index.js')}"` }, // this copy
        { ProcessId: 102, Name: 'node.exe', CommandLine: `"${node}" "${path.join(old, 'src', 'index.js')}"` }, // the old copy
        { ProcessId: 103, Name: 'powershell.exe', CommandLine: `powershell -NoProfile -File "${path.join(old, 'scripts', 'launcher.ps1')}" -Action service` }, // its auto-start wrapper
        { ProcessId: 104, Name: 'node.exe', CommandLine: `${node} ${path.join(spaced, 'src', 'index.js')}` }, // unquoted path with spaces
        { ProcessId: 105, Name: 'node.exe', CommandLine: `"${node}" "${path.join(other, 'src', 'index.js')}"` }, // another project that also has src\index.js
        { ProcessId: 106, Name: 'node.exe', CommandLine: `"${node}" "${path.join(base, 'gone', 'src', 'index.js')}"` }, // folder does not exist
        { ProcessId: 107, Name: 'node.exe', CommandLine: `"${node}" --watch src/server.ts` }, // unrelated Node program
        { ProcessId: 108, Name: 'powershell.exe', CommandLine: `powershell -File "${path.join(mine, 'scripts', 'launcher.ps1')}" -Action service` }, // this copy's wrapper
        { ProcessId: 109, Name: 'node.exe', CommandLine: null }, // no access to its command line
    ];

    const script = [
        'param($root, $json)',
        block,
        '$procs = $json | ConvertFrom-Json',
        'ConvertTo-Json -Compress -InputObject @(Get-OtherBotCopies -Processes $procs)',
    ].join('\n');
    const file = path.join(base, 'check.ps1');
    fs.writeFileSync(file, script);
    const jsonFile = path.join(base, 'processes.json');
    fs.writeFileSync(jsonFile, JSON.stringify(processes));

    const run = spawnSync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `& '${file}' -root '${mine}' -json (Get-Content -Raw '${jsonFile}')`,
    ], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr + run.stdout);

    const found = JSON.parse(run.stdout.trim());
    assert.deepEqual(found.map((c) => c.ProcessId).sort(), [102, 103, 104], 'old copy, its wrapper, and the one with spaces in its path');
    assert.equal(found.find((c) => c.ProcessId === 102).Folder, old);
    assert.equal(found.find((c) => c.ProcessId === 104).Folder, spaced);

    fs.rmSync(base, { recursive: true, force: true });
});

test('Mulai stops other copies before it checks health or starts, and asks for Administrator to do so', () => {
    const mulai = launcher.slice(launcher.indexOf('function Invoke-Mulai'));
    assert.ok(mulai.indexOf('Get-OtherBotCopies') < mulai.indexOf('Get-LatestVersion'), 'before the update check');
    assert.ok(mulai.indexOf('Stop-OtherBotCopies') < mulai.indexOf('Get-Health'), 'before the health check, which would open the other copy\'s dashboard');
    assert.match(mulai.slice(0, mulai.indexOf('$latest = $null')), /Test-Admin[\s\S]*RunAs[\s\S]*-Action', 'mulai'/);
    assert.match(launcher, /Sort-Object \{ \$_\.Name -ne 'powershell\.exe' \}/, 'wrappers stopped before node, or their loop restarts it');
});
