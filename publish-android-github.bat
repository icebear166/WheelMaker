@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish_android_github_release.ps1" %*
exit /b %ERRORLEVEL%
