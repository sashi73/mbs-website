@echo off
setlocal
title MBS website
rem ===========================================================================
rem  Starts the MBS website on this computer: http://localhost:8888
rem  - Works from the site folder, or from a copy on your Desktop: a copy finds
rem    the site folder by itself and uses the .env that is in the site folder.
rem  - Stops any MBS server that is already running (for example an older copy
rem    in another folder), so the browser always shows THIS folder's files.
rem ===========================================================================

rem 1. Find the site folder (the one with local-server.mjs and your .env)
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "SITE="
if exist "%HERE%\local-server.mjs" set "SITE=%HERE%"
rem    a copy on the Desktop: use the site folder remembered from the last start
if not defined SITE if exist "%LOCALAPPDATA%\MBS\site-folder.txt" set /p SITE=<"%LOCALAPPDATA%\MBS\site-folder.txt"
if defined SITE if not exist "%SITE%\local-server.mjs" set "SITE="
if defined SITE goto found
echo Looking for the MBS site folder...
for %%R in ("%USERPROFILE%\Desktop" "%USERPROFILE%\Documents" "%USERPROFILE%\Downloads" "%USERPROFILE%\OneDrive" "C:\workzone") do (
    if exist "%%~R" (
        for /f "delims=" %%F in ('dir /s /b "%%~R\local-server.mjs" 2^>nul') do (
            set "SITE=%%~dpF"
            goto found
        )
    )
)
echo.
echo Could not find the MBS site folder (the folder with local-server.mjs).
echo Run start-windows.bat once from inside the site folder. After that, a copy
echo on your Desktop will find it by itself.
pause
exit /b 1

:found
if "%SITE:~-1%"=="\" set "SITE=%SITE:~0,-1%"
cd /d "%SITE%"
if not exist "%LOCALAPPDATA%\MBS" md "%LOCALAPPDATA%\MBS"
>"%LOCALAPPDATA%\MBS\site-folder.txt" echo %SITE%
echo Site folder: %SITE%

where node >nul 2>nul || (echo Node.js is not installed. Download it from https://nodejs.org then run this again. & pause & exit /b 1)
if not exist .env (copy .env.example .env >nul & echo Created .env in %SITE%. Add your keys in Notepad, save, then run this again. & notepad .env & exit /b)

rem 2. Stop any MBS server that is already running (an older copy would keep showing old pages)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*local-server.mjs*' } | ForEach-Object { Write-Host ('Stopping an MBS server that was already running (process ' + $_.ProcessId + ')'); Stop-Process -Id $_.ProcessId -Force }"

rem 3. Start this folder's server and open the browser
set PORT=8888
for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="PORT" set PORT=%%b
start "" cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"
node --env-file=.env local-server.mjs
pause
