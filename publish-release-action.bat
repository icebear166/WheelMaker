@echo off
setlocal
node "%~dp0scripts\release\entry.mjs" action
exit /b %ERRORLEVEL%
