@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Stop Feishu Todo Bot

echo Stopping Feishu Todo Bot (port 17234)...
echo.

set FOUND=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":17234.*LISTENING"') do (
    echo Killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
    set FOUND=1
)

if "%FOUND%"=="0" (
    echo No process found on port 17234
) else (
    echo Service stopped successfully
)

echo.
pause
