@echo off
setlocal
cd /d "%~dp0.."
node companion\legacy-start.mjs
pause
