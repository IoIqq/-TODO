@echo off
chcp 65001 >nul
title Feishu Todo Bot - Stopper

set PORT=17234

echo ============================================================
echo   Stopping Feishu Todo Bot
echo ============================================================
echo.

echo [1/2] Killing Node process on port %PORT%...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%.*LISTENING"') do (
    echo       Killing Node PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo [2/2] Killing cloudflared processes...
taskkill /F /IM cloudflared-windows-amd64.exe >nul 2>&1
taskkill /F /IM cloudflared.exe >nul 2>&1

echo.
echo Done. Press any key to exit.
pause >nul
