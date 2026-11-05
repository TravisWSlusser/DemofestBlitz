@echo off
rem  Side-Qlik pre-show. Double-click before the room fills. Edit the two settings below.
rem    SHOWAT : the clock time your talk starts, 24-hour, laptop time   (e.g. 13:00). "+10" = ten minutes from now.
rem    DECK   : your deck. Leave empty to use the only .pptx sitting next to this file.
set SHOWAT=13:00
set DECK=
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" -ShowAt %SHOWAT% -Deck "%DECK%"
if errorlevel 1 pause
