@echo off
rem Runs the Pontypool print agent and restarts it if it ever stops.
rem Optional: set PRINTER_NAME here (exact Windows printer name) if the receipt printer is not the default.
rem set PRINTER_NAME=XP-80C
cd /d "%~dp0.."
:loop
node scripts\print-agent.mjs
timeout /t 3 /nobreak >nul
goto loop
