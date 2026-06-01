@echo off
chcp 65001 >nul
title 飞书 Todo 助手

echo ========================================
echo   飞书 Todo 智能助手
echo ========================================
echo.

REM 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未安装 Node.js
    echo 请访问 https://nodejs.org/ 下载安装
    pause
    exit /b 1
)

REM 检查 .env
if not exist ".env" (
    echo [错误] 缺少 .env 配置文件
    echo 正在从 .env.example 复制...
    copy .env.example .env
    echo.
    echo [提示] 请编辑 .env 文件，填写飞书应用凭据
    echo 然后重新运行此脚本
    notepad .env
    pause
    exit /b 1
)

REM 安装依赖
if not exist "node_modules" (
    echo [1/4] 安装依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
)

REM 编译代码
echo [2/4] 编译代码...
call npm run build
if %errorlevel% neq 0 (
    echo [错误] 编译失败
    pause
    exit /b 1
)

REM 启动服务
echo [3/4] 启动服务...
echo.

REM 启动服务窗口
start "" "%~dp0启动服务.bat"

REM 等待服务启动并检查健康状态
echo 等待服务启动（需要约10秒）...
timeout /t 10 /nobreak >nul

REM 检查服务是否正常运行
echo 正在检查服务健康状态...
curl -s http://localhost:8888/health >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo   服务启动成功！
    echo ========================================
    echo   本地地址: http://localhost:8888
    echo   健康检查: http://localhost:8888/health [通过]
    echo   回调地址: http://localhost:8888/feishu/events
    echo.
    echo   端口信息: 8888
    echo   服务窗口: 已打开（标题：飞书 Todo 服务）
    echo ========================================
    echo.
) else (
    echo.
    echo ========================================
    echo   警告：服务可能未正常启动
    echo ========================================
    echo   可能原因：
    echo   1. 端口 8888 被占用
    echo   2. 服务启动时间较长（超过10秒）
    echo   3. 配置文件错误
    echo.
    echo   请查看"飞书 Todo 服务"窗口的错误信息
    echo   或运行"测试连接.bat"检查端口状态
    echo ========================================
    echo.
)

echo [4/4] 启动内网穿透...
echo.

REM 检查是否有 cloudflared
if exist "D:\cloud\cloudflared-windows-amd64.exe" (
    start "内网穿透" cmd /k "D:\cloud\cloudflared-windows-amd64.exe tunnel --url http://127.0.0.1:8888"
    echo.
    echo ========================================
    echo   内网穿透已启动
    echo   请查看"内网穿透"窗口获取公网地址
    echo   格式: https://xxx.trycloudflare.com
    echo ========================================
) else (
    echo [提示] 未找到 cloudflared
    echo 请手动启动内网穿透工具
    echo.
    echo 推荐使用 Cloudflare Tunnel:
    echo 下载: https://github.com/cloudflare/cloudflared/releases
)

echo.
echo ========================================
echo   下一步操作：
echo   1. 复制内网穿透的公网地址
echo   2. 访问 https://open.feishu.cn/
echo   3. 配置事件订阅地址:
echo      https://你的地址/feishu/events
echo   4. 配置卡片回调地址:
echo      https://你的地址/feishu/events
echo ========================================
echo.
echo 按任意键关闭此窗口（服务将继续运行）...
pause >nul
