param(
 [Parameter(Mandatory=$true)][ValidateSet('catalog','clinical','diagnostic')][string]$Service,
 [Parameter(ValueFromRemainingArguments=$true)][string[]]$GoArguments
)
$ErrorActionPreference='Stop'
$repoRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runtimeRoot=Join-Path $repoRoot '.runtime'
foreach($directory in @('gocache','gomodcache','gopath','go-temp')){New-Item -ItemType Directory -Force -Path (Join-Path $runtimeRoot $directory) | Out-Null}
$env:GOCACHE=Join-Path $runtimeRoot 'gocache'
$env:GOMODCACHE=Join-Path $runtimeRoot 'gomodcache'
$env:GOPATH=Join-Path $runtimeRoot 'gopath'
$env:GOTMPDIR=Join-Path $runtimeRoot 'go-temp'
Push-Location (Join-Path $repoRoot "services/$Service")
try { & go @GoArguments; $result=$LASTEXITCODE } finally { Pop-Location }
exit $result
