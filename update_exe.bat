@echo off
setlocal
where node >nul 2>&1
if errorlevel 1 (
  echo [FAILED] Node.js 22 or newer is required.
  exit /b 1
)
if not exist "%USERPROFILE%\.wheelmaker\deploy.mjs" (
  echo [FAILED] WheelMaker deploy launcher is not installed.
  exit /b 1
)
node "%USERPROFILE%\.wheelmaker\deploy.mjs" desktop-update
exit /b %errorlevel%
