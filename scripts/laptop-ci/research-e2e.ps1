<#
 Galion Research e2e on every mirrored commit (laptop CI, GALION-STUDIO).
 GalionRepoMirror fetches galion-studio/hermes-research into G:\galion\work\repos every 5 min.
 This script looks at every origin branch tip there. Each tip it has not tested yet is run through
   G:\galion\ci\run-ci.ps1 -Repo hermes-research -Branch <branch> -Only ci/e2e-local
 (scratch clone, WSL Node 22, stub Hermes on 127.0.0.1, no paid calls, nothing pushed).
 State:  G:\galion\ci\state\hermes-research-e2e.json   (branch -> last tested sha)
 Log:    G:\galion\logs\ci\hermes-research-e2e.log     (one line per tested commit)
 Usage:
   .\research-e2e.ps1                 # test new tips (first run: main + swarm11/* only, the rest are recorded)
   .\research-e2e.ps1 -Branch main    # test one branch now, even if already tested
   .\research-e2e.ps1 -Register       # add the GalionResearchE2E task (every 5 min, no window)
#>
param([string]$Branch, [switch]$Register, [int]$MaxPerRun = 6)
$ErrorActionPreference = 'Continue'
$env:GIT_TERMINAL_PROMPT = '0'
$G = 'G:\galion'; $Repo = 'hermes-research'
$self = "$G\ci\research-e2e.ps1"

if ($Register) {
  $a = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\conhost.exe" -Argument "--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $self"
  $t = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 5)
  $s = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 60) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName GalionResearchE2E -Action $a -Trigger $t -Settings $s -Description 'Every 5 min: run the Galion Research e2e harness on each new hermes-research commit mirrored into G:\galion\work\repos. Stub LLM only, never pushes.' -Force | Out-Null
  Get-ScheduledTask GalionResearchE2E | Select-Object TaskName, State | Format-List
  exit 0
}

$work = "$G\work\repos\$Repo"
if (-not (Test-Path "$work\.git")) { exit 0 }   # G unplugged or repo not mirrored yet
$stateDir = "$G\ci\state"; New-Item -ItemType Directory -Force $stateDir | Out-Null
$stateFile = "$stateDir\$Repo-e2e.json"
$logDir = "$G\logs\ci"; New-Item -ItemType Directory -Force $logDir | Out-Null
$log = "$logDir\$Repo-e2e.log"
$lock = "$stateDir\$Repo-e2e.lock"
if (Test-Path $lock) {
  $lp = (Get-Content $lock -ErrorAction SilentlyContinue | Select-Object -First 1) -as [int]
  if ($lp -and (Get-Process -Id $lp -ErrorAction SilentlyContinue) -and ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalMinutes -lt 90) { exit 0 }
}
Set-Content $lock $PID
function L($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz') $m" | Add-Content $log }

try {
  $state = @{}
  $first = -not (Test-Path $stateFile)
  if (-not $first) { (Get-Content $stateFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $state[$_.Name] = $_.Value } }

  $tips = [ordered]@{}
  foreach ($line in git -C $work for-each-ref --format='%(refname:strip=3) %(objectname)' refs/remotes/origin) {
    $b, $sha = $line -split ' ', 2
    if ($b -eq 'HEAD') { continue }
    $tips[$b] = $sha
  }

  $todo = @()
  if ($Branch) {
    if (-not $tips.Contains($Branch)) { L "branch $Branch not in the mirror"; Write-Host "branch $Branch not in the mirror"; exit 2 }
    $todo = @($Branch)
  } else {
    foreach ($b in $tips.Keys) {
      if ($state[$b] -eq $tips[$b]) { continue }
      if ($first -and $b -ne 'main' -and $b -notlike 'swarm11/*') { $state[$b] = $tips[$b]; continue }
      $todo += $b
    }
    # main first, then newest work
    $todo = @($todo | Sort-Object { if ($_ -eq 'main') { 0 } else { 1 } })
    if ($todo.Count -gt $MaxPerRun) { $todo = $todo[0..($MaxPerRun - 1)] }   # the rest wait for the next run
  }

  foreach ($b in $todo) {
    $sha = $tips[$b]
    $t0 = Get-Date
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$G\ci\run-ci.ps1" -Repo $Repo -Branch $b -Only 'ci/e2e-local' 2>&1
    $rc = $LASTEXITCODE
    $txt = $out -join "`n"
    $result = if ($rc -eq 0) { 'pass' } else { "fail (exit $rc)" }
    $joblog = ''
    $latest = Get-ChildItem "$G\logs\ci\$Repo" -Directory -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
    if ($latest) {
      $joblog = "$($latest.FullName)\ci_e2e-local.log"
      $body = Get-Content $joblog -Raw -ErrorAction SilentlyContinue
      if ($body -match 'SKIP: no e2e harness') { $result = 'skipped (no harness at this commit)' }
      $sumLine = ($body -split "`n" | Where-Object { $_ -like 'e2e summary:*' } | Select-Object -Last 1)
      if ($sumLine) { $result += " | $($sumLine.Trim())" }
    }
    $secs = [int]((Get-Date) - $t0).TotalSeconds
    L "$b $($sha.Substring(0,8)) $result ${secs}s log=$joblog"
    Write-Host "$b $($sha.Substring(0,8)) $result ${secs}s"
    $state[$b] = $sha
  }
  # forget branches GitHub deleted
  foreach ($k in @($state.Keys)) { if (-not $tips.Contains($k)) { $state.Remove($k) } }
  $state | ConvertTo-Json | Set-Content $stateFile
} finally { Remove-Item $lock -ErrorAction SilentlyContinue }
