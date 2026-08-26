@echo off
chcp 65001 >nul 2>&1
title LIFE GAME
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\server.ps1"

if errorlevel 1 (
  echo.
  echo  Server could not start. Opening standalone.html instead.
  start "" "%~dp0standalone.html"
  echo.
  pause
)
