[CmdletBinding()]
param(
  [switch]$SkipElectronLaunch,
  [switch]$RequireElectron,
  [string]$ElectronExe
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$appRoot = Join-Path $projectRoot 'app'
$syntaxFiles = @(
  'desktop\bootstrap.cjs',
  'desktop\logger.mjs',
  'desktop\window-state.mjs',
  'desktop\runtime.mjs',
  'desktop\main.mjs',
  'desktop\preload.cjs',
  '..\scripts\desktop\smoke-host.mjs',
  '..\scripts\desktop\smoke-electron.mjs'
)

Push-Location $appRoot
try {
  foreach ($file in $syntaxFiles) {
    & node --check $file
    if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $file" }
  }

  & node '..\scripts\desktop\smoke-host.mjs'
  if ($LASTEXITCODE -ne 0) { throw "Desktop host smoke failed with exit code $LASTEXITCODE" }

  if (-not $ElectronExe) {
    $ElectronExe = Join-Path $appRoot 'node_modules\electron\dist\electron.exe'
  }
  if ($SkipElectronLaunch) {
    Write-Host 'Electron launch smoke skipped by request.'
  } elseif (-not (Test-Path -LiteralPath $ElectronExe -PathType Leaf)) {
    if ($RequireElectron) { throw "Electron launch smoke required, but Electron is missing: $ElectronExe" }
    Write-Host 'Electron launch smoke skipped: Electron dependency is not installed.'
  } else {
    & node '..\scripts\desktop\smoke-electron.mjs' $ElectronExe
    if ($LASTEXITCODE -ne 0) { throw "Electron launch smoke failed with exit code $LASTEXITCODE" }
  }

  Write-Host 'Desktop smoke checks passed.'
} finally {
  Pop-Location
}
