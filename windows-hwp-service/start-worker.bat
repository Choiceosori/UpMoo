@echo off
REM Starts the UpMoo HWP merge worker on Windows login.
REM See windows-hwp-service/README.md ("auto start setup") for details.
REM
REM Edit the two values below for your environment, then save.
set APP_BASE_URL=https://up-moo.vercel.app
set MERGE_SECRET=REPLACE_WITH_YOUR_SECRET

REM Assumes worker.py is in the same folder as this .bat file.
cd /d "%~dp0"
python worker.py

REM If the worker exits unexpectedly (error etc.), keep the window open
REM so the message is visible instead of the window closing immediately.
REM This line is not reached while the worker keeps running normally.
pause
