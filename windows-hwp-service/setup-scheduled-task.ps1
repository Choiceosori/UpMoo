# Registers the UpMoo HWP merge worker in Windows Task Scheduler.
# More reliable than just running start-worker.bat by hand -- the worker
# restarts automatically if it dies, and you don't need to double-click it
# after every login.
#
# Usage (open PowerShell "as Administrator"):
#   cd <folder containing this script>
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\setup-scheduled-task.ps1
#
# Default mode is "start automatically at logon" (recommended, works
# reliably). For "fully unattended, no login required":
#   .\setup-scheduled-task.ps1 -Unattended
# Note: due to Windows Session 0 isolation, GUI automation programs like
# Hangul/HWP may not work correctly in a no-login session -- test it
# yourself, and fall back to the default (logon) mode if it doesn't work
# (see "Unregister" below).

param(
    [switch]$Unattended
)

$ErrorActionPreference = "Stop"
$taskName = "UpMoo HWP Merge Worker"
$workerDir = $PSScriptRoot
$batPath = Join-Path $workerDir "start-worker.bat"
$pyPath = Join-Path $workerDir "worker.py"

if (-not (Test-Path $pyPath)) {
    Write-Error "worker.py not found: $pyPath (this script and worker.py must be in the same folder)"
    exit 1
}

# Remove any existing task with the same name first (so re-running this script re-registers cleanly)
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

if ($Unattended) {
    if (-not (Test-Path $batPath)) {
        Write-Error "start-worker.bat not found: $batPath (needed to read APP_BASE_URL/MERGE_SECRET)"
        exit 1
    }
    $content = Get-Content $batPath -Raw
    $appBaseUrl = [regex]::Match($content, "set APP_BASE_URL=(.+)").Groups[1].Value.Trim()
    $mergeSecret = [regex]::Match($content, "set MERGE_SECRET=(.+)").Groups[1].Value.Trim()
    if (-not $appBaseUrl -or -not $mergeSecret -or $mergeSecret -eq "REPLACE_WITH_YOUR_SECRET") {
        Write-Error "Could not read APP_BASE_URL/MERGE_SECRET from start-worker.bat. Open start-worker.bat first and fill in the values."
        exit 1
    }

    # Under the SYSTEM account / non-interactive session, run python.exe
    # directly (avoids the .bat's `pause` hanging forever with no one to
    # press a key). Environment variables need to be set as the task's own
    # environment rather than passed as command-line args, so they are set
    # via cmd.exe's `set` command. This mode has no visible window, so logs
    # go to worker.log -- check that file if something isn't working.
    $logPath = Join-Path $workerDir "worker.log"
    $pythonPath = (Get-Command python).Source
    $cmdArgs = "/c set APP_BASE_URL=$appBaseUrl&& set MERGE_SECRET=$mergeSecret&& `"$pythonPath`" -u `"$pyPath`" >> `"$logPath`" 2>&1"
    $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $cmdArgs -WorkingDirectory $workerDir
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings `
        -Description "UpMoo HWP merge polling worker (unattended mode, Session 0)" | Out-Null

    Write-Host "Registered (unattended mode): $taskName"
    Write-Host "Warning: due to Windows Session 0 isolation, the Hangul program may not work correctly in this mode."
    Write-Host "Logs are written here (no visible window, so check this file): $logPath"
    Write-Host "To test right now: Start-ScheduledTask -TaskName `"$taskName`""
    Write-Host "Wait a few seconds, try 'HWP merge download' in the app, and check worker.log. If it doesn't work, re-register in logon mode:"
    Write-Host "  .\setup-scheduled-task.ps1"
} else {
    $action = New-ScheduledTaskAction -Execute $batPath -WorkingDirectory $workerDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings `
        -Description "UpMoo HWP merge polling worker (starts at logon)" | Out-Null

    Write-Host "Registered (starts at logon + auto-restart): $taskName"
    Write-Host "To test right now: Start-ScheduledTask -TaskName `"$taskName`""
}

Write-Host ""
Write-Host "You can view/delete the registered task by opening 'Task Scheduler' from Windows search."
Write-Host "To delete: Unregister-ScheduledTask -TaskName `"$taskName`" -Confirm:`$false"
