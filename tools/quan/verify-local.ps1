$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
function Invoke-Check([string]$relative, [string[]]$arguments) {
  Push-Location (Join-Path $repoRoot $relative)
  try {
    & npm @arguments
    if ($LASTEXITCODE -ne 0) { throw "Check failed in $relative" }
  } finally { Pop-Location }
}
foreach ($service in @("patient", "appointment", "pharmacy")) {
  Invoke-Check "services/$service" @("run", "check")
  Invoke-Check "services/$service" @("test")
}
Invoke-Check "tests/mongo" @("run", "check")
Invoke-Check "tests/mongo" @("test")
Invoke-Check "apps/web" @("test", "--", "--maxWorkers=1")
Invoke-Check "apps/web" @("run", "build")
Push-Location $repoRoot
try {
  node tools/quan/generate-pharmacy-contract.js --check
  if ($LASTEXITCODE -ne 0) { throw "Contract differs from generator." }
  node tools/quan/check-pharmacy-topology.js
  if ($LASTEXITCODE -ne 0) { throw "Pharmacy topology differs from receiver." }
  docker compose -f infra/compose/compose.yaml config --no-env-resolution --no-interpolate --quiet
  if ($LASTEXITCODE -ne 0) { throw "Compose structure invalid." }
} finally { Pop-Location }
Write-Output "Local checks passed. Live broker, owner signoff and nine-service E2E are separate gates."
