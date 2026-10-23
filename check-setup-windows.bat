@echo off
title MBS setup check
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download it from https://nodejs.org then run this again. & pause & exit /b)
node --env-file=.env tools\check-setup.mjs
pause
