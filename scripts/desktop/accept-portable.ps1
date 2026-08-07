[CmdletBinding()]
param(
  [string]$ExecutablePath,
  [int]$TimeoutSeconds = 90,
  [switch]$KeepTemp
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $ExecutablePath) {
  $ExecutablePath = Join-Path $projectRoot 'app\desktop\out\FlowMind-portable-x64\FlowMind.exe'
}
$exe = (Resolve-Path -LiteralPath $ExecutablePath).Path
$tempBoundary = Join-Path ([IO.Path]::GetTempPath()) 'FlowMindPortableAcceptance'
$sessionRoot = Join-Path $tempBoundary ([Guid]::NewGuid().ToString('N'))
$userData = Join-Path $sessionRoot 'user-data'
$resultFile = Join-Path $sessionRoot 'result.json'
$evidencePath = Join-Path $projectRoot 'evidence\portable-deep-knowledge-acceptance.json'
[void](New-Item -ItemType Directory -Path $userData -Force)

function Remove-VerifiedTree([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $absolute = [IO.Path]::GetFullPath($Path)
  $boundary = [IO.Path]::GetFullPath($tempBoundary).TrimEnd('\') + '\'
  if (-not $absolute.StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe cleanup path: $absolute" }
  Remove-Item -LiteralPath $absolute -Recurse -Force
}

$saved = @{}
foreach ($name in @('IMA_DESKTOP_SMOKE_TEST', 'IMA_DESKTOP_SMOKE_RESULT_FILE', 'NODE_ENV')) {
  $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
  [Environment]::SetEnvironmentVariable('IMA_DESKTOP_SMOKE_TEST', '1', 'Process')
  [Environment]::SetEnvironmentVariable('IMA_DESKTOP_SMOKE_RESULT_FILE', $resultFile, 'Process')
  [Environment]::SetEnvironmentVariable('NODE_ENV', 'production', 'Process')
  $process = Start-Process -FilePath $exe -ArgumentList @('--disable-gpu', '--no-sandbox', "--user-data-dir=$userData") -WorkingDirectory (Split-Path $exe) -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    try { $process.Kill() } catch { }
    throw "Portable smoke timed out after $TimeoutSeconds seconds"
  }
  $process.Refresh()
  if ($process.ExitCode -ne 0) { throw "Portable smoke exit code $($process.ExitCode)" }
  if (-not (Test-Path -LiteralPath $resultFile -PathType Leaf)) { throw 'Portable smoke result is missing' }
  $payload = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
  if ($payload.ok -ne $true -or $payload.loaded -ne $true) { throw 'Portable smoke result is invalid' }
  $reportedUserData = [IO.Path]::GetFullPath([string]$payload.userData)
  $expectedUserData = [IO.Path]::GetFullPath($userData)
  $portableRoot = Split-Path $exe
  $serverFeature = Join-Path $portableRoot 'resources\app\server\knowledge-relations.mjs'
  if (-not (Test-Path -LiteralPath $serverFeature -PathType Leaf)) { throw "Portable deep feature file missing: $serverFeature" }
  $assetRoot = Join-Path $portableRoot 'resources\app\dist\assets'
  $rendererBundles = @(Get-ChildItem -LiteralPath $assetRoot -File -Filter '*.js')
  if ($rendererBundles.Count -eq 0) { throw "Portable renderer bundles are missing: $assetRoot" }
  $bundleTexts = @{}
  foreach ($candidate in $rendererBundles) {
    $bundleTexts[$candidate.FullName] = [IO.File]::ReadAllText($candidate.FullName, [Text.Encoding]::UTF8)
  }
  $rendererMarkers = [ordered]@{}
  foreach ($marker in @('知识地图', '/api/answers/artifacts', '将回答转为笔记')) {
    $match = $rendererBundles | Where-Object { $bundleTexts[$_.FullName].Contains($marker) } | Select-Object -First 1
    if ($null -eq $match) { throw "Portable renderer chunks are missing deep feature marker: $marker" }
    $rendererMarkers[$marker] = $match.FullName
  }
  $deepFiles = @($serverFeature) + @($rendererMarkers.Values | Select-Object -Unique)
  $evidence = [ordered]@{
    ok = $true
    verifiedAt = [DateTime]::UtcNow.ToString('o')
    executable = $exe
    bytes = (Get-Item -LiteralPath $exe).Length
    sha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    origin = [string]$payload.origin
    loaded = [bool]$payload.loaded
    userDataIsolated = $reportedUserData.Equals($expectedUserData, [StringComparison]::OrdinalIgnoreCase)
    deepFiles = $deepFiles
    rendererMarkers = $rendererMarkers
    deepFilesPresent = $true
  }
  $evidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $evidencePath -Encoding UTF8
  $evidence | ConvertTo-Json -Depth 6
} finally {
  foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
  if (-not $KeepTemp) { Remove-VerifiedTree $sessionRoot }
}
