@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Feishu Todo Bot Launcher

echo ========================================
echo   Feishu Todo Smart Assistant
echo ========================================
echo.

REM Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not installed
    echo Please install from https://nodejs.org/
    pause
    exit /b 1
)

REM Check .env
if not exist ".env" (
    echo [ERROR] .env file missing
    echo Copying from .env.example...
    if exist ".env.example" (
        copy .env.example .env
        echo.
        echo [INFO] Please edit .env with your Feishu credentials
        echo Then run this script again
        notepad .env
    ) else (
        echo [ERROR] .env.example also missing
    )
    pause
    exit /b 1
)

REM Install dependencies
if not exist "node_modules" (
    echo [1/4] Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
)

REM Build
echo [2/4] Building...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Build failed
    pause
    exit /b 1
)

REM Start service
echo [3/4] Starting service on port 17234...
echo.

start "" "%~dp0启动服务.bat"

REM Wait for service
echo Waiting for service to start (about 10 seconds)...
timeout /t 10 /nobreak >nul

REM Health check
echo Checking service health...
curl -s http://localhost:17234/health >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo   Service started successfully!
    echo ========================================
    echo   Local URL: http://localhost:17234
    echo   Health:    http://localhost:17234/health [OK]
    echo   Callback:  http://localhost:17234/feishu/events
    echo.
    echo   Port: 17234
    echo ========================================
    echo.
) else (
    echo.
    echo ========================================
    echo   WARNING: Service may not have started
    echo ========================================
    echo   Possible causes:
    echo   1. Port 17234 in use
    echo   2. Service taking longer than 10s
    echo   3. Configuration error
    echo.
    echo   Check the service window for errors
    echo ========================================
    echo.
)

echo [4/4] Starting tunnel...
echo.

REM Cloudflared tunnel
if exist "D:\cloud\cloudflared-windows-amd64.exe" (
    start "Cloudflare Tunnel" cmd /k "D:\cloud\cloudflared-windows-amd64.exe tunnel --url http://127.0.0.1:17234"
    echo.
    echo ========================================
    echo   Tunnel started
    echo   Check the Tunnel window for public URL
    echo   Format: https://xxx.trycloudflare.com
    echo ========================================
) else (
    echo [INFO] cloudflared not found
    echo Please start tunnel manually
    echo.
    echo Recommended: Cloudflare Tunnel
    echo Download: https://github.com/cloudflare/cloudflared/releases
)

echo.
echo ========================================
echo   Next steps:
echo   1. Copy the public URL from tunnel window
echo   2. Visit https://open.feishu.cn/
echo   3. Set Event Subscription URL:
echo      https://YOUR_URL/feishu/events
echo   4. Set Card Callback URL:
echo      https://YOUR_URL/feishu/events
echo ========================================
echo.
echo Press any key to close (service keeps running)...
pause >nul
