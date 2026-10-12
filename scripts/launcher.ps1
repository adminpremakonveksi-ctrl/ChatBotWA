<#
.SYNOPSIS
    Launcher ChatBot Prema.

.DESCRIPTION
    Tanpa -Action: tampilkan menu.

    -Action mulai      "Mulai ChatBot Prema.bat": buka dashboard; pasang & nyalakan dulu kalau belum jalan
    -Action update     "Update ChatBot Prema.bat": ambil versi terbaru dari GitHub (scripts\repo.txt), lalu nyalakan ulang
    -Action start      jalankan bot di jendela ini (untuk scan QR / uji coba)
    -Action install    pasang auto-start: jalan sebagai SYSTEM sejak PC menyala,
                       tanpa perlu ada yang login, dan hidup lagi kalau crash
    -Action stop       hentikan bot (mode mana pun)
    -Action status     lihat apakah bot jalan dan nomornya tersambung
    -Action open       buka halaman QR di browser
    -Action log        ikuti log bot
    -Action uninstall  copot auto-start
    -Action service    (dipakai Task Scheduler, bukan untuk dijalankan manual)

    Hanya boleh SATU proses bot per database. Launcher menolak menyalakan bot
    kedua kalau sudah ada yang jalan.

    File ini sengaja ASCII saja: Windows PowerShell 5.1 salah membaca UTF-8 tanpa BOM.
#>

#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('menu', 'mulai', 'update', 'start', 'install', 'stop', 'status', 'open', 'log', 'uninstall', 'service')]
    [string]$Action = 'menu',
    # Used when Update runs the new install step: no "press Enter" in between.
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $root 'src\index.js'
$logDir = Join-Path $root 'logs'
$logFile = Join-Path $logDir 'bot.log'
$TaskName = 'ChatBot Prema'

function Write-Step { param([string]$Text) Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok { param([string]$Text) Write-Host "    $Text" -ForegroundColor Green }
function Write-Info { param([string]$Text) Write-Host "    $Text" -ForegroundColor Gray }
function Write-Warn { param([string]$Text) Write-Host "    $Text" -ForegroundColor Yellow }

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-EnvValue {
    param([string]$Key, [string]$Default)

    $path = Join-Path $root '.env'
    if (Test-Path $path) {
        $line = Select-String -Path $path -Pattern "^$Key=(.*)$" | Select-Object -First 1
        if ($line) {
            $value = $line.Matches[0].Groups[1].Value.Trim()
            if ($value) { return $value }
        }
    }

    return $Default
}

function Get-Port { return [int](Get-EnvValue -Key 'PORT' -Default '3001') }

function Get-Url {
    $url = "http://127.0.0.1:$(Get-Port)/"
    $key = Get-EnvValue -Key 'API_KEY' -Default ''
    if ($key) { $url += "?key=$key" }
    return $url
}

# winget puts new programs on the machine PATH, but this session does not see it yet.
function Update-PathFromRegistry {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = ($machine, $user | Where-Object { $_ }) -join ';'
}

function Get-NodeMajor {
    param($node)

    try { return [int]((& $node.Source -v).TrimStart('v').Split('.')[0]) } catch { return 0 }
}

# The official Node.js LTS installer, straight from nodejs.org. Fallback for
# PCs without winget (older Windows 10) or where winget fails.
function Install-NodeFromNodejsOrg {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } elseif ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
    $lts = (Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 30) |
        Where-Object { $_.lts -and $_.files -contains "win-$arch-msi" } |
        Select-Object -First 1

    if (-not $lts) { throw 'Versi Node.js LTS tidak ditemukan di nodejs.org.' }

    $msi = Join-Path $env:TEMP "node-$($lts.version)-$arch.msi"
    Write-Info "mengunduh Node.js $($lts.version) dari nodejs.org..."
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$($lts.version)/node-$($lts.version)-$arch.msi" -OutFile $msi -UseBasicParsing -TimeoutSec 600

    Write-Info 'memasang Node.js...'
    $p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait -PassThru
    Remove-Item $msi -Force -ErrorAction SilentlyContinue

    # 3010 = installed, restart suggested; node works without it.
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw "Pemasang Node.js gagal (kode $($p.ExitCode))." }
}

function Get-Node {
    param([switch]$InstallIfMissing)

    $node = Get-Command node -ErrorAction SilentlyContinue

    # Missing, or too old for this bot: install the current LTS.
    if ($InstallIfMissing -and (-not $node -or (Get-NodeMajor $node) -lt 20)) {
        Write-Info $(if ($node) { 'Node.js terlalu lama, memperbarui (butuh internet, beberapa menit)...' } else { 'Node.js belum ada, memasang (butuh internet, beberapa menit)...' })

        if (Get-Command winget -ErrorAction SilentlyContinue) {
            winget install --id OpenJS.NodeJS.LTS --exact --silent --scope machine --accept-package-agreements --accept-source-agreements | Out-Null
            Update-PathFromRegistry
            $node = Get-Command node -ErrorAction SilentlyContinue
        }

        if (-not $node -or (Get-NodeMajor $node) -lt 20) {
            Install-NodeFromNodejsOrg
            Update-PathFromRegistry
            $node = Get-Command node -ErrorAction SilentlyContinue

            # The MSI's PATH entry may not be visible yet in this session.
            $default = Join-Path $env:ProgramFiles 'nodejs\node.exe'
            if (-not $node -and (Test-Path $default)) { $node = Get-Command $default }
        }
    }

    if (-not $node) {
        throw 'Node.js belum terpasang dan pemasangan otomatis gagal. Pastikan PC terhubung ke internet, lalu klik Mulai ChatBot Prema.bat lagi.'
    }

    $major = Get-NodeMajor $node
    if ($major -lt 20) { throw "Node.js terlalu lama (v$major). Butuh minimal v20." }

    return $node.Source
}

# node.exe processes running THIS bot (matched by the absolute path of index.js).
function Get-BotProcesses {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$entry*" }
}

function Test-PortBusy {
    return [bool](Get-NetTCPConnection -LocalPort (Get-Port) -State Listen -ErrorAction SilentlyContinue)
}

function Get-Task { Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }

function Get-Health {
    try {
        return Invoke-RestMethod -Uri "http://127.0.0.1:$(Get-Port)/health" -TimeoutSec 3
    } catch {
        return $null
    }
}

function Wait-Health {
    param([int]$Seconds = 30)

    for ($i = 0; $i -lt $Seconds; $i++) {
        if (Get-Health) { return $true }
        Start-Sleep -Seconds 1
    }

    return $false
}

function Initialize-Bot {
    # Run straight from inside a ZIP, Windows extracts to a temp folder that
    # vanishes: the bot would lose its database on the next reboot.
    if ($root -like "$env:TEMP*" -or $root -match '\.zip') {
        throw 'Folder ini masih di dalam file ZIP. Klik kanan ZIP-nya > Extract All, pindahkan foldernya (mis. ke C:\ChatBot Prema), lalu klik Mulai ChatBot Prema.bat dari sana.'
    }

    # Files from a download carry "came from the internet"; clear it so
    # Windows does not block the scripts and node modules.
    Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notlike "*\node_modules\*" -and $_.FullName -notlike "*\data\*" } |
        Unblock-File -ErrorAction SilentlyContinue

    Write-Step 'Memeriksa kebutuhan'
    Update-PathFromRegistry
    $node = Get-Node -InstallIfMissing
    Write-Ok "Node.js $(& $node -v)"

    $envPath = Join-Path $root '.env'
    if (-not (Test-Path $envPath)) {
        Copy-Item (Join-Path $root '.env.example') $envPath
        Write-Ok '.env dibuat dari .env.example'
    }

    # Install when node_modules is missing or the dependency list changed. A
    # hash, not file dates: files from a GitHub download carry the commit's date.
    $lock = Join-Path $root 'package-lock.json'
    if (-not (Test-Path $lock)) { $lock = Join-Path $root 'package.json' }
    $hashFile = Join-Path $root 'node_modules\.chatbot-deps'
    $wanted = (Get-FileHash $lock -Algorithm SHA256).Hash
    $have = if (Test-Path $hashFile) { (Get-Content $hashFile -Raw).Trim() } else { '' }

    if ($have -ne $wanted) {
        Install-Dependencies $node $lock $hashFile
    }

    # Prove the database library really loads on this PC. A half-finished
    # install (e.g. from an older launcher) heals itself with one reinstall.
    if (-not (Test-Database $node)) {
        Write-Warn 'database belum bisa dibuka, memasang ulang dependensi...'
        Remove-Item (Join-Path $root 'node_modules') -Recurse -Force -ErrorAction SilentlyContinue
        Install-Dependencies $node $lock $hashFile

        if (-not (Test-Database $node)) {
            throw 'Database bot tidak bisa dibuka di PC ini setelah dipasang ulang. Kirim foto layar ini ke developer.'
        }
    }
    Write-Ok 'dependensi siap'

    return $node
}

# --ignore-scripts: nothing here needs compiling. better-sqlite3 ships a
# ready Windows binary, but npm would still run node-gyp "just to check",
# and node-gyp fails on a plain PC without Python and Visual Studio Build
# Tools. The skipped scripts are only version checks (baileys, protobufjs);
# this launcher checks the Node.js version itself.
function Install-Dependencies {
    param($node, $lock, $hashFile)

    Write-Info 'memasang dependensi (sekali saja, butuh internet)...'
    $npm = Join-Path (Split-Path $node) 'npm.cmd'
    Push-Location $root
    try {
        # Out-Host: npm's output must reach the screen, not this function's
        # return value, or callers get "added 202 packages ... node.exe" as the node path.
        & $npm install --no-audit --no-fund --ignore-scripts | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'npm install gagal. Periksa koneksi internet lalu coba lagi.' }
        # npm may rewrite the lock file; remember the hash it ends with.
        Set-Content -Path $hashFile -Value (Get-FileHash $lock -Algorithm SHA256).Hash -Encoding ascii
    } finally {
        Pop-Location
    }
}

function Test-Database {
    param($node)

    Push-Location $root
    try {
        & $node -e "new (require('better-sqlite3'))(':memory:').prepare('select 1').get()" 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } finally {
        Pop-Location
    }
}

function Assert-NotRunning {
    $task = Get-Task
    if ($task -and $task.State -eq 'Running') {
        Write-Warn 'Bot sudah jalan sebagai auto-start (Task Scheduler).'
        Write-Info 'Pakai menu "Hentikan" dulu kalau ingin menjalankannya di jendela ini.'
        return $false
    }

    if (Get-BotProcesses) {
        Write-Warn 'Bot sudah jalan di jendela lain. Hanya boleh satu bot per database.'
        return $false
    }

    if (Test-PortBusy) {
        Write-Warn "Port $(Get-Port) sedang dipakai program lain. Ganti PORT di .env atau tutup program itu."
        return $false
    }

    return $true
}

# ---------------------------------------------------------------- actions ---

function Invoke-Start {
    if (-not (Assert-NotRunning)) { return }

    $node = Initialize-Bot

    Write-Step 'Menjalankan bot'
    Write-Info 'Halaman QR akan terbuka di browser. Tutup jendela ini (atau Ctrl+C) untuk menghentikan bot.'

    $url = Get-Url
    $port = Get-Port
    Start-Job -ScriptBlock {
        param($url, $port)
        for ($i = 0; $i -lt 40; $i++) {
            try { Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 2 | Out-Null; Start-Process $url; return } catch { Start-Sleep 1 }
        }
    } -ArgumentList $url, $port | Out-Null

    Push-Location $root
    try {
        & $node $entry
    } finally {
        Pop-Location
        Get-Job | Remove-Job -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-Install {
    if (-not (Test-Admin)) {
        Write-Info 'Butuh hak Administrator, membuka ulang...'
        Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Action', 'install')
        return
    }

    # A bot running in a window would fight the service for the same number.
    $running = Get-BotProcesses
    $task = Get-Task
    if ($running -and -not ($task -and $task.State -eq 'Running')) {
        Write-Warn 'Bot sedang jalan di jendela lain. Tutup jendela itu dulu, lalu pasang lagi.'
        return
    }

    Initialize-Bot | Out-Null
    Invoke-Stop -Quiet

    Write-Step 'Mendaftarkan auto-start'
    $powershell = Join-Path $PSHOME 'powershell.exe'
    $action = New-ScheduledTaskAction -Execute $powershell `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Action service" `
        -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -AtStartup
    # SYSTEM: runs with nobody logged in, e.g. after a 3 a.m. power cut.
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Force | Out-Null
    Write-Ok "task terdaftar: $TaskName"

    Start-ScheduledTask -TaskName $TaskName
    if (Wait-Health -Seconds 40) {
        Write-Ok 'bot berjalan'
        Start-Process (Get-Url)
    } else {
        Write-Warn "bot belum menjawab. Lihat log: $logFile"
    }

    $from = Get-EnvValue -Key 'ACTIVE_FROM' -Default '17:30'
    $until = Get-EnvValue -Key 'ACTIVE_UNTIL' -Default '07:30'

    Write-Host ''
    Write-Host '  Selesai. Bot menyala terus, juga setelah PC restart, tanpa perlu login.' -ForegroundColor Green
    Write-Host "  Bot membalas Senin-Sabtu $from-$until dan Minggu 24 jam; di luar itu diam." -ForegroundColor Green
    Write-Host ''
    Write-Host "  Halaman QR : $(Get-Url)" -ForegroundColor Cyan
    Write-Host '               (scan sekali dari HP bot; setelah itu tidak perlu lagi)' -ForegroundColor Gray
    Write-Host "  Log        : $logFile" -ForegroundColor Cyan
}

function Invoke-Stop {
    param([switch]$Quiet)

    $task = Get-Task
    if ($task -and $task.State -eq 'Running') {
        if (-not (Test-Admin)) {
            Write-Info 'Bot jalan sebagai auto-start; menghentikannya butuh Administrator, membuka ulang...'
            Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Action', 'stop')
            return
        }
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    }

    # The service wrapper first, or its loop would restart node; then node,
    # because stopping the task does not always take node.exe with it.
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
        Where-Object { $_.CommandLine -like "*$PSCommandPath*-Action service*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-BotProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2

    if (-not $Quiet) {
        if (Get-BotProcesses) { Write-Warn 'masih ada proses bot yang jalan; coba jalankan sebagai Administrator' }
        else { Write-Ok 'bot dihentikan' }
        if ($task) { Write-Info 'Auto-start masih terpasang: bot menyala lagi saat PC restart. Pakai "Copot auto-start" untuk mematikannya permanen.' }
    }
}

function Invoke-Status {
    Write-Step 'Status ChatBot Prema'

    $task = Get-Task
    if ($task) { Write-Info "Auto-start     : terpasang ($($task.State))" }
    else { Write-Info 'Auto-start     : tidak terpasang' }

    $count = @(Get-BotProcesses).Count
    if ($count -gt 1) { Write-Warn "Proses bot     : $count  <-- lebih dari satu, hentikan lalu jalankan ulang" }
    else { Write-Info "Proses bot     : $count" }

    $health = Get-Health
    if (-not $health) {
        Write-Warn "Bot            : tidak menjawab di port $(Get-Port)"
        return
    }

    if ($health.botActive) { Write-Ok 'Jam bot        : aktif (di luar jam kerja)' }
    else { Write-Info 'Jam bot        : diam (jam kerja, CS yang menangani)' }

    if ($health.ai) { Write-Info 'Pengenal maksud: AI + kata kunci' }
    else { Write-Info 'Pengenal maksud: kata kunci saja' }

    try {
        $headers = @{}
        $key = Get-EnvValue -Key 'API_KEY' -Default ''
        if ($key) { $headers['X-Api-Key'] = $key }

        $sessions = (Invoke-RestMethod -Uri "http://127.0.0.1:$(Get-Port)/sessions" -Headers $headers -TimeoutSec 3).sessions
        foreach ($s in $sessions) {
            $line = "Nomor $($s.key)".PadRight(15) + ": $($s.state)"
            if ($s.phoneNumber) { $line += " ($($s.phoneNumber))" }
            if ($s.connected) { Write-Ok $line } else { Write-Warn ($line + '  <-- buka halaman QR untuk scan') }
        }

        $today = (Invoke-RestMethod -Uri "http://127.0.0.1:$(Get-Port)/stats?days=1" -Headers $headers -TimeoutSec 3).days | Select-Object -First 1
        if ($today) { Write-Info "Hari ini       : $($today.masuk) masuk, $($today.keluar) dibalas, $($today.handover) diserahkan ke CS" }
    } catch {
        Write-Warn "gagal membaca status: $($_.Exception.Message)"
    }
}

function Invoke-Log {
    if (-not (Test-Path $logFile)) {
        Write-Warn 'Belum ada log. Log hanya ditulis saat bot jalan sebagai auto-start.'
        return
    }

    Write-Info "Mengikuti $logFile (Ctrl+C untuk berhenti)"
    Get-Content $logFile -Tail 50 -Wait
}

function Invoke-Uninstall {
    if (-not (Test-Admin)) {
        Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Action', 'uninstall')
        return
    }

    Invoke-Stop -Quiet
    if (Get-Task) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Ok 'auto-start dicopot. Data dan tautan nomor tetap tersimpan.'
    } else {
        Write-Info 'auto-start memang tidak terpasang'
    }
}

# Runs under Task Scheduler. Keeps the bot alive and writes its output to logs\bot.log.
function Invoke-Service {
    Update-PathFromRegistry
    $node = Get-Node
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null

    while ($true) {
        if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 20MB) {
            Move-Item $logFile (Join-Path $logDir 'bot.old.log') -Force
        }

        Add-Content -Path $logFile -Value "`r`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') bot dinyalakan ====="

        $env:PRINT_QR = 'false'
        Push-Location $root
        try {
            & cmd.exe /c "`"$node`" `"$entry`" >> `"$logFile`" 2>&1"
        } finally {
            Pop-Location
        }

        Add-Content -Path $logFile -Value "===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') bot berhenti (kode $LASTEXITCODE), menyala lagi dalam 10 detik ====="
        Start-Sleep -Seconds 10
    }
}

# "Mulai ChatBot Prema.bat". Running already: just open the dashboard (no
# Administrator prompt for the daily click). Otherwise install and start it.
function Invoke-Mulai {
    if (Get-Health) {
        Write-Ok 'ChatBot Prema sudah berjalan. Membuka dashboard...'
        Start-Process (Get-Url)
        Start-Sleep -Seconds 2
        return
    }

    Write-Info 'ChatBot Prema belum berjalan. Menyalakan (perlu izin Administrator)...'
    Invoke-Install
}

# Where updates come from: first non-comment line of scripts\repo.txt,
# "https://github.com/<pemilik>/<repo> [branch]".
function Get-RepoSource {
    $file = Join-Path $PSScriptRoot 'repo.txt'
    $line = if (Test-Path $file) { Get-Content $file | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') } | Select-Object -First 1 } else { $null }

    if (-not $line -or $line -notmatch 'github\.com[/:]([^/\s]+)/([^/\s#]+?)(?:\.git)?/?(?:\s+(\S+))?\s*$') {
        throw 'Alamat GitHub untuk update belum diatur (scripts\repo.txt). Hubungi developer.'
    }

    $branch = if ($Matches[3]) { $Matches[3] } else { 'main' }

    return @{ Owner = $Matches[1]; Repo = $Matches[2]; Branch = $branch }
}

# "Update ChatBot Prema.bat". Never touches data\ (WhatsApp link, chats),
# media\ (the client's uploads) or .env.
function Invoke-Update {
    if (-not (Test-Admin)) {
        Write-Info 'Update butuh izin Administrator, membuka ulang...'
        Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Action', 'update')
        return
    }

    $src = Get-RepoSource
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $headers = @{ 'User-Agent' = 'ChatBot-Prema-Updater' }

    Write-Step "Mengecek versi terbaru ($($src.Owner)/$($src.Repo))"
    $sha = $null
    try {
        $sha = (Invoke-RestMethod -Uri "https://api.github.com/repos/$($src.Owner)/$($src.Repo)/commits/$($src.Branch)" -Headers $headers -TimeoutSec 20).sha
    } catch {
        Write-Warn 'versi terbaru tidak terbaca (internet? repo publik?), tetap mencoba mengunduh'
    }

    $versionFile = Join-Path $root 'data\versi.txt'
    $current = if (Test-Path $versionFile) { (Get-Content $versionFile -Raw).Trim() } else { '' }

    if ($sha -and $sha -eq $current -and (Get-Health)) {
        Write-Ok "Sudah versi terbaru ($($sha.Substring(0, 7))). Tidak ada yang perlu diperbarui."
        Start-Process (Get-Url)
        return
    }

    if ((Test-Path (Join-Path $root '.git')) -and (Get-Command git -ErrorAction SilentlyContinue)) {
        # Developer machine: a real checkout.
        Write-Step 'Mengambil pembaruan (git pull)'
        Invoke-Stop -Quiet
        & git -C $root pull --ff-only | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'git pull gagal. Ada perubahan lokal yang bentrok?' }
        $sha = (& git -C $root rev-parse HEAD).Trim()
    } else {
        # Client machine: no git needed, the code comes as a ZIP.
        Write-Step 'Mengunduh versi terbaru'
        $tmp = Join-Path $env:TEMP "chatbot-update-$(Get-Random)"
        New-Item -ItemType Directory -Path $tmp | Out-Null

        try {
            $ref = if ($sha) { $sha } else { $src.Branch }
            $zip = Join-Path $tmp 'update.zip'
            Invoke-WebRequest -Uri "https://codeload.github.com/$($src.Owner)/$($src.Repo)/zip/$ref" -OutFile $zip -Headers $headers -UseBasicParsing -TimeoutSec 300
            Expand-Archive -Path $zip -DestinationPath $tmp -Force

            $source = Get-ChildItem $tmp -Directory | Select-Object -First 1
            if (-not $source -or -not (Test-Path (Join-Path $source.FullName 'src\index.js'))) {
                throw 'Isi unduhan bukan ChatBot Prema. Periksa scripts\repo.txt.'
            }
            Write-Ok 'terunduh'

            Write-Step 'Memasang pembaruan'
            Invoke-Stop -Quiet
            & robocopy $source.FullName $root /E /XD data media logs node_modules .git /XF .env /NFL /NDL /NJH /NJS /NP | Out-Host
            if ($LASTEXITCODE -ge 8) { throw "Gagal menyalin file pembaruan (robocopy $LASTEXITCODE)." }
        } finally {
            Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Ok 'file terbaru terpasang'

    # Run the freshly copied launcher, so new install steps apply right away.
    & (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Action install -NoPause
    if ($LASTEXITCODE -ne 0) { throw 'Menyalakan ulang bot gagal; lihat pesan di atas. Klik Update ChatBot Prema.bat lagi setelah masalahnya beres.' }

    # Only now: a failed install must not count as "already up to date".
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'data') | Out-Null
    if ($sha) { Set-Content -Path $versionFile -Value $sha -Encoding ascii }

    Write-Host ''
    Write-Host "  Update selesai$(if ($sha) { " (versi $($sha.Substring(0, 7)))" })." -ForegroundColor Green
}

function Show-Menu {
    while ($true) {
        Write-Host ''
        Write-Host '  ChatBot Prema' -ForegroundColor White
        Write-Host '  -------------' -ForegroundColor DarkGray
        Write-Host '  1. Jalankan di jendela ini   (untuk scan QR / uji coba)'
        Write-Host '  2. Pasang auto-start         (jalan sendiri setiap PC menyala)'
        Write-Host '  3. Hentikan bot'
        Write-Host '  4. Status'
        Write-Host '  5. Buka halaman QR'
        Write-Host '  6. Lihat log'
        Write-Host '  7. Copot auto-start'
        Write-Host '  0. Keluar'
        $choice = Read-Host '  Pilih'

        try {
            switch ($choice) {
                '1' { Invoke-Start }
                '2' { Invoke-Install }
                '3' { Invoke-Stop }
                '4' { Invoke-Status }
                '5' { Start-Process (Get-Url) }
                '6' { Invoke-Log }
                '7' { Invoke-Uninstall }
                '0' { return }
                default { Write-Warn 'pilihan tidak dikenal' }
            }
        } catch {
            Write-Host "    GAGAL: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

try {
    switch ($Action) {
        'menu' { Show-Menu }
        'mulai' { Invoke-Mulai }
        'update' { Invoke-Update; Read-Host "`n  Tekan Enter untuk menutup" | Out-Null }
        'start' { Invoke-Start }
        'install' { Invoke-Install; if (-not $NoPause) { Read-Host "`n  Tekan Enter untuk menutup" | Out-Null } }
        'stop' { Invoke-Stop }
        'status' { Invoke-Status }
        'open' { Start-Process (Get-Url) }
        'log' { Invoke-Log }
        'uninstall' { Invoke-Uninstall; Read-Host "`n  Tekan Enter untuk menutup" | Out-Null }
        'service' { Invoke-Service }
    }
} catch {
    Write-Host "`n  GAGAL: $($_.Exception.Message)" -ForegroundColor Red
    if ($Action -ne 'service' -and -not $NoPause) { Read-Host '  Tekan Enter untuk menutup' | Out-Null }
    exit 1
}
