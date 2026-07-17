@echo off
setlocal
node "%~dp0scripts\release-server\deploy.mjs"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
