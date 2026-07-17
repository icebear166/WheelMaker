@echo off
setlocal
node "%~dp0scripts\release\entry.mjs" publish
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
