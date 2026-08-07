[CmdletBinding()]
param(
  [string]$InstallerPath,
  [int]$InstallTimeoutSeconds = 180,
  [int]$SmokeTimeoutSeconds = 60,
  [int]$UninstallTimeoutSeconds = 180,
  [switch]$KeepTemp
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$appRoot = Join-Path $projectRoot 'app'
$outputRoot = Join-Path $appRoot 'desktop\out'
$builderConfigPath = Join-Path $appRoot 'desktop\electron-builder.yml'
$evidenceRoot = Join-Path $projectRoot 'evidence'
$evidencePath = Join-Path $evidenceRoot 'translation-export-installer-acceptance.json'
$tempBoundary = Join-Path ([IO.Path]::GetTempPath()) 'FlowMindInstallerAcceptance'
$sessionRoot = Join-Path $tempBoundary ([Guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $sessionRoot 'install'
$userDataRoot = Join-Path $sessionRoot 'user-data'
$smokeResultPath = Join-Path $sessionRoot 'desktop-smoke-result.json'
$routeExtractRoot = Join-Path $sessionRoot 'route-contract'
$userDataMarkerPath = Join-Path $userDataRoot 'installer-acceptance-user-data.marker'

function Get-AbsolutePath {
  param([Parameter(Mandatory = $true)][string]$Path)
  return [IO.Path]::GetFullPath($Path)
}

function Assert-PathInsideBoundary {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Boundary
  )

  $absolutePath = Get-AbsolutePath $Path
  $absoluteBoundary = (Get-AbsolutePath $Boundary).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $boundaryPrefix = $absoluteBoundary + [IO.Path]::DirectorySeparatorChar
  if (-not $absolutePath.StartsWith($boundaryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe path outside temporary boundary. Path='$absolutePath'; Boundary='$absoluteBoundary'"
  }
  return $absolutePath
}

function Remove-VerifiedTemporaryTree {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return }
  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
  $resolvedBoundary = (Resolve-Path -LiteralPath $tempBoundary).Path
  [void](Assert-PathInsideBoundary -Path $resolvedPath -Boundary $resolvedBoundary)
  Remove-Item -LiteralPath $resolvedPath -Recurse -Force
}

function Wait-Until {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Condition,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
    [string]$Description = 'condition'
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out after $TimeoutSeconds seconds waiting for $Description."
}

function Invoke-HiddenProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
    [string]$WorkingDirectory
  )

  if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    throw "Process executable not found: $FilePath"
  }

  $startParams = @{
    FilePath = $FilePath
    ArgumentList = $ArgumentList
    PassThru = $true
    WindowStyle = 'Hidden'
  }
  if ($WorkingDirectory) { $startParams.WorkingDirectory = $WorkingDirectory }

  $process = Start-Process @startParams
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    try { $process.Kill() } catch { }
    throw "Process timed out after $TimeoutSeconds seconds: $FilePath"
  }
  $process.Refresh()
  return [int]$process.ExitCode
}

function Find-LatestNsisInstaller {
  if ($InstallerPath) {
    $resolved = (Resolve-Path -LiteralPath $InstallerPath).Path
    if ([IO.Path]::GetExtension($resolved) -ne '.exe') {
      throw "Installer must be an .exe file: $resolved"
    }
    return Get-Item -LiteralPath $resolved
  }

  if (-not (Test-Path -LiteralPath $outputRoot -PathType Container)) {
    throw "electron-builder output directory not found: $outputRoot"
  }

  $candidates = @(
    Get-ChildItem -LiteralPath $outputRoot -File -Filter '*.exe' |
      Where-Object {
        $_.Name -match '(?i)x64' -and
        $_.Name -notmatch '(?i)portable|__uninstaller|^uninstall' -and
        $_.Name -ne 'FlowMind.exe'
      } |
      Sort-Object LastWriteTimeUtc -Descending
  )
  if ($candidates.Count -eq 0) {
    throw "No top-level NSIS x64 installer was found in $outputRoot. Run npm.cmd run desktop:pack first."
  }
  return $candidates[0]
}

function Get-ShortcutTarget {
  param([Parameter(Mandatory = $true)][string]$ShortcutPath)

  $shell = New-Object -ComObject WScript.Shell
  try {
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    return [string]$shortcut.TargetPath
  } finally {
    if ($null -ne $shell) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
  }
}

function Find-FlowMindShortcuts {
  param([Parameter(Mandatory = $true)][string]$ExpectedTarget)

  $locations = @(
    [pscustomobject]@{ Kind = 'desktop'; Path = [Environment]::GetFolderPath('Desktop') },
    [pscustomobject]@{ Kind = 'desktop-common'; Path = [Environment]::GetFolderPath('CommonDesktopDirectory') },
    [pscustomobject]@{ Kind = 'start-menu'; Path = [Environment]::GetFolderPath('Programs') },
    [pscustomobject]@{ Kind = 'start-menu-common'; Path = [Environment]::GetFolderPath('CommonPrograms') }
  )

  $expectedAbsolute = Get-AbsolutePath $ExpectedTarget
  $matches = New-Object System.Collections.Generic.List[object]
  foreach ($location in $locations) {
    if ([string]::IsNullOrWhiteSpace($location.Path) -or -not (Test-Path -LiteralPath $location.Path -PathType Container)) {
      continue
    }
    $recursive = $location.Kind -like 'start-menu*'
    $links = if ($recursive) {
      Get-ChildItem -LiteralPath $location.Path -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue
    } else {
      Get-ChildItem -LiteralPath $location.Path -Filter '*.lnk' -File -ErrorAction SilentlyContinue
    }
    foreach ($link in $links) {
      try {
        $target = Get-ShortcutTarget $link.FullName
        if ($target -and (Get-AbsolutePath $target).Equals($expectedAbsolute, [StringComparison]::OrdinalIgnoreCase)) {
          $matches.Add([pscustomobject]@{
            kind = $location.Kind
            path = $link.FullName
            target = $target
          })
        }
      } catch { }
    }
  }
  return $matches.ToArray()
}

function Get-PackagedServerSource {
  $looseSource = Join-Path $installRoot 'resources\app\server\app.mjs'
  if (Test-Path -LiteralPath $looseSource -PathType Leaf) {
    return [pscustomobject]@{
      Source = $looseSource
      Content = Get-Content -LiteralPath $looseSource -Raw
      TranslationModulePresent = Test-Path -LiteralPath (Join-Path $installRoot 'resources\app\server\translation-export.mjs') -PathType Leaf
    }
  }

  $archive = Join-Path $installRoot 'resources\app.asar'
  if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
    throw "Installed server package not found as loose files or app.asar under $installRoot\resources."
  }

  $nodeCommand = Get-Command node -ErrorAction Stop
  $asarCli = Join-Path $appRoot 'node_modules\@electron\asar\bin\asar.js'
  if (-not (Test-Path -LiteralPath $asarCli -PathType Leaf)) {
    throw "The local @electron/asar CLI is required for installed route verification: $asarCli"
  }

  [void](New-Item -ItemType Directory -Path $routeExtractRoot -Force)
  $routeExtractAbsolute = Assert-PathInsideBoundary -Path $routeExtractRoot -Boundary $tempBoundary
  Push-Location $routeExtractAbsolute
  try {
    $exitCode = Invoke-HiddenProcess -FilePath $nodeCommand.Source -ArgumentList @($asarCli, 'extract-file', $archive, 'server/app.mjs') -TimeoutSeconds 30 -WorkingDirectory $routeExtractAbsolute
    if ($exitCode -ne 0) { throw "asar route extraction failed with exit code $exitCode." }
    $listOutput = & $nodeCommand.Source $asarCli list $archive 2>&1
    if ($LASTEXITCODE -ne 0) { throw "asar package listing failed with exit code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }

  $extractedSource = Join-Path $routeExtractAbsolute 'app.mjs'
  if (-not (Test-Path -LiteralPath $extractedSource -PathType Leaf)) {
    throw "Extracted server route source is missing: $extractedSource"
  }

  return [pscustomobject]@{
    Source = "$archive::server/app.mjs"
    Content = Get-Content -LiteralPath $extractedSource -Raw
    TranslationModulePresent = [bool](@($listOutput) -match '[\\/]server[\\/]translation-export\.mjs$')
  }
}

function Test-InstalledRouteContracts {
  $packaged = Get-PackagedServerSource
  $contracts = @(
    [pscustomobject]@{ method = 'GET'; route = '/api/translations'; token = "app.get('/api/translations'," },
    [pscustomobject]@{ method = 'GET'; route = '/api/translations/:id'; token = "app.get('/api/translations/:id'," },
    [pscustomobject]@{ method = 'POST'; route = '/api/translations/generate'; token = "app.post('/api/translations/generate'," },
    [pscustomobject]@{ method = 'POST'; route = '/api/translations'; token = "app.post('/api/translations'," },
    [pscustomobject]@{ method = 'PATCH'; route = '/api/translations/:id'; token = "app.patch('/api/translations/:id'," },
    [pscustomobject]@{ method = 'DELETE'; route = '/api/translations/:id'; token = "app.delete('/api/translations/:id'," },
    [pscustomobject]@{ method = 'POST'; route = '/api/exports/render'; token = "app.post('/api/exports/render'," },
    [pscustomobject]@{ method = 'GET'; route = '/api/knowledge/libraries'; token = "app.get('/api/knowledge/libraries'," },
    [pscustomobject]@{ method = 'POST'; route = '/api/knowledge/libraries/refresh'; token = "app.post('/api/knowledge/libraries/refresh'," },
    [pscustomobject]@{ method = 'PATCH'; route = '/api/knowledge/libraries/:id'; token = "app.patch('/api/knowledge/libraries/:id'," }
  )

  $results = foreach ($contract in $contracts) {
    [pscustomobject]@{
      method = $contract.method
      route = $contract.route
      present = $packaged.Content.Contains($contract.token)
    }
  }
  $missing = @($results | Where-Object { -not $_.present })
  if ($missing.Count -gt 0) {
    throw "Installed server route contract is incomplete: $($missing.route -join ', ')"
  }
  if (-not $packaged.TranslationModulePresent) {
    throw 'Installed server package does not contain server/translation-export.mjs.'
  }

  return [pscustomobject]@{
    source = $packaged.Source
    translationModulePresent = $true
    routes = @($results)
  }
}

function Invoke-SilentUninstall {
  param(
    [Parameter(Mandatory = $true)][string]$Uninstaller,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds
  )

  $exitCode = Invoke-HiddenProcess -FilePath $Uninstaller -ArgumentList @('/S') -TimeoutSeconds $TimeoutSeconds -WorkingDirectory $sessionRoot
  if ($exitCode -ne 0) { throw "Silent uninstall failed with exit code $exitCode." }
  Wait-Until -TimeoutSeconds 45 -Description 'the installation directory to be removed' -Condition {
    -not (Test-Path -LiteralPath $installRoot)
  }
  return $exitCode
}

[void](New-Item -ItemType Directory -Path $tempBoundary -Force)
[void](New-Item -ItemType Directory -Path $sessionRoot -Force)
[void](New-Item -ItemType Directory -Path $evidenceRoot -Force)
[void](Assert-PathInsideBoundary -Path $sessionRoot -Boundary $tempBoundary)
[void](Assert-PathInsideBoundary -Path $installRoot -Boundary $tempBoundary)
[void](Assert-PathInsideBoundary -Path $userDataRoot -Boundary $tempBoundary)

$evidence = [ordered]@{
  ok = $false
  generatedAt = [DateTime]::UtcNow.ToString('o')
  projectRoot = $projectRoot
  installer = $null
  builderShortcutConfig = $null
  installation = $null
  shortcuts = @()
  desktopSmoke = $null
  packagedRoutes = $null
  uninstall = $null
  cleanup = $null
  error = $null
}
$failure = $null
$installed = $false
$uninstallAttempted = $false
$uninstallerPath = $null

try {
  if (-not (Test-Path -LiteralPath $builderConfigPath -PathType Leaf)) {
    throw "electron-builder configuration not found: $builderConfigPath"
  }
  $builderConfig = Get-Content -LiteralPath $builderConfigPath -Raw
  $desktopShortcutConfigured = [regex]::IsMatch($builderConfig, '(?m)^\s*createDesktopShortcut:\s*true\s*$')
  $startMenuShortcutConfigured = [regex]::IsMatch($builderConfig, '(?m)^\s*createStartMenuShortcut:\s*true\s*$')
  if (-not ($desktopShortcutConfigured -or $startMenuShortcutConfigured)) {
    throw 'electron-builder NSIS configuration does not enable a desktop or Start Menu shortcut.'
  }
  $evidence.builderShortcutConfig = [ordered]@{
    path = $builderConfigPath
    createDesktopShortcut = $desktopShortcutConfigured
    createStartMenuShortcut = $startMenuShortcutConfigured
  }

  $installer = Find-LatestNsisInstaller
  $installerHash = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash
  $evidence.installer = [ordered]@{
    path = $installer.FullName
    name = $installer.Name
    bytes = [int64]$installer.Length
    lastWriteTimeUtc = $installer.LastWriteTimeUtc.ToString('o')
    sha256 = $installerHash
    discovery = if ($InstallerPath) { 'explicit' } else { 'latest-top-level-x64-nsis' }
  }

  $installExitCode = Invoke-HiddenProcess -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installRoot") -TimeoutSeconds $InstallTimeoutSeconds -WorkingDirectory $sessionRoot
  if ($installExitCode -ne 0) { throw "Silent install failed with exit code $installExitCode." }
  $installed = $true

  $installedExe = Join-Path $installRoot 'FlowMind.exe'
  Wait-Until -TimeoutSeconds 30 -Description 'the installed FlowMind executable' -Condition {
    Test-Path -LiteralPath $installedExe -PathType Leaf
  }
  $uninstallers = @(
    Get-ChildItem -LiteralPath $installRoot -File -Filter '*.exe' |
      Where-Object { $_.Name -match '(?i)^uninstall.*\.exe$' }
  )
  if ($uninstallers.Count -ne 1) {
    throw "Expected exactly one uninstall*.exe in $installRoot, found $($uninstallers.Count)."
  }
  $uninstallerPath = $uninstallers[0].FullName
  $evidence.installation = [ordered]@{
    directory = $installRoot
    exitCode = $installExitCode
    executable = $installedExe
    executablePresent = $true
    uninstaller = $uninstallerPath
    uninstallerPresent = $true
  }

  $shortcutMatches = @(Find-FlowMindShortcuts -ExpectedTarget $installedExe)
  if ($shortcutMatches.Count -eq 0) {
    throw "No Desktop or Start Menu shortcut targets the installed executable: $installedExe"
  }
  $evidence.shortcuts = @($shortcutMatches | ForEach-Object { $_ })

  $evidence.packagedRoutes = Test-InstalledRouteContracts

  [void](New-Item -ItemType Directory -Path $userDataRoot -Force)
  if (Test-Path -LiteralPath $smokeResultPath) { Remove-Item -LiteralPath $smokeResultPath -Force }
  $savedEnvironment = @{}
  foreach ($name in @('IMA_DESKTOP_SMOKE_TEST', 'IMA_DESKTOP_SMOKE_RESULT_FILE', 'NODE_ENV')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
  try {
    [Environment]::SetEnvironmentVariable('IMA_DESKTOP_SMOKE_TEST', '1', 'Process')
    [Environment]::SetEnvironmentVariable('IMA_DESKTOP_SMOKE_RESULT_FILE', $smokeResultPath, 'Process')
    [Environment]::SetEnvironmentVariable('NODE_ENV', 'production', 'Process')
    $smokeExitCode = Invoke-HiddenProcess -FilePath $installedExe -ArgumentList @('--disable-gpu', '--no-sandbox', "--user-data-dir=$userDataRoot") -TimeoutSeconds $SmokeTimeoutSeconds -WorkingDirectory $installRoot
  } finally {
    foreach ($name in $savedEnvironment.Keys) {
      [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
  }
  if ($smokeExitCode -ne 0) { throw "Installed desktop smoke failed with exit code $smokeExitCode." }
  if (-not (Test-Path -LiteralPath $smokeResultPath -PathType Leaf)) {
    throw "Installed desktop smoke result file is missing: $smokeResultPath"
  }

  $smokeResult = Get-Content -LiteralPath $smokeResultPath -Raw | ConvertFrom-Json
  if ($smokeResult.ok -ne $true -or $smokeResult.loaded -ne $true) {
    throw 'Installed desktop smoke result payload is invalid.'
  }
  $origin = $null
  if (-not [Uri]::TryCreate([string]$smokeResult.origin, [UriKind]::Absolute, [ref]$origin)) {
    throw "Installed desktop smoke origin is invalid: $($smokeResult.origin)"
  }
  if ($origin.Scheme -ne 'http' -or $origin.Host -notin @('127.0.0.1', 'localhost', '::1')) {
    throw "Installed desktop health origin is not loopback HTTP: $origin"
  }
  $reportedUserData = Get-AbsolutePath ([string]$smokeResult.userData)
  $expectedUserData = Get-AbsolutePath $userDataRoot
  if (-not $reportedUserData.Equals($expectedUserData, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Installed desktop used unexpected user data path. Expected='$expectedUserData'; Actual='$reportedUserData'"
  }
  Set-Content -LiteralPath $userDataMarkerPath -Value 'retain-after-uninstall' -Encoding ASCII
  $evidence.desktopSmoke = [ordered]@{
    exitCode = $smokeExitCode
    resultFile = $smokeResultPath
    ok = $true
    loaded = $true
    desktopHealthVerifiedByHost = $true
    origin = [string]$smokeResult.origin
    userData = [string]$smokeResult.userData
    marker = $userDataMarkerPath
  }

  $uninstallAttempted = $true
  $uninstallExitCode = Invoke-SilentUninstall -Uninstaller $uninstallerPath -TimeoutSeconds $UninstallTimeoutSeconds
  $installDirectoryRemoved = -not (Test-Path -LiteralPath $installRoot)
  $userDataPreserved = Test-Path -LiteralPath $userDataRoot -PathType Container
  $markerPreserved = Test-Path -LiteralPath $userDataMarkerPath -PathType Leaf
  if (-not $installDirectoryRemoved) { throw "Installation directory remains after uninstall: $installRoot" }
  if (-not ($userDataPreserved -and $markerPreserved)) {
    throw "User data was not preserved after uninstall: $userDataRoot"
  }
  $evidence.uninstall = [ordered]@{
    exitCode = $uninstallExitCode
    installDirectoryRemoved = $installDirectoryRemoved
    userDataDirectory = $userDataRoot
    userDataPreserved = $userDataPreserved
    markerPreserved = $markerPreserved
  }
  $evidence.ok = $true
} catch {
  $failure = $_
  $evidence.error = [ordered]@{
    message = $_.Exception.Message
    type = $_.Exception.GetType().FullName
  }
} finally {
  if ($installed -and -not $uninstallAttempted -and $uninstallerPath -and (Test-Path -LiteralPath $uninstallerPath -PathType Leaf)) {
    try {
      $uninstallAttempted = $true
      $cleanupUninstallExit = Invoke-SilentUninstall -Uninstaller $uninstallerPath -TimeoutSeconds $UninstallTimeoutSeconds
      $evidence.uninstall = [ordered]@{
        exitCode = $cleanupUninstallExit
        cleanupAttempt = $true
        installDirectoryRemoved = -not (Test-Path -LiteralPath $installRoot)
        userDataDirectory = $userDataRoot
        userDataPreserved = Test-Path -LiteralPath $userDataRoot -PathType Container
        markerPreserved = Test-Path -LiteralPath $userDataMarkerPath -PathType Leaf
      }
    } catch {
      if ($null -eq $failure) { $failure = $_ }
      if ($null -eq $evidence.error) {
        $evidence.error = [ordered]@{ message = $_.Exception.Message; type = $_.Exception.GetType().FullName }
      }
    }
  }

  if (-not $KeepTemp) {
    try {
      Remove-VerifiedTemporaryTree -Path $sessionRoot
      $evidence.cleanup = [ordered]@{ kept = $false; removed = -not (Test-Path -LiteralPath $sessionRoot); sessionRoot = $sessionRoot }
    } catch {
      $evidence.cleanup = [ordered]@{ kept = $false; removed = $false; sessionRoot = $sessionRoot; error = $_.Exception.Message }
      if ($null -eq $failure) {
        $failure = $_
        $evidence.ok = $false
        $evidence.error = [ordered]@{ message = $_.Exception.Message; type = $_.Exception.GetType().FullName }
      }
    }
  } else {
    $evidence.cleanup = [ordered]@{ kept = $true; removed = $false; sessionRoot = $sessionRoot }
  }

  $evidence.generatedAt = [DateTime]::UtcNow.ToString('o')
  $evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $evidencePath -Encoding UTF8
}

if ($null -ne $failure) {
  throw "Installer acceptance failed. Evidence: $evidencePath. $($failure.Exception.Message)"
}

Write-Host "Installer acceptance passed: $($evidence.installer.path)"
Write-Host "Evidence: $evidencePath"
