param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$destination = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $destination -PathType Container)) {
  throw "Create a local output directory outside the repository first."
}
if ($destination.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Output directory must be outside the source repository."
}
Push-Location $repoRoot
try {
  $status = git status --porcelain
  if ($LASTEXITCODE -ne 0 -or $status) { throw "Commit or resolve local changes before packaging." }
  $commit = git rev-parse HEAD
  if ($LASTEXITCODE -ne 0) { throw "Cannot identify source revision." }
  $archive = Join-Path $destination ("umc-care-source-" + $commit.Substring(0,12) + ".zip")
  if (Test-Path -LiteralPath $archive) { throw "Archive already exists; select another directory." }
  git archive --format=zip --output=$archive HEAD
  if ($LASTEXITCODE -ne 0) { throw "Source archive failed." }
  $checksum = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
  $manifest = @{ commit=$commit; source=$archive; sha256=$checksum; createdAt=(Get-Date).ToUniversalTime().ToString("o");
    status="SOURCE_ONLY"; required=@("CI URL", "receiver signoff", "APK revision and checksum", "owner database backup/restore evidence") }
  $manifest | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath ($archive + ".manifest.json")
  Write-Output "Source archive and checksum created. Database backup and APK must come from their owners."
} finally { Pop-Location }
