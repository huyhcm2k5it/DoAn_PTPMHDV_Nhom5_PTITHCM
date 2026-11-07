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
$envFile = Join-Path $repoRoot ".env"
$values = Read-Environment $envFile
foreach ($key in @("HUY_POSTGRES_PASSWORD", "CATALOG_DB_PASSWORD", "CLINICAL_DB_PASSWORD", "DIAGNOSTIC_DB_PASSWORD", "CATALOG_REDIS_PASSWORD")) {
  if (-not $values.ContainsKey($key)) {
    [System.IO.File]::AppendAllText($envFile, [Environment]::NewLine + $key + "=" + (New-Password), [System.Text.UTF8Encoding]::new($false))
  }
}
$rabbitFile = Join-Path $repoRoot "rabbitmq/.env"
if (-not (Test-Path -LiteralPath $rabbitFile)) {
  $password = New-Password
  [System.IO.File]::WriteAllLines($rabbitFile, @("RABBITMQ_DEFAULT_USER=local-worker",
    "RABBITMQ_DEFAULT_PASS=$password", "RABBITMQ_DEFAULT_VHOST=/umc-care"), [System.Text.UTF8Encoding]::new($false))
}
$rabbit = Read-Environment $rabbitFile
if (-not $values.ContainsKey("UMC_AMQP_URL")) {
  foreach ($key in @("RABBITMQ_DEFAULT_USER", "RABBITMQ_DEFAULT_PASS", "RABBITMQ_DEFAULT_VHOST")) {
    if (-not $rabbit[$key]) { throw "RabbitMQ env is incomplete: $key" }
  }
  $userPart = [Uri]::EscapeDataString($rabbit["RABBITMQ_DEFAULT_USER"])
  $passPart = [Uri]::EscapeDataString($rabbit["RABBITMQ_DEFAULT_PASS"])
  $vhostPart = [Uri]::EscapeDataString($rabbit["RABBITMQ_DEFAULT_VHOST"])
  $url = "amqp://" + $userPart + ":" + $passPart + "@rabbitmq:5672/" + $vhostPart
  [System.IO.File]::AppendAllText($envFile, [Environment]::NewLine + "UMC_AMQP_URL=" + $url + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false))
}
Push-Location $repoRoot
try {
  node tools/quan/prepare-gateway-key.js
  if ($LASTEXITCODE -ne 0) { throw "Configure Identity public key before preparing Gateway JWKS." }
} finally { Pop-Location }
Write-Output "Prepared missing local values; existing values were preserved. Configure Identity/Billing/Notification owner env before starting Compose."
