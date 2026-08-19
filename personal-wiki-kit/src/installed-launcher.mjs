import path from 'node:path';

export function renderInstalledLauncher(configDirectory) {
  const home = path.resolve(configDirectory)
    .replaceAll('/', '\\')
    .replaceAll('%', '%%')
    .replaceAll('"', '""');
  return `@echo off\r\nsetlocal\r\nset "PERSONAL_WIKI_HOME=${home}"\r\nset "PERSONAL_WIKI_ACTIVE=%PERSONAL_WIKI_HOME%\\kit\\active-version.txt"\r\nif not exist "%PERSONAL_WIKI_ACTIVE%" (\r\n  echo Personal Wiki Kit active version is missing.\r\n  exit /b 1\r\n)\r\nset /p PERSONAL_WIKI_VERSION=<"%PERSONAL_WIKI_ACTIVE%"\r\nset "PERSONAL_WIKI_KIT=%PERSONAL_WIKI_HOME%\\kit\\versions\\%PERSONAL_WIKI_VERSION%"\r\nif not exist "%PERSONAL_WIKI_KIT%\\runtime\\node.exe" (\r\n  echo Personal Wiki Kit runtime is missing for %PERSONAL_WIKI_VERSION%.\r\n  exit /b 1\r\n)\r\n"%PERSONAL_WIKI_KIT%\\runtime\\node.exe" "%PERSONAL_WIKI_KIT%\\src\\cli.mjs" %*\r\nexit /b %ERRORLEVEL%\r\n`;
}
