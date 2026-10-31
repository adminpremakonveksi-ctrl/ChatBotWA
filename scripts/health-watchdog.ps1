# Independent of Node's event loop. Runs as a hidden background job of launcher.ps1.
# ASCII only for Windows PowerShell 5.1.
param(
    [int]$SupervisorId,
    [long]$SupervisorStartTicks,
    [string]$Entry,
    [int]$Port = 3001,
    [string]$LogFile,
    [switch]$DefineOnly
)

function Get-WatchdogAction {
    param([bool]$Healthy, [double]$AgeSeconds, [int]$Failures)
    if ($Healthy) { return 'healthy' }
    if ($AgeSeconds -lt 120) { return 'warmup' }
    if ($Failures -ge 4) { return 'restart' }
    return 'wait'
}

function Test-OwnedBot {
    param($BotProcess, $WrapperProcess, [int]$OwnerId, [string]$ExpectedEntry)
    if (-not $BotProcess -or -not $WrapperProcess -or -not $ExpectedEntry) { return $false }
    if ($BotProcess.Name -ne 'node.exe' -or $WrapperProcess.Name -ne 'cmd.exe') { return $false }
    if ($WrapperProcess.ParentProcessId -ne $OwnerId -or $BotProcess.ParentProcessId -ne $WrapperProcess.ProcessId) { return $false }
    $token = '"' + $ExpectedEntry + '"'
    return $BotProcess.CommandLine -and $WrapperProcess.CommandLine -and
        $BotProcess.CommandLine.IndexOf($token, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $WrapperProcess.CommandLine.IndexOf($token, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

if ($DefineOnly) { return }
$ErrorActionPreference = 'Stop'
$entryPath = [IO.Path]::GetFullPath($Entry)
$watchedId = 0
$watchedSince = Get-Date
$failures = 0
$lastDiagnostic = [DateTime]::MinValue

while ($true) {
    Start-Sleep -Seconds 15
    try {
        $supervisor = Get-Process -Id $SupervisorId -ErrorAction SilentlyContinue
        if (-not $supervisor -or $supervisor.StartTime.Ticks -ne $SupervisorStartTicks) { break }
        $wrappers = @(Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe' AND ParentProcessId = $SupervisorId")
        $owned = $null
        $wrapper = $null
        foreach ($candidate in $wrappers) {
            $children = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe' AND ParentProcessId = $($candidate.ProcessId)")
            foreach ($child in $children) {
                if (Test-OwnedBot $child $candidate $SupervisorId $entryPath) { $owned = $child; $wrapper = $candidate; break }
            }
            if ($owned) { break }
        }
        if (-not $owned) { $watchedId = 0; $failures = 0; continue }
        if ($watchedId -ne $owned.ProcessId) {
            $watchedId = $owned.ProcessId
            $watchedSince = Get-Date
            $failures = 0
        }
        $healthy = $false
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
            $healthy = $health.ok -eq $true
        } catch { }
        if ($healthy) { $failures = 0 } else { $failures++ }
        $age = ((Get-Date) - $watchedSince).TotalSeconds
        $decision = Get-WatchdogAction $healthy $age $failures
        if ($decision -eq 'warmup') { $failures = 0; continue }
        if ($decision -ne 'restart') { continue }
        # Verify ancestry and exact entry path AGAIN immediately before stopping.
        # Never stop all node processes or a process owned by another launcher.
        $checkBot = Get-CimInstance Win32_Process -Filter "ProcessId = $watchedId"
        $checkWrapper = Get-CimInstance Win32_Process -Filter "ProcessId = $($wrapper.ProcessId)"
        if (-not (Test-OwnedBot $checkBot $checkWrapper $SupervisorId $entryPath)) { continue }
        Add-Content -LiteralPath $LogFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') WATCHDOG: bot tidak merespons; memulai ulang proses milik launcher ini." -ErrorAction SilentlyContinue
        Stop-Process -Id $watchedId -Force
        $watchedId = 0
        $failures = 0
        # The launcher's existing loop restarts Node after ten seconds.
    } catch {
        if (((Get-Date) - $lastDiagnostic).TotalMinutes -ge 10) {
            Add-Content -LiteralPath $LogFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') WATCHDOG: pemeriksaan tertunda: $($_.Exception.Message)" -ErrorAction SilentlyContinue
            $lastDiagnostic = Get-Date
        }
    }
}
