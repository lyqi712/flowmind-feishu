[CmdletBinding()]
param([switch]$SkipWebBuild)
$ErrorActionPreference='Stop'

# Keep the runtime allowlist explicit: never copy app data, credentials, or desktop/out.
function Copy-PortableApplication {
  param([string]$AppRoot, [string]$Destination)
  $runtimeDirectories=@('dist','server','shared','src/workspace','mcp','desktop/assets')
  $runtimeFiles=@('package.json','package-lock.json','desktop/bootstrap.cjs','desktop/main.mjs','desktop/preload.cjs')
  foreach($relative in ($runtimeDirectories + $runtimeFiles + @('dist/index.html'))){
    if(-not(Test-Path -LiteralPath (Join-Path $AppRoot $relative))){throw "Portable runtime input missing: $relative"}
  }
  foreach($relative in $runtimeDirectories){
    $target=Join-Path $Destination $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target)|Out-Null
    Copy-Item -LiteralPath (Join-Path $AppRoot $relative) -Destination $target -Recurse -Force
  }
  $desktopDest=Join-Path $Destination 'desktop'
  Get-ChildItem -LiteralPath (Join-Path $AppRoot 'desktop') -File | Copy-Item -Destination $desktopDest -Force
  foreach($relative in @('package.json','package-lock.json')){
    Copy-Item -LiteralPath (Join-Path $AppRoot $relative) -Destination $Destination -Force
  }
}

$projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$appRoot=Join-Path $projectRoot 'app'
$electronDist=Join-Path $appRoot 'node_modules\electron\dist'
$outRoot=Join-Path $appRoot 'desktop\out'
$portable=Join-Path $outRoot 'FlowMind-portable-x64'
$resourceApp=Join-Path $portable 'resources\app'
$package=([System.IO.File]::ReadAllText((Join-Path $appRoot 'package.json'),[System.Text.Encoding]::UTF8) | ConvertFrom-Json)
$version=[string]$package.version
if(-not $SkipWebBuild){Push-Location $appRoot;try{& npm.cmd run build;if($LASTEXITCODE-ne 0){throw 'Renderer build failed'}}finally{Pop-Location}}
if(-not(Test-Path -LiteralPath (Join-Path $electronDist 'electron.exe'))){throw "Electron runtime missing: $electronDist"}
$resolvedDesktop=[IO.Path]::GetFullPath((Join-Path $appRoot 'desktop'))+[IO.Path]::DirectorySeparatorChar
$resolvedPortable=[IO.Path]::GetFullPath($portable)
if(-not $resolvedPortable.StartsWith($resolvedDesktop,[StringComparison]::OrdinalIgnoreCase)){throw "Unsafe portable path: $resolvedPortable"}
if(Test-Path -LiteralPath $portable){Remove-Item -LiteralPath $portable -Recurse -Force}
New-Item -ItemType Directory -Force -Path $portable,$resourceApp|Out-Null
Copy-Item -Path (Join-Path $electronDist '*') -Destination $portable -Recurse -Force
Move-Item -LiteralPath (Join-Path $portable 'electron.exe') -Destination (Join-Path $portable 'FlowMind.exe')
$exe=Join-Path $portable 'FlowMind.exe'
$icon=Join-Path $appRoot 'desktop\assets\icon.ico'
$customizer=Join-Path $appRoot 'desktop\customize-exe.mjs'
if(-not(Test-Path -LiteralPath $icon -PathType Leaf)){throw "Application icon missing: $icon"}
& node $customizer $exe $icon $version ([string]$package.productName)
if($LASTEXITCODE-ne 0){throw 'Portable executable customization failed'}
Copy-PortableApplication -AppRoot $appRoot -Destination $resourceApp
Push-Location $resourceApp
try{& npm.cmd ci --omit=dev --ignore-scripts;if($LASTEXITCODE-ne 0){throw 'Production dependency install failed'}}finally{Pop-Location}
$zip=Join-Path $outRoot ("FlowMind-Feishu-AI-Workspace-$version-x64-portable.zip")
if(Test-Path -LiteralPath $zip){Remove-Item -LiteralPath $zip -Force}
$tar=Join-Path $env:SystemRoot 'System32\tar.exe'
if(-not(Test-Path -LiteralPath $tar -PathType Leaf)){throw "Windows tar missing: $tar"}
Push-Location $outRoot
try{& $tar -a -cf $zip 'FlowMind-portable-x64';if($LASTEXITCODE-ne 0){throw 'Portable ZIP creation failed'}}finally{Pop-Location}
[PSCustomObject]@{PortableDirectory=$portable;Executable=$exe;Zip=$zip;ExeBytes=(Get-Item -LiteralPath $exe).Length;ZipBytes=(Get-Item -LiteralPath $zip).Length}|Format-List
