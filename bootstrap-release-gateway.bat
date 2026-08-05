@echo off
setlocal
node "%~dp0scripts\release-server\bootstrap-gateway.mjs" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
