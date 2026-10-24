$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$envPath = Join-Path $repoRoot ".env"
$keyDir = Join-Path $repoRoot "mongo/secrets"
$keyPath = Join-Path $keyDir "replica.key"
function New-SecretHex([int]$bytes = 32) {
  $buffer = [byte[]]::new($bytes)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  [Convert]::ToHexString($buffer).ToLowerInvariant()
}
if (-not (Test-Path -LiteralPath $envPath)) {
  $rootPassword = New-SecretHex 32
  $patientPassword = New-SecretHex 32
  $appointmentPassword = New-SecretHex 32
  $pharmacyPassword = New-SecretHex 32
  $adminPassword = New-SecretHex 32
  $lines = @(
    "MONGO_ROOT_USER=local-root"
    "MONGO_ROOT_PASSWORD=$rootPassword"
    "PATIENT_DB_PASSWORD=$patientPassword"
    "APPOINTMENT_DB_PASSWORD=$appointmentPassword"
    "PHARMACY_DB_PASSWORD=$pharmacyPassword"
    "PATIENT_MONGO_URI=mongodb://patient-service:$patientPassword@mongo:27017/patient_db?authSource=patient_db&replicaSet=rs0"
    "APPOINTMENT_MONGO_URI=mongodb://appointment-service:$appointmentPassword@mongo:27017/appointment_db?authSource=appointment_db&replicaSet=rs0"
    "PHARMACY_MONGO_URI=mongodb://pharmacy-service:$pharmacyPassword@mongo:27017/pharmacy_db?authSource=pharmacy_db&replicaSet=rs0"
    "RABBITMQ_ADMIN_USER=local-admin"
    "RABBITMQ_ADMIN_PASSWORD=$adminPassword"
  )
  [System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))
  Write-Output "Created .env with local-only generated secrets."
} else { Write-Output "Kept existing .env unchanged." }
New-Item -ItemType Directory -Force $keyDir | Out-Null
if (-not (Test-Path -LiteralPath $keyPath)) {
  [System.IO.File]::WriteAllText($keyPath, (New-SecretHex 64), [System.Text.UTF8Encoding]::new($false))
  Write-Output "Created local Mongo replica-set keyfile."
} else { Write-Output "Kept existing Mongo keyfile unchanged." }
Write-Output "Next: docker compose --env-file .env -f infra/compose/compose.yaml up -d --build --wait"