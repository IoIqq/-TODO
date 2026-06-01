@echo off
chcp 65001 >nul
title 测试连接

echo ========================================
echo   测试本地服务连接
echo ========================================
echo.

echo [1/3] 测试 localhost:8888...
curl http://localhost:8888/health
echo.
echo.

echo [2/3] 测试 127.0.0.1:8888...
curl http://127.0.0.1:8888/health
echo.
echo.

echo [3/3] 检查端口占用...
netstat -ano | findstr :8888
echo.

echo ========================================
echo   测试完成
echo ========================================
pause
