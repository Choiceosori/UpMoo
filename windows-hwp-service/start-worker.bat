@echo off
REM HWP 병합 워커를 Windows 로그인 시 자동으로 실행하기 위한 스크립트입니다.
REM 사용법은 windows-hwp-service/README.md의 "자동 실행 설정"을 참고하세요.
REM
REM 아래 두 값을 본인 환경에 맞게 수정한 뒤 저장하세요.
set APP_BASE_URL=https://up-moo.vercel.app
set MERGE_SECRET=여기에_비밀값_입력

REM worker.py가 이 bat 파일과 같은 폴더에 있다고 가정합니다.
cd /d "%~dp0"
python worker.py

REM 워커가 예기치 않게 종료되면(에러 등) 창이 바로 닫히지 않고 메시지를
REM 볼 수 있도록 대기합니다. 정상적으로 계속 실행 중일 때는 이 줄까지
REM 오지 않습니다.
pause
