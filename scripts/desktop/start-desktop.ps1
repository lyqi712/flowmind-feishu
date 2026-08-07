[CmdletBinding()]
param(
  [switch]$SkipWebBuild,
  [string]$ElectronPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$appRoot = Join-Path $projectRoot 'app'
$distIndex = Join-Path $appRoot 'dist\index.html'

Push-Location $appRoot
try {
  if (-not $SkipWebBuild) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Renderer build failed with exit code $LASTEXITCODE" }
  }

  if (-not (Test-Path -LiteralPath $distIndex -PathType Leaf)) {
    throw "Production renderer is missing: $distIndex. Run npm.cmd run build first."
  }

  if (-not $ElectronPath) {
    $ElectronPath = Join-Path $appRoot 'node_modules\.bin\electron.cmd'
  }
  if (-not (Test-Path -LiteralPath $ElectronPath -PathType Leaf)) {
    throw "Electron is not installed locally. Run npm.cmd install in the app directory first."
  }

  $env:NODE_ENV = 'production'
  & $ElectronPath (Join-Path $appRoot 'desktop')
  if ($LASTEXITCODE -ne 0) { throw "Electron exited with code $LASTEXITCODE" }
} finally {
  Pop-Location
}
