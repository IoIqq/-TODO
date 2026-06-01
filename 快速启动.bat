@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Feishu Todo Bot

echo Starting Feishu Todo Bot on port 17234...
echo.

npm run dev
