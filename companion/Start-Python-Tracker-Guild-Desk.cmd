@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 goto try_python
py -3 -c "import sys, tkinter; assert sys.version_info.__ge__((3, 8))" >nul 2>nul
if errorlevel 1 goto try_python
py -3 "%~dp0guild_desk_export.py" %*
set "GUILD_DESK_PYTHON_EXIT=%errorlevel%"
if not "%GUILD_DESK_PYTHON_EXIT%"=="0" pause
exit /b %GUILD_DESK_PYTHON_EXIT%
:try_python
where python >nul 2>nul
if errorlevel 1 goto no_python
python -c "import sys, tkinter; assert sys.version_info.__ge__((3, 8))" >nul 2>nul
if errorlevel 1 goto no_python
python "%~dp0guild_desk_export.py" %*
set "GUILD_DESK_PYTHON_EXIT=%errorlevel%"
if not "%GUILD_DESK_PYTHON_EXIT%"=="0" pause
exit /b %GUILD_DESK_PYTHON_EXIT%
:no_python
echo Python 3.8 or newer with Tkinter is required.
echo Install Python from python.org with the launcher and Tcl/Tk enabled, then run this file again.
pause
exit /b 1
