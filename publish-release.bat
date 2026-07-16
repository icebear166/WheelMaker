@echo off
setlocal
node "%~dp0scripts\release\entry.mjs" publish
exit /b %ERRORLEVEL%
