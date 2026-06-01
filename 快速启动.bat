@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Feishu Todo Bot

REM Auto-clean port 17234 (kill any leftover process)
echo Checking port 17234...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":17234.*LISTENING"') do (
    echo Killing leftover process PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo Starting Feishu Todo Bot on port 17234...
echo.

npm run dev
