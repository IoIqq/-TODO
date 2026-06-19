@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Feishu Todo Bot - Launcher

set PORT=17234
set CLOUDFLARED=D:\cloud\cloudflared-windows-amd64.exe
set TUNNEL_LOG=%~dp0logs\cloudflared.log

if not exist "%~dp0logs" mkdir "%~dp0logs"

echo ============================================================
echo   Feishu Todo Bot - One-Click Launcher
echo ============================================================
echo.

REM 1) Kill leftover node on PORT
echo [1/4] Cleaning port %PORT%...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%.*LISTENING"') do (
    echo       Killing leftover Node PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

REM 2) Kill leftover cloudflared
echo [2/4] Cleaning old cloudflared processes...
taskkill /F /IM cloudflared-windows-amd64.exe >nul 2>&1
taskkill /F /IM cloudflared.exe >nul 2>&1

timeout /t 1 /nobreak >nul

REM 3) Start Node service in a new window
echo [3/4] Starting Node service in new window...
start "Feishu Todo Node" cmd /k "cd /d %~dp0 && npm run dev"

REM Give node a moment to bind port
timeout /t 3 /nobreak >nul

REM 4) Start cloudflared in a new window, redirect log
echo [4/4] Starting Cloudflare Tunnel in new window...
if not exist "%CLOUDFLARED%" (
    echo.
    echo ERROR: cloudflared not found at %CLOUDFLARED%
    echo Please update CLOUDFLARED path in this script.
    pause
    exit /b 1
)
start "Cloudflared Tunnel" cmd /k "%CLOUDFLARED% tunnel --url http://127.0.0.1:%PORT% --logfile %TUNNEL_LOG% 2^>^&1"

echo.
echo Waiting for tunnel URL (up to 30s)...
echo.

REM Poll the log for the trycloudflare URL
set FOUND_URL=
for /l %%i in (1,1,30) do (
    timeout /t 1 /nobreak >nul
    if exist "%TUNNEL_LOG%" (
        for /f "tokens=*" %%L in ('findstr /R "https://[a-zA-Z0-9-]*\.trycloudflare\.com" "%TUNNEL_LOG%" 2^>nul') do (
            set "FOUND_URL=%%L"
            goto :found
        )
    )
)

:found
echo.
echo ============================================================
if defined FOUND_URL (
    echo   Tunnel READY
    echo ============================================================
    echo.
    echo Tunnel log line:
    echo   %FOUND_URL%
    echo.
    echo Quick check:
    echo   1. Health check ^(should return 'ok'^):
    echo      Open the URL above in browser, append /health
    echo.
    echo   2. Diagnostic page ^(JSON response^):
    echo      Same URL with /admin/diag
    echo.
    echo   3. Update Feishu callback URL to:
    echo      ^<tunnel-url^>/feishu/events
    echo.
    echo Local endpoints:
    echo   http://localhost:%PORT%/health
    echo   http://localhost:%PORT%/admin/diag
) else (
    echo   Tunnel URL not detected in 30s
    echo ============================================================
    echo.
    echo Check the Cloudflared Tunnel window manually for the URL.
    echo Log file: %TUNNEL_LOG%
)
echo ============================================================
echo.
echo Press any key to close this launcher window
echo ^(Node and Cloudflared windows will keep running^)
pause >nul
