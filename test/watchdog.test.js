import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('Windows watchdog waits for warmup, requires repeated health failures, and rejects unrelated processes', { skip: process.platform !== 'win32' }, () => {
    const source = fileURLToPath(new URL('../scripts/health-watchdog.ps1', import.meta.url)).replace(/'/g, "''");
    const launcher = path.join(path.dirname(source), 'launcher.ps1').replace(/'/g, "''");
    const code = [
        "$ErrorActionPreference = 'Stop'",
        ". '" + source + "' -DefineOnly",
        "if ((Get-WatchdogAction $true 300 20) -ne 'healthy') { throw 'healthy process must survive' }",
        "if ((Get-WatchdogAction $false 119 20) -ne 'warmup') { throw 'startup grace missing' }",
        "if ((Get-WatchdogAction $false 300 3) -ne 'wait') { throw 'single blips must not kill Node' }",
        "if ((Get-WatchdogAction $false 300 4) -ne 'restart') { throw 'hung process not detected' }",
        "$entryPath = 'D:\\Bot\\src\\index.js'",
        "$wrapper = [pscustomobject]@{ Name = 'cmd.exe'; ParentProcessId = 11; ProcessId = 22; CommandLine = 'node.exe \"D:\\Bot\\src\\index.js\"' }",
        "$bot = [pscustomobject]@{ Name = 'node.exe'; ParentProcessId = 22; ProcessId = 33; CommandLine = 'node.exe \"D:\\Bot\\src\\index.js\"' }",
        "if (-not (Test-OwnedBot $bot $wrapper 11 $entryPath)) { throw 'owned process rejected' }",
        "if (Test-OwnedBot $bot $wrapper 99 $entryPath) { throw 'wrong launcher accepted' }",
        "if (Test-OwnedBot $bot $wrapper 11 'D:\\OtherBot\\src\\index.js') { throw 'wrong entry accepted' }",
        "$bot.ParentProcessId = 99",
        "if (Test-OwnedBot $bot $wrapper 11 $entryPath) { throw 'unrelated Node accepted' }",
        "$bot.ParentProcessId = 22; $bot.Name = 'other.exe'",
        "if (Test-OwnedBot $bot $wrapper 11 $entryPath) { throw 'wrong executable accepted' }",
        "$parseTokens = $null; $parseErrors = $null",
        "[System.Management.Automation.Language.Parser]::ParseFile('" + launcher + "', [ref]$parseTokens, [ref]$parseErrors) | Out-Null",
        "if ($parseErrors.Count) { throw ($parseErrors | Out-String) }",
        "Write-Output 'Watchdog policy and PowerShell syntax OK'",
    ].join('\n');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /Watchdog policy and PowerShell syntax OK/);
});
