@echo off
rem Ouvre l'éditeur du portfolio sur ce PC, sans code (utilise la connexion GitHub de « gh »).
cd /d "%~dp0"
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" http://localhost:5330"
node outils\local.mjs 5330
