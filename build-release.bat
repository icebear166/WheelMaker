@echo off
setlocal
node "%~dp0scripts\release\entry.mjs" build
exit /b %ERRORLEVEL%
