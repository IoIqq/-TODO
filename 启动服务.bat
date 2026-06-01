@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Feishu Todo Bot

echo ========================================
echo   Feishu Todo Service
echo ========================================
echo.
echo Starting service...
echo Port: 17234
echo.

npm run dev
pause
