@echo off
REM PontyPool Till - double-click this on the shop PC.
REM Starts the silent print agent (no QZ Tray needed). Keep this window open.
REM 1) Save B&W logo as assets\pontypool-logo-bw.png
REM 2) Set your printer below, or leave PRINTER_TARGET=file to test first.
set PRINTER_TARGET=windows
REM set PRINTER_NAME=XPrinter XP-80C
set PRINT_AGENT_PORT=5501
node scripts\print-agent.mjs
pause
