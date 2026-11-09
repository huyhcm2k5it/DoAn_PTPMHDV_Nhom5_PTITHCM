$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
function Read-Environment([string]$file) {
  $values = @{}
  if (Test-Path -LiteralPath $file) {
    foreach ($line in Get-Content -LiteralPath $file) {
      if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { $values[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
    }
  }
  return $values
}
function New-Password {
  $buffer = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return [System.BitConverter]::ToString($buffer).Replace("-", "").ToLowerInvariant()
}
& (Join-Path $repoRoot "scripts/dev/bootstrap-local.ps1")
$quanFile = Join-Path $repoRoot "env/quan.env"
$huyFile = Join-Path $repoRoot "env/huy.env"
$hungFile = Join-Path $repoRoot "env/hung.env"
$quan = Read-Environment $quanFile
foreach ($key in @("RABBITMQ_DEFAULT_USER", "RABBITMQ_DEFAULT_PASS", "RABBITMQ_DEFAULT_VHOST", "RABBITMQ_USER", "RABBITMQ_PASSWORD", "UMC_AMQP_URL", "APPOINTMENT_REDIS_PASSWORD")) {
  if (-not $quan[$key]) { throw "env/quan.env is missing $key" }
}
if ($quan["RABBITMQ_DEFAULT_USER"] -ne $quan["RABBITMQ_USER"] -or $quan["RABBITMQ_DEFAULT_PASS"] -ne $quan["RABBITMQ_PASSWORD"]) {
  throw "RabbitMQ broker and worker credentials differ in env/quan.env"
}
if (-not (Test-Path -LiteralPath $huyFile)) {
  $lines = foreach ($key in @("HUY_POSTGRES_PASSWORD", "CATALOG_DB_PASSWORD", "CLINICAL_DB_PASSWORD", "DIAGNOSTIC_DB_PASSWORD", "CATALOG_REDIS_PASSWORD")) {
    "$key=$(New-Password)"
  }
  [System.IO.File]::WriteAllLines($huyFile, $lines, [System.Text.UTF8Encoding]::new($false))
  Write-Output "Created env/huy.env with local-only generated secrets."
}
if (-not (Test-Path -LiteralPath $hungFile)) {
  throw "Create env/hung.env from env/hung.env.example with Hưng's values before starting Compose."
}
Push-Location $repoRoot
try {
  node tools/quan/prepare-gateway-key.js
  if ($LASTEXITCODE -ne 0) { throw "Configure Identity public key before preparing Gateway JWKS." }
} finally { Pop-Location }
Write-Output "Prepared three-owner env layout. Existing owner values were preserved."
