@echo off
setlocal
set "KIT_ROOT=%~dp0"
set "KIT_NODE=%KIT_ROOT%runtime\node.exe"
if not exist "%KIT_NODE%" (
  echo Personal Wiki Kit runtime is missing: %KIT_NODE%
  exit /b 1
)
"%KIT_NODE%" "%KIT_ROOT%src\cli.mjs" setup %*
exit /b %ERRORLEVEL%
