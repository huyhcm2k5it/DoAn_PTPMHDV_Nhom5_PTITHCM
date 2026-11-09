$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Push-Location $repoRoot
try {
  $probe = @'
(async () => {
  const targets = { patient:8001, appointment:8002, pharmacy:8003, identity:8004,
    billing:8005, notification:8006, catalog:8007, clinical:8008, diagnostic:8009 };
  let failed = false;
  for (const [service, port] of Object.entries(targets)) {
    try {
      const response = await fetch('http://' + service + ':' + port + '/health/ready',
        { signal: AbortSignal.timeout(5000) });
      console.log(service + ': ' + response.status);
      if (!response.ok) failed = true;
    } catch { console.log(service + ': UNAVAILABLE'); failed = true; }
  }
  process.exitCode = failed ? 1 : 0;
})().catch(() => { process.exitCode = 1; });
'@
  docker compose --env-file env/quan.env --env-file env/huy.env --env-file env/hung.env -f infra/compose/compose.yaml exec -T appointment node -e $probe
  if ($LASTEXITCODE -ne 0) { throw "Nine-service readiness gate failed." }
} finally { Pop-Location }
