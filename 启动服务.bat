@echo off
chcp 65001 >nul
title 飞书 Todo 服务

echo ========================================
echo   飞书 Todo 服务
echo ========================================
echo.
echo 正在启动服务...
echo.

npm run dev
