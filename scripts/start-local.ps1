param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Write-Host 'Please install Node.js 22 or newer from https://nodejs.org/, then run this file again.' -ForegroundColor Yellow
    exit 1
}
$major = [int](& node -p "process.versions.node.split('.')[0]")
if ($major -lt 22) { Write-Host 'Node.js 22 or newer is required.' -ForegroundColor Yellow; exit 1 }

$localDir = Join-Path $projectRoot '.local'
New-Item -ItemType Directory -Path $localDir -Force | Out-Null
$lockHash = (Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash
$installStamp = Join-Path $localDir 'dependencies.sha256'
$installedHash = if (Test-Path -LiteralPath $installStamp) { (Get-Content -LiteralPath $installStamp -Raw).Trim() } else { '' }
$needsInstall = -not (Test-Path -LiteralPath 'node_modules/.bin/vite.cmd') -or $installedHash -ne $lockHash
if ($needsInstall) {
    Write-Host 'Installing project dependencies (first run or dependencies changed)...'
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Set-Content -LiteralPath $installStamp -Value $lockHash -Encoding ASCII
}

$sources = @('src', 'public', 'installer') | ForEach-Object { Get-ChildItem -LiteralPath $_ -Recurse -File }
$sources += Get-Item -LiteralPath 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.node.json'
$fingerprintText = ($sources | Sort-Object FullName | ForEach-Object { $_.FullName.Substring($projectRoot.Length) + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }) -join "`n"
$sha = [Security.Cryptography.SHA256]::Create()
try { $buildHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($fingerprintText))) } finally { $sha.Dispose() }
$buildStamp = Join-Path $localDir 'frontend.sha256'
$previousHash = if (Test-Path -LiteralPath $buildStamp) { (Get-Content -LiteralPath $buildStamp -Raw).Trim() } else { '' }
if ($needsInstall -or $previousHash -ne $buildHash -or -not (Test-Path -LiteralPath 'dist/index.html')) {
    Write-Host 'Building the current application...'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Set-Content -LiteralPath $buildStamp -Value $buildHash -Encoding ASCII
}
if ($PrepareOnly) { Write-Host 'Ready to start.'; exit 0 }
Write-Host 'Starting ChillPass. Keep this window open while using the app. Press Ctrl+C to stop.'
& node server.mjs
exit $LASTEXITCODE
