@echo off
setlocal
call "%USERPROFILE%\.personal-wiki\bin\personal-wiki.cmd" open --repository "%~dp0"
exit /b %ERRORLEVEL%
