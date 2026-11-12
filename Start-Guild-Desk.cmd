@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto missing_node
node -e "if(Number(process.versions.node.split('.')[0]) < 24) process.exit(1)"
if errorlevel 1 goto missing_node
echo Building Guild Desk...
node build.mjs --local
if errorlevel 1 goto failed
node server.mjs
if errorlevel 1 goto failed
exit /b 0
:missing_node
echo Guild Desk requires Node.js 24 or newer. Install Node.js 24 LTS from https://nodejs.org then run this file again.
pause
exit /b 1
:failed
echo.
echo Guild Desk stopped with an error. Read the message above. Your database has not been reset.
pause
exit /b 1
