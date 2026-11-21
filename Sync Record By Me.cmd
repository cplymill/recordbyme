@echo off
setlocal
cd /d "%~dp0"
node scripts/sync-github.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
pause
