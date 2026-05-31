@echo off
set "_DEPLOY_LOG_DIR=%USERPROFILE%\.wheelmaker\log"
set "_DEPLOY_LOG_FILE=%USERPROFILE%\.wheelmaker\log\deploy.bat.log"
if not exist "%_DEPLOY_LOG_DIR%" mkdir "%_DEPLOY_LOG_DIR%" >nul 2>&1
>>"%_DEPLOY_LOG_FILE%" echo [%date% %time%] deploy.bat entered args=%*
if defined WHEELMAKER_DEPLOY_STAY_OPEN goto StableWindowReady
if defined WHEELMAKER_DEPLOY_NO_PAUSE goto StableWindowReady
>>"%_DEPLOY_LOG_FILE%" echo [%date% %time%] opening stable cmd /k window
if not defined WHEELMAKER_DEPLOY_LAUNCH_DRY_RUN goto LaunchStableWindow
echo [INFO] Dry-run stable window command:
echo start "WheelMaker Deploy" "%ComSpec%" /k call "%~f0" %*
exit /b 0

:LaunchStableWindow
set "WHEELMAKER_DEPLOY_STAY_OPEN=1"
start "WheelMaker Deploy" "%ComSpec%" /k call "%~f0" %*
exit /b 0

:StableWindowReady
setlocal EnableExtensions EnableDelayedExpansion
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
if not "%_NEEDS_ADMIN%"=="1" goto AfterAdminCheck

if defined WHEELMAKER_DEPLOY_FORCE_NOT_ADMIN goto RequireAdministrator
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 goto AfterAdminCheck

:RequireAdministrator
echo [INFO] Windows service deployment requires Administrator privileges.
echo [INFO] Relaunching deploy.bat as Administrator...
set "WHEELMAKER_DEPLOY_BAT=%~f0"
set "WHEELMAKER_DEPLOY_ARGS=%_ARGS%"
set "WHEELMAKER_DEPLOY_ELEVATED=1"
if defined WHEELMAKER_DEPLOY_ELEVATE_DRY_RUN (
  echo [INFO] Dry-run administrator relaunch command:
  echo cmd.exe /k call "%~f0" %*
  exit /b 0
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$bat=$env:WHEELMAKER_DEPLOY_BAT; $argLine=$env:WHEELMAKER_DEPLOY_ARGS; $q=[char]34; $cmdLine='/k call ' + $q + $bat + $q; if ($argLine) { $cmdLine += ' ' + $argLine }; $proc=Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdLine -Verb RunAs -Wait -PassThru; exit $proc.ExitCode"
set "_ELEVATE_EXIT=!errorlevel!"
if "!_ELEVATE_EXIT!"=="0" exit /b 0
echo [FAILED] administrator relaunch exited with code !_ELEVATE_EXIT!
if "%_PAUSE_ON_EXIT%"=="1" pause
exit /b !_ELEVATE_EXIT!

:AfterAdminCheck

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
