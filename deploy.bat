@echo off
setlocal
title WheelMaker Deploy

set "_REPO=%~dp0"
if "%_REPO:~-1%"=="\" set "_REPO=%_REPO:~0,-1%"
set "_BOOTSTRAP_DIR=%USERPROFILE%\.wheelmaker\build\bootstrap"
set "_DEPLOY_EXE=%_BOOTSTRAP_DIR%\wheelmaker-deploy.exe"
set "_ARGS=%*"
set "_PAUSE_ON_EXIT=1"
if defined WHEELMAKER_DEPLOY_NO_PAUSE set "_PAUSE_ON_EXIT=0"

echo ============================================
echo   WheelMaker All-in-One Deploy
echo ============================================
echo.
echo   wheelmaker-deploy deploy: update + build + install + configure + publish web
echo.
echo ============================================
echo.

set "_NEEDS_ADMIN=1"
if not "%_ARGS:--no-config=%"=="%_ARGS%" set "_NEEDS_ADMIN=0"
if "%_NEEDS_ADMIN%"=="1" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }" >nul 2>&1
  if errorlevel 1 (
    echo [INFO] Windows service deployment requires Administrator privileges.
    echo [INFO] Relaunching deploy.bat as Administrator...
    set "WHEELMAKER_DEPLOY_BAT=%~f0"
    set "WHEELMAKER_DEPLOY_ARGS=%_ARGS%"
    set "WHEELMAKER_DEPLOY_ELEVATED=1"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$bat=$env:WHEELMAKER_DEPLOY_BAT; $argLine=$env:WHEELMAKER_DEPLOY_ARGS; $proc=Start-Process -FilePath $bat -ArgumentList $argLine -Verb RunAs -Wait -PassThru; exit $proc.ExitCode"
    set "_ELEVATE_EXIT=%errorlevel%"
    if not "%_ELEVATE_EXIT%"=="0" (
      echo [FAILED] administrator relaunch exited with code %_ELEVATE_EXIT%
      if "%_PAUSE_ON_EXIT%"=="1" pause
    )
    exit /b %_ELEVATE_EXIT%
  )
)

echo [INFO] Building bootstrap wheelmaker-deploy.exe...
where go >nul 2>&1
if errorlevel 1 (
  echo [FAILED] Go is required to build wheelmaker-deploy.exe
  if "%_PAUSE_ON_EXIT%"=="1" pause
  exit /b 1
)
if not exist "%_BOOTSTRAP_DIR%" mkdir "%_BOOTSTRAP_DIR%"
pushd "%_REPO%\server"
go build -o "%_DEPLOY_EXE%" .\cmd\wheelmaker-deploy
set "_BUILD_EXIT=%errorlevel%"
popd
if not "%_BUILD_EXIT%"=="0" (
  echo [FAILED] go build wheelmaker-deploy.exe exited with code %_BUILD_EXIT%
  if "%_PAUSE_ON_EXIT%"=="1" pause
  exit /b %_BUILD_EXIT%
)

echo [INFO] Running wheelmaker-deploy deploy...
echo [INFO] Bootstrap CLI: "%_DEPLOY_EXE%"
"%_DEPLOY_EXE%" deploy --repo "%_REPO%" %*
set "_EXIT=%errorlevel%"
if not "%_EXIT%"=="0" (
  echo.
  echo [FAILED] deploy exited with code %_EXIT%
  if "%_PAUSE_ON_EXIT%"=="1" pause
  exit /b %_EXIT%
)

echo.
echo [OK] deploy complete
if "%_PAUSE_ON_EXIT%"=="1" pause
exit /b 0
