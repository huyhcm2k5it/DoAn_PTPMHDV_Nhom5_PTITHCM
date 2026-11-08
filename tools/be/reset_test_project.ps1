[CmdletBinding()]
param([string]$Project='umc-be-test',[switch]$DryRun,[switch]$Execute,[string]$Confirmation)
. (Join-Path $PSScriptRoot 'backup_backend.ps1') -Library -Project $Project -DryRun:$DryRun
Assert-TestProject $Project
if ($Execute -and $DryRun) { throw 'Choose dry run or execute.' }
$ids=@((Invoke-Docker @('ps','-aq','--filter',"label=com.docker.compose.project=$Project")) -split "`n" | Where-Object { $_ })
$volumes=@((Invoke-Docker @('volume','ls','-q','--filter',"label=com.docker.compose.project=$Project")) -split "`n" | Where-Object { $_ })
foreach ($id in $ids) {
    $item=(Invoke-Docker @('inspect',$id) | ConvertFrom-Json)[0]
    if ($item.Config.Labels.'com.docker.compose.project' -cne $Project) { throw 'Container label mismatch.' }
    foreach ($mount in $item.Mounts) {
        if ($mount.Type -eq 'volume' -and $mount.Name -notin $volumes) { throw 'Shared or foreign volume mount: reset refused.' }
    }
}
foreach ($volume in $volumes) {
    $item=(Invoke-Docker @('volume','inspect',$volume) | ConvertFrom-Json)[0]
    if ($item.Labels.'com.docker.compose.project' -cne $Project -or !$volume.StartsWith($Project+'_',[StringComparison]::Ordinal)) { throw 'Volume identity mismatch.' }
}
@{project=$Project;containers=$ids;volumes=$volumes;action=$(if($Execute){'REMOVE_STOPPED_TEST_RESOURCES'}else{'DRY_RUN'})} | ConvertTo-Json
if (!$Execute) { return }
if ($Confirmation -cne "DELETE:$Project") { throw 'Explicit -Confirmation DELETE:<project> required.' }
foreach ($id in $ids) {
    $item=(Invoke-Docker @('inspect',$id) | ConvertFrom-Json)[0]
    if ($item.State.Running) { throw 'Running containers cannot be reset. Stop and review them separately.' }
}
foreach ($volume in $volumes) {
    $users=@((Invoke-Docker @('ps','-aq','--filter',"volume=$volume")) -split "`n" | Where-Object { $_ })
    if (@($users | Where-Object { $_ -notin $ids }).Count) { throw 'Volume has a foreign container user.' }
}
foreach ($id in $ids) { $null=Invoke-Docker @('rm',$id) }
foreach ($volume in $volumes) { $null=Invoke-Docker @('volume','rm',$volume) }
