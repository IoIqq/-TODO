@echo off
chcp 65001 >nul
title 停止服务

echo ========================================
echo   停止飞书 Todo 助手
echo ========================================
echo.

echo 正在停止所有相关进程...

REM 停止服务窗口
taskkill /FI "WINDOWTITLE eq 飞书 Todo 服务*" /F >nul 2>&1
if %errorlevel% equ 0 (
    echo [✓] 已停止服务进程
) else (
    echo [i] 服务进程未运行
)

REM 停止内网穿透窗口
taskkill /FI "WINDOWTITLE eq 内网穿透*" /F >nul 2>&1
if %errorlevel% equ 0 (
    echo [✓] 已停止内网穿透进程
) else (
    echo [i] 内网穿透进程未运行
)

REM 停止可能的 node 进程（端口 3000）
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
    if %errorlevel% equ 0 (
        echo [✓] 已停止端口 3000 上的进程
    )
)

echo.
echo ========================================
echo   所有服务已停止
echo ========================================
echo.

timeout /t 2 /nobreak >nul
