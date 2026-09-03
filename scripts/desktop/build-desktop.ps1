[CmdletBinding()]
param(
  [ValidateSet('nsis', 'zip', 'all')]
  [string]$Target = 'nsis',
  [ValidateSet('x64', 'arm64', 'ia32')]
  [string]$Arch = 'x64',
  [switch]$SkipWebBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$appRoot = Join-Path $projectRoot 'app'
$distIndex = Join-Path $appRoot 'dist\index.html'
$builder = Join-Path $appRoot 'node_modules\.bin\electron-builder.cmd'
$config = Join-Path $appRoot 'desktop\electron-builder.yml'

Push-Location $appRoot
try {
  if (-not $SkipWebBuild) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Renderer build failed with exit code $LASTEXITCODE" }
  }
  if (-not (Test-Path -LiteralPath $distIndex -PathType Leaf)) {
    throw "Production renderer is missing: $distIndex"
  }
  if (-not (Test-Path -LiteralPath $builder -PathType Leaf)) {
    throw "electron-builder is not installed locally. Apply the package.json changes documented in research\desktop-packaging.md, then run npm.cmd install."
  }

  $targets = if ($Target -eq 'all') { @('nsis', 'zip') } else { @($Target) }
  $arguments = @('--config', $config, '--win') + $targets + @("--$Arch", '--publish', 'never')
  & $builder @arguments
  if ($LASTEXITCODE -ne 0) { throw "Desktop packaging failed with exit code $LASTEXITCODE" }

  $output = Join-Path $appRoot 'desktop\out'
  Write-Host "Desktop artifacts: $output"
  Get-ChildItem -LiteralPath $output -File -ErrorAction SilentlyContinue | Select-Object Name, Length, LastWriteTime
} finally {
  Pop-Location
}
