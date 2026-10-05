@echo off
REM Double-cliquez sur ce fichier pour lancer le site (Node.js doit etre installe : https://nodejs.org).
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000/admin"
node server/index.js
pause
