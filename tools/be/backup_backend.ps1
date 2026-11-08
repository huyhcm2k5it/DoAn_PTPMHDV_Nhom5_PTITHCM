[CmdletBinding()]
param([string]$Project='umc-be-test', [string]$OutputDirectory, [switch]$DryRun, [switch]$Library)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PgOwners=@('identity','billing','notification','catalog','clinical','diagnostic')
$MongoOwners=@('patient','appointment','pharmacy')
function Invoke-Docker([string[]]$Arguments) {
    $result=& docker @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Docker $($Arguments[0]) failed; diagnostics suppressed to protect credentials." }
    return ($result -join "`n")
}
function Assert-TestProject([string]$Name, [switch]$RestoreOnly) {
    if ($Name -notmatch '^umc-be-test-restore-[a-z0-9][a-z0-9-]{0,39}$' -and ($RestoreOnly -or $Name -cne 'umc-be-test')) { throw 'Only umc-be-test or umc-be-test-restore-* projects are permitted.' }
}
function Get-ProjectContainer([string]$Name,[string]$Service) {
    $ids=@((Invoke-Docker @('ps','-aq','--filter',"label=com.docker.compose.project=$Name",'--filter',"label=com.docker.compose.service=$Service")) -split "`n" | Where-Object { $_ })
    if ($ids.Count -ne 1) { throw "Expected exactly one $Service container in $Name." }
    $info=(Invoke-Docker @('inspect',$ids[0]) | ConvertFrom-Json)[0]
    if ($info.Config.Labels.'com.docker.compose.project' -cne $Name -or $info.Config.Labels.'com.docker.compose.service' -cne $Service) { throw 'Container identity mismatch.' }
    return $ids[0]
}
function Assert-LocalOutput([string]$Path) {
    if (!$Path) { throw 'An explicit output directory is required.' }
    $full=[IO.Path]::GetFullPath($Path)
    $allowed=[IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\ChatGPT\HDV'))+'\'
    if (!$full.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { throw 'Output must be below Documents/ChatGPT/HDV.' }
    $cursor=$full
    while ($cursor) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Output reparse points are forbidden.' }
        $cursor=Split-Path -Parent $cursor
    }
    return $full
}
function Get-PgInventory([string]$Container,[string]$Owner) {
    $sql="SELECT format('SELECT %L AS table_name, count(*)::bigint AS row_count FROM %I.%I;', schemaname || '.' || tablename, schemaname, tablename) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename;`n\gexec`n"
    $remote='/tmp/be-inventory-'+[Guid]::NewGuid().ToString('N')+'.sql'
    $local=[IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($local,$sql,[Text.UTF8Encoding]::new($false))
        $null=Invoke-Docker @('cp',$local,"${Container}:$remote")
        $command='export PGPASSWORD="$'+$Owner.ToUpperInvariant()+'_DB_PASSWORD"; exec psql -h localhost -U '+$Owner+'_owner -d '+$Owner+'_db -X -A -t -v ON_ERROR_STOP=1 -f '+$remote
        return Invoke-Docker @('exec',$Container,'sh','-ec',$command)
    } finally { Remove-Item -LiteralPath $local -Force; $null=Invoke-Docker @('exec',$Container,'rm','-f',$remote) }
}
function Get-MongoInventory([string]$Container,[string]$Owner) {
    $js='const d=db.getSiblingDB("'+$Owner+'_db"); print(JSON.stringify(d.getCollectionNames().sort().map(n=>({collection:n,count:d.getCollection(n).countDocuments({}),indexes:d.getCollection(n).getIndexes()}))))'
    return Invoke-Docker @('exec',$Container,'sh','-ec','exec mongosh --quiet --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "$1"','sh',$js)
}
if ($Library) { return }
Assert-TestProject $Project
$postgres=Get-ProjectContainer $Project 'postgres'
$mongo=Get-ProjectContainer $Project 'mongo'
if ($DryRun) {
    @{project=$Project;postgres=$postgres;mongo=$mongo;databases=@($PgOwners+$MongoOwners);action='PLAN_ONLY';requires='Stopped application writers; explicit local output'} | ConvertTo-Json
    return
}
$output=Assert-LocalOutput $OutputDirectory
if (Test-Path -LiteralPath $output) { throw 'Backup directory must not exist.' }
$running=(Invoke-Docker @('ps','--filter',"label=com.docker.compose.project=$Project",'--format','{{.Label "com.docker.compose.service"}}')) -split "`n"
if (@($running | Where-Object { $_ -and $_ -notin @('postgres','mongo','rabbitmq','redis-catalog','gateway') }).Count) { throw 'Stop application writers and workers before a coherent backup; this tool never stops them.' }
$null=Invoke-Docker @('exec',$mongo,'sh','-ec','command -v mongodump >/dev/null; command -v mongorestore >/dev/null')
New-Item -ItemType Directory -Path $output | Out-Null
$entries=@()
foreach ($owner in $PgOwners+$MongoOwners) {
    $pg=$owner -in $PgOwners
    $container=if($pg){$postgres}else{$mongo}
    $file=if($pg){"$owner.dump"}else{"$owner.archive"}
    $remote='/tmp/be-'+[Guid]::NewGuid().ToString('N')
    try {
        $before=if($pg){Get-PgInventory $container $owner}else{Get-MongoInventory $container $owner}
        if ($pg) { $command='export PGPASSWORD="$'+$owner.ToUpperInvariant()+'_DB_PASSWORD"; exec pg_dump -h localhost -U '+$owner+'_owner -d '+$owner+'_db -Fc -f '+$remote }
        else { $command='exec mongodump --quiet --host localhost --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db '+$owner+'_db --archive='+$remote }
        $null=Invoke-Docker @('exec',$container,'sh','-ec',$command)
        $null=Invoke-Docker @('cp',"${container}:$remote",(Join-Path $output $file))
        $after=if($pg){Get-PgInventory $container $owner}else{Get-MongoInventory $container $owner}
        if ($before -cne $after) { throw 'Source changed during backup.' }
        $entries+=@{owner=$owner;engine=$(if($pg){'postgres'}else{'mongo'});file=$file;sha256=(Get-FileHash -Algorithm SHA256 (Join-Path $output $file)).Hash;inventory=$before}
    } finally { $null=Invoke-Docker @('exec',$container,'rm','-f',$remote) }
}
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$sha=& git -C $repo rev-parse HEAD
if ($LASTEXITCODE) { throw 'Cannot record source revision.' }
$dirty=[bool](& git -C $repo status --porcelain)
@{format=1;project=$Project;createdUtc=[DateTime]::UtcNow.ToString('o');commit=$sha;dirty=$dirty;postgresVersion=(Invoke-Docker @('exec',$postgres,'pg_dump','--version'));mongoVersion=(Invoke-Docker @('exec',$mongo,'mongodump','--version'));entries=$entries;workerReplay='NOT_RUN'} | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $output 'manifest.json')
Write-Output "Backup written: $output. Worker recovery acceptance remains NOT_RUN."
