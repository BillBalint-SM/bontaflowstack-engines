[CmdletBinding()]
param([switch]$Install, [switch]$InstallBrowser)
$ErrorActionPreference = 'Stop'
$engineRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }
$nodeVersion = & node --version
if ($LASTEXITCODE -ne 0 -or ([version]$nodeVersion.TrimStart('v')).Major -lt 24) { throw 'Node.js 24 or newer is required.' }
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $engineRoot '.browsers'
Push-Location $engineRoot
try {
    if ($Install) {
        & npm.cmd ci --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    if ($InstallBrowser) {
        & node (Join-Path $engineRoot 'node_modules/playwright/cli.js') install chromium
        if ($LASTEXITCODE -ne 0) { throw 'Chromium installation failed.' }
    }
    & node (Join-Path $PSScriptRoot 'manifest.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Engine verification failed.' }
} finally { Pop-Location }
