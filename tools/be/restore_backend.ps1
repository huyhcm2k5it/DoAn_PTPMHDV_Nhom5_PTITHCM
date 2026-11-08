[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Project,
      [Parameter(Mandatory=$true)][string]$BackupDirectory,
      [string]$ReportDirectory, [switch]$DryRun, [switch]$Verify)
. (Join-Path $PSScriptRoot 'backup_backend.ps1') -Library -Project $Project -DryRun:$DryRun
Assert-TestProject $Project -RestoreOnly
$backup=Assert-LocalOutput $BackupDirectory
$manifest=Get-Content -Raw -LiteralPath (Join-Path $backup 'manifest.json') | ConvertFrom-Json
if ($manifest.format -ne 1 -or $manifest.entries.Count -ne 9) { throw 'Expected version 1 manifest with exactly nine owner databases.' }
$seen=@{}
foreach ($entry in $manifest.entries) {
    $pg=$entry.owner -in $PgOwners
    if (!$pg -and $entry.owner -notin $MongoOwners) { throw 'Unknown owner.' }
    if ($seen.ContainsKey($entry.owner)) { throw 'Duplicate owner.' }; $seen[$entry.owner]=$true
    $expected=if($pg){"$($entry.owner).dump"}else{"$($entry.owner).archive"}
    $engine=if($pg){'postgres'}else{'mongo'}
    if ($entry.file -cne $expected -or $entry.engine -cne $engine) { throw 'Manifest path/engine mismatch.' }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $backup $expected)).Hash -cne $entry.sha256) { throw 'Backup checksum mismatch.' }
}
foreach ($kind in @('container','volume','network')) {
    $args=if($kind -eq 'container'){@('ps','-aq')}else{@($kind,'ls','-q')}
    if (Invoke-Docker ($args+@('--filter',"label=com.docker.compose.project=$Project"))) { throw 'Restore project already exists; never reuse its data.' }
}
foreach ($volume in @("${Project}_postgres_be_data","${Project}_mongo_data")) {
    if (Invoke-Docker @('volume','ls','-q','--filter',"name=^${volume}$")) { throw 'Target volume already exists.' }
}
if ($DryRun) { @{project=$Project;action='VALIDATED_PLAN';databases=9;workerReplay='NOT_RUN'} | ConvertTo-Json; return }
$report=Assert-LocalOutput $ReportDirectory
if (Test-Path -LiteralPath $report) { throw 'Report directory must not exist.' }
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$envFile=Join-Path $repo '.runtime/be-test/test.env'
if (!(Test-Path -LiteralPath $envFile)) { throw 'Prepare the test stack credentials first.' }
New-Item -ItemType Directory -Path $report | Out-Null
$pgEnv=@{POSTGRES_USER='umc_bootstrap';POSTGRES_DB='umc_bootstrap';POSTGRES_PASSWORD='${POSTGRES_PASSWORD:?required}'}
foreach ($owner in $PgOwners) { $key=$owner.ToUpperInvariant()+'_DB_PASSWORD'; $pgEnv[$key]='${'+$key+':?required}' }
$mongoEnv=@{MONGO_INITDB_ROOT_USERNAME='${MONGO_ROOT_USER:?required}';MONGO_INITDB_ROOT_PASSWORD='${MONGO_ROOT_PASSWORD:?required}'}
foreach ($owner in $MongoOwners) { $key=$owner.ToUpperInvariant()+'_DB_PASSWORD'; $mongoEnv[$key]='${'+$key+':?required}' }
$compose=@{name=$Project;services=@{
    postgres=@{image='postgres:18';environment=$pgEnv;volumes=@('postgres_be_data:/var/lib/postgresql',((Join-Path $repo 'infra/compose/postgres/all/init.sh').Replace('\','/')+':/docker-entrypoint-initdb.d/10-owners.sh:ro'))};
    mongo=@{image='mongo:8.0.16';environment=$mongoEnv;volumes=@('mongo_data:/data/db')}
};volumes=@{postgres_be_data=@{name="${Project}_postgres_be_data"};mongo_data=@{name="${Project}_mongo_data"}};networks=@{default=@{internal=$true}}}
$composePath=Join-Path $report 'restore.compose.json'
$compose | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 -LiteralPath $composePath
$timer=[Diagnostics.Stopwatch]::StartNew()
$null=Invoke-Docker @('compose','--env-file',$envFile,'-p',$Project,'-f',$composePath,'up','-d')
$pg=Get-ProjectContainer $Project 'postgres'; $mongo=Get-ProjectContainer $Project 'mongo'
$ready=$false
for ($i=0;$i -lt 60;$i++) {
    try {
        $null=Invoke-Docker @('exec',$pg,'pg_isready','-U','umc_bootstrap','-d','umc_bootstrap')
        $null=Invoke-Docker @('exec',$mongo,'sh','-ec','exec mongosh --quiet --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "quit(db.adminCommand({ping:1}).ok?0:1)"')
        $null=Get-PgInventory $pg 'diagnostic'
        $ready=$true; break
    } catch { Start-Sleep -Seconds 2 }
}
if (!$ready) { throw 'Fresh databases did not become ready in 120 seconds; resources preserved for inspection.' }
foreach ($entry in $manifest.entries) {
    $isPg=$entry.engine -eq 'postgres'; $container=if($isPg){$pg}else{$mongo}
    $remote='/tmp/restore-'+[Guid]::NewGuid().ToString('N')
    try {
        $null=Invoke-Docker @('cp',(Join-Path $backup $entry.file),"${container}:$remote")
        if ($isPg) {
            $command='export PGPASSWORD="$'+$entry.owner.ToUpperInvariant()+'_DB_PASSWORD"; exec pg_restore --exit-on-error --single-transaction -h localhost -U '+$entry.owner+'_owner -d '+$entry.owner+'_db '+$remote
        } else {
            $command='exec mongorestore --quiet --host localhost --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --nsInclude='+$entry.owner+'_db.* --archive='+$remote
        }
        $null=Invoke-Docker @('exec',$container,'sh','-ec',$command)
        $actual=if($isPg){Get-PgInventory $container $entry.owner}else{Get-MongoInventory $container $entry.owner}
        if ($actual -cne $entry.inventory) { throw "Inventory mismatch for $($entry.owner). Resources preserved." }
    } finally { $null=Invoke-Docker @('exec',$container,'rm','-f',$remote) }
}
foreach ($owner in $MongoOwners) {
    $js='db.getSiblingDB("'+$owner+'_db").createUser({user:"'+$owner+'-service",pwd:process.env.'+$owner.ToUpperInvariant()+'_DB_PASSWORD,roles:[{role:"readWrite",db:"'+$owner+'_db"}]})'
    $null=Invoke-Docker @('exec',$mongo,'sh','-ec','exec mongosh --quiet --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "$1"','sh',$js)
}
$timer.Stop()
@{project=$Project;databaseRestore='PASS';ownerInventories='MATCH';recoverySeconds=$timer.Elapsed.TotalSeconds;workerReplay='NOT_RUN';replicaSet='NOT_CONFIGURED';backendReady=$false;note='Database-only isolated restore; worker replay, uniqueness probes and receiver acceptance remain required.'} | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $report 'result.json')
Write-Output "Database restore verified in $($timer.Elapsed.TotalSeconds) seconds. Full BE-35 acceptance remains BLOCKED on worker/receiver checks."
