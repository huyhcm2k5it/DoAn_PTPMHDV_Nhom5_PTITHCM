$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$ownerDir = Join-Path $repoRoot "env"
$envPath = Join-Path $ownerDir "quan.env"
$keyDir = Join-Path $repoRoot "mongo/secrets"
$keyPath = Join-Path $keyDir "replica.key"
function New-SecretHex([int]$bytes = 32) {
  $buffer = [byte[]]::new($bytes)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  [System.BitConverter]::ToString($buffer).Replace("-", "").ToLowerInvariant()
}
New-Item -ItemType Directory -Force $ownerDir | Out-Null
if (-not (Test-Path -LiteralPath $envPath)) {
  $rootPassword = New-SecretHex 32
  $patientPassword = New-SecretHex 32
  $appointmentPassword = New-SecretHex 32
  $pharmacyPassword = New-SecretHex 32
  $rabbitPassword = New-SecretHex 32
  $appointmentRedisPassword = New-SecretHex 32
  $lines = @(
    "GATEWAY_HOST_PORT=8080"
    "PATIENT_PORT=8001"
    "APPOINTMENT_PORT=8002"
    "PHARMACY_PORT=8003"
    "RABBITMQ_PORT=5672"
    "MONGO_ROOT_USER=local-root"
    "MONGO_ROOT_PASSWORD=$rootPassword"
    "PATIENT_DB_PASSWORD=$patientPassword"
    "APPOINTMENT_DB_PASSWORD=$appointmentPassword"
    "PHARMACY_DB_PASSWORD=$pharmacyPassword"
    "PATIENT_MONGO_URI=mongodb://patient-service:$patientPassword@mongo:27017/patient_db?authSource=patient_db&replicaSet=rs0"
    "APPOINTMENT_MONGO_URI=mongodb://appointment-service:$appointmentPassword@mongo:27017/appointment_db?authSource=appointment_db&replicaSet=rs0"
    "PHARMACY_MONGO_URI=mongodb://pharmacy-service:$pharmacyPassword@mongo:27017/pharmacy_db?authSource=pharmacy_db&replicaSet=rs0"
    "RABBITMQ_DEFAULT_USER=local-worker"
    "RABBITMQ_DEFAULT_PASS=$rabbitPassword"
    "RABBITMQ_DEFAULT_VHOST=/umc-care"
    "RABBITMQ_HOST=rabbitmq"
    "RABBITMQ_VHOST=/umc-care"
    "RABBITMQ_USER=local-worker"
    "RABBITMQ_PASSWORD=$rabbitPassword"
    "UMC_AMQP_URL=amqp://local-worker:$rabbitPassword@rabbitmq:5672/%2Fumc-care"
    "APPOINTMENT_REDIS_PASSWORD=$appointmentRedisPassword"
  )
  [System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))
  Write-Output "Created env/quan.env with local-only generated secrets."
} else { Write-Output "Kept existing env/quan.env unchanged." }
New-Item -ItemType Directory -Force $keyDir | Out-Null
if (-not (Test-Path -LiteralPath $keyPath)) {
  [System.IO.File]::WriteAllText($keyPath, (New-SecretHex 64), [System.Text.UTF8Encoding]::new($false))
  Write-Output "Created local Mongo replica-set keyfile."
} else { Write-Output "Kept existing Mongo keyfile unchanged." }
Write-Output "Next: prepare env/huy.env and env/hung.env; see env/README.md."
