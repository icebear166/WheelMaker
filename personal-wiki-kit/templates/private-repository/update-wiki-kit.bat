@echo off
setlocal
call "%USERPROFILE%\.personal-wiki\bin\personal-wiki.cmd" update --repository "%~dp0"
exit /b %ERRORLEVEL%
