# UpMoo HWP 병합 워커를 Windows 작업 스케줄러에 등록합니다.
# start-worker.bat 하나만 수동으로 띄워두는 것보다 안정적입니다 — 워커가
# 죽어도 자동으로 다시 시작해주고, 매번 로그인 후 직접 더블클릭할 필요가
# 없습니다.
#
# 사용법 (PowerShell을 "관리자 권한으로 실행"으로 연 뒤):
#   cd <이 스크립트가 있는 폴더>
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\setup-scheduled-task.ps1
#
# 기본값은 "로그인 시 자동 시작" 모드입니다(권장, 거의 확실히 동작).
# "로그인 없이도 완전 무인 실행"을 원하면:
#   .\setup-scheduled-task.ps1 -Unattended
# 단, Windows의 Session 0 격리 때문에 한글 같은 GUI 자동화 프로그램이
# 로그인 없는 세션에서는 정상 동작하지 않을 수 있습니다 — 직접 테스트해보고
# 안 되면 기본 모드(로그인 시 시작)로 되돌리세요(아래 "제거" 참고).

param(
    [switch]$Unattended
)

$ErrorActionPreference = "Stop"
$taskName = "UpMoo HWP Merge Worker"
$workerDir = $PSScriptRoot
$batPath = Join-Path $workerDir "start-worker.bat"
$pyPath = Join-Path $workerDir "worker.py"

if (-not (Test-Path $pyPath)) {
    Write-Error "worker.py를 찾을 수 없습니다: $pyPath (이 스크립트와 worker.py가 같은 폴더에 있어야 합니다)"
    exit 1
}

# 기존에 같은 이름의 작업이 있으면 먼저 제거(재등록을 위해)
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
        Write-Error "start-worker.bat을 찾을 수 없습니다: $batPath (APP_BASE_URL/MERGE_SECRET 값을 읽어오기 위해 필요합니다)"
        exit 1
    }
    $content = Get-Content $batPath -Raw
    $appBaseUrl = [regex]::Match($content, "set APP_BASE_URL=(.+)").Groups[1].Value.Trim()
    $mergeSecret = [regex]::Match($content, "set MERGE_SECRET=(.+)").Groups[1].Value.Trim()
    if (-not $appBaseUrl -or -not $mergeSecret -or $mergeSecret -eq "여기에_비밀값_입력") {
        Write-Error "start-worker.bat에서 APP_BASE_URL/MERGE_SECRET 값을 읽지 못했습니다. 먼저 start-worker.bat을 열어 값을 채워주세요."
        exit 1
    }

    # SYSTEM 계정/비대화형 세션에서는 python.exe를 직접 실행합니다(.bat의
    # pause가 아무도 없는 세션에서 영원히 멈춰있게 되는 걸 피하기 위함).
    # 환경변수는 커맨드라인 인자가 아니라 작업 자체의 환경으로 심어야 하므로,
    # cmd.exe의 set 명령을 통해 전달합니다. 이 모드는 보이는 창이 없어서
    # 로그를 worker.log 파일로 남깁니다 — 문제가 있으면 이 파일을 확인하세요.
    $logPath = Join-Path $workerDir "worker.log"
    $pythonPath = (Get-Command python).Source
    $cmdArgs = "/c set APP_BASE_URL=$appBaseUrl&& set MERGE_SECRET=$mergeSecret&& `"$pythonPath`" -u `"$pyPath`" >> `"$logPath`" 2>&1"
    $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $cmdArgs -WorkingDirectory $workerDir
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings `
        -Description "UpMoo HWP 병합 폴링 워커 (무인 모드, Session 0)" | Out-Null

    Write-Host "등록 완료 (무인 모드): $taskName"
    Write-Host "경고: Windows Session 0 격리 때문에 한글 프로그램이 이 모드에서 정상 동작하지 않을 수 있습니다."
    Write-Host "로그는 다음 파일에 쌓입니다(보이는 창이 없으므로 여기서 확인하세요): $logPath"
    Write-Host "지금 바로 테스트하려면: Start-ScheduledTask -TaskName `"$taskName`""
    Write-Host "몇 초 뒤 앱에서 HWP 통합 다운로드를 눌러보고 worker.log를 확인하세요. 안 되면 아래 '로그인 시 시작' 모드로 다시 등록하세요:"
    Write-Host "  .\setup-scheduled-task.ps1"
} else {
    $action = New-ScheduledTaskAction -Execute $batPath -WorkingDirectory $workerDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings `
        -Description "UpMoo HWP 병합 폴링 워커 (로그인 시 시작)" | Out-Null

    Write-Host "등록 완료 (로그인 시 시작 + 자동 재시작): $taskName"
    Write-Host "지금 바로 테스트하려면: Start-ScheduledTask -TaskName `"$taskName`""
}

Write-Host ""
Write-Host "등록된 작업은 Windows 검색에서 '작업 스케줄러'를 열어 확인/삭제할 수 있습니다."
Write-Host "삭제하려면: Unregister-ScheduledTask -TaskName `"$taskName`" -Confirm:`$false"
