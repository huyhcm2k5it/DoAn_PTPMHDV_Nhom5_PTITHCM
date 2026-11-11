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
foreach ($key in @("PATIENT_MONGO_URI", "APPOINTMENT_MONGO_URI", "PHARMACY_MONGO_URI", "RABBITMQ_DEFAULT_USER", "RABBITMQ_DEFAULT_PASS", "RABBITMQ_DEFAULT_VHOST", "RABBITMQ_HOST", "RABBITMQ_PORT", "RABBITMQ_VHOST", "RABBITMQ_USER", "RABBITMQ_PASSWORD", "UMC_AMQP_URL", "APPOINTMENT_REDIS_PASSWORD")) {
  if (-not $quan[$key]) { throw "env/quan.env is missing $key" }
}
if ($quan["RABBITMQ_HOST"] -eq "rabbitmq" -and ($quan["RABBITMQ_DEFAULT_USER"] -ne $quan["RABBITMQ_USER"] -or $quan["RABBITMQ_DEFAULT_PASS"] -ne $quan["RABBITMQ_PASSWORD"])) {
  throw "RabbitMQ broker and worker credentials differ in env/quan.env"
}
if (-not (Test-Path -LiteralPath $huyFile)) {
  $huyPostgresPassword = New-Password
  $catalogPassword = New-Password
  $clinicalPassword = New-Password
  $diagnosticPassword = New-Password
  $catalogRedisPassword = New-Password
  $lines = @(
    "CATALOG_PORT=8007"
    "CLINICAL_PORT=8008"
    "DIAGNOSTIC_PORT=8009"
    "HUY_POSTGRES_PASSWORD=$huyPostgresPassword"
    "CATALOG_DB_PASSWORD=$catalogPassword"
    "CLINICAL_DB_PASSWORD=$clinicalPassword"
    "DIAGNOSTIC_DB_PASSWORD=$diagnosticPassword"
    "CATALOG_REDIS_PASSWORD=$catalogRedisPassword"
    "CATALOG_DATABASE_URL=postgres://catalog_owner:$catalogPassword@postgres:5432/catalog_db?sslmode=disable"
    "CLINICAL_DATABASE_URL=postgres://clinical_owner:$clinicalPassword@postgres:5432/clinical_db?sslmode=disable"
    "DIAGNOSTIC_DATABASE_URL=postgres://diagnostic_owner:$diagnosticPassword@postgres:5432/diagnostic_db?sslmode=disable"
  )
  [System.IO.File]::WriteAllLines($huyFile, $lines, [System.Text.UTF8Encoding]::new($false))
  Write-Output "Created env/huy.env with local-only generated secrets."
}
$huy = Read-Environment $huyFile
foreach ($key in @("CATALOG_DATABASE_URL", "CLINICAL_DATABASE_URL", "DIAGNOSTIC_DATABASE_URL")) {
  if (-not $huy[$key]) { throw "env/huy.env is missing $key" }
}
if (-not (Test-Path -LiteralPath $hungFile)) {
  throw "Create env/hung.env from env/hung.env.example with Hưng's values before starting Compose."
}
$hung = Read-Environment $hungFile
foreach ($key in @("IDENTITY_DB_NAME", "IDENTITY_DB_USER", "IDENTITY_DB_HOST", "IDENTITY_DB_PORT", "IDENTITY_DB_SSLMODE", "BILLING_DB_NAME", "BILLING_DB_USER", "BILLING_DB_HOST", "BILLING_DB_PORT", "BILLING_DB_SSLMODE", "NOTIFICATION_DB_NAME", "NOTIFICATION_DB_USER", "NOTIFICATION_DB_HOST", "NOTIFICATION_DB_PORT", "NOTIFICATION_DB_SSLMODE")) {
  if (-not $hung[$key]) { throw "env/hung.env is missing $key" }
}
Push-Location $repoRoot
try {
  node tools/quan/prepare-gateway-key.js
  if ($LASTEXITCODE -ne 0) { throw "Configure Identity public key before preparing Gateway JWKS." }
} finally { Pop-Location }
Write-Output "Prepared three-owner env layout. Existing owner values were preserved."
