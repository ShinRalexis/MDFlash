@echo off
rem Compila MDFlash: interfaccia (esbuild) + programma C (clang/MinGW) in build\
rem Uso:  build.cmd            compila
rem       build.cmd installer  compila e crea anche l'installazione (Inno Setup)
setlocal
cd /d "%~dp0"

echo [1/3] Interfaccia...
pushd web
if not exist node_modules (
  call npm install || goto :err
)
call node build.mjs || goto :err
popd

echo [2/3] Programma C...
if not exist build mkdir build
windres -I src src/resource.rc -O coff -o build/resource.o || goto :err
clang -O2 -Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers -Wno-cast-function-type -Wno-unknown-pragmas ^
  -DUNICODE -D_UNICODE -Isdk/webview2 -Isrc ^
  src/main.c src/webview.c src/bridge.c src/menu.c src/native.c src/fsops.c src/util.c src/lang.c src/vendor/cJSON.c build/resource.o ^
  -o build/MDFlash.exe -mwindows -municode -s ^
  -lole32 -loleaut32 -luuid -lshell32 -lshlwapi -lcomctl32 -lcomdlg32 -ldwmapi -luxtheme -lwinhttp -lgdi32 -luser32 -ladvapi32 || goto :err
copy /y sdk\webview2\WebView2Loader.dll build\ >nul

echo [3/3] Fatto: build\MDFlash.exe
if /i "%1"=="installer" (
  set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
  if not exist "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
  call "%%ISCC%%" /Q installer\mdflash.iss || goto :err
  echo Installazione creata in dist\
)
exit /b 0

:err
echo.
echo *** Compilazione non riuscita ***
exit /b 1
