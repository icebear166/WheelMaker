@echo off
setlocal
call "%USERPROFILE%\.personal-wiki\bin\personal-wiki.cmd" publish --repository "%~dp0"
exit /b %ERRORLEVEL%
