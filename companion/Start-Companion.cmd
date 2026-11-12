@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 (
 echo Node.js24 or later is required. Install Node.js, then open this launcher again.
 pause
 exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) < 24) process.exit(1)"
if errorlevel 1 (
 echo This companion requires Node.js24 or later. Update Node.js and reopen this launcher.
 pause
 exit /b 1
)
powershell.exe -NoProfile -NonInteractive -Command "Start-Process -FilePath (Get-Command node).Source -ArgumentList @('companion/start.mjs') -WorkingDirectory (Get-Location).Path -WindowStyle Hidden"
exit /b
