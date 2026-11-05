@echo off
rem  Side-Qlik pre-show. Double-click before the room fills. Edit the two settings below.
rem    SHOWAT : the clock time your talk starts, 24-hour, laptop time   (e.g. 13:00). "+10" = ten minutes from now.
rem    DECK   : full path to your deck. Leave empty to use the only .pptx sitting next to this file.
set SHOWAT=13:00
set DECK=
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launch.ps1" -ShowAt %SHOWAT% -Deck "%DECK%"
