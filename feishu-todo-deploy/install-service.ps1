# 飞书 Todo 机器人 - 安装为 Windows 服务
# 需要管理员权限运行

$serviceName = "FeishuTodoBot"
$displayName = "FeishuTodoBot"
$description = "Feishu Todo Bot Service"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "安装 Windows 服务" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否以管理员身份运行
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[错误] 请以管理员身份运行此脚本" -ForegroundColor Red
    Write-Host "右键点击 PowerShell -> 以管理员身份运行" -ForegroundColor Yellow
    pause
    exit 1
}

# 检查 NSSM 是否已安装
if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Host "未检测到 NSSM，正在下载..." -ForegroundColor Yellow

    $nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
    $nssmZip = "$env:TEMP\nssm.zip"
    $nssmDir = "$env:TEMP\nssm"

    try {
        Invoke-WebRequest -Uri $nssmUrl -OutFile $nssmZip
        Expand-Archive -Path $nssmZip -DestinationPath $nssmDir -Force

        if ([Environment]::Is64BitOperatingSystem) {
            $nssmExe = Get-ChildItem -Path $nssmDir -Filter "nssm.exe" -Recurse | Where-Object { $_.FullName -like "*win64*" } | Select-Object -First 1
        } else {
            $nssmExe = Get-ChildItem -Path $nssmDir -Filter "nssm.exe" -Recurse | Where-Object { $_.FullName -like "*win32*" } | Select-Object -First 1
        }

        Copy-Item -Path $nssmExe.FullName -Destination "C:\Windows\System32\nssm.exe" -Force
        Write-Host "[OK] NSSM 安装完成" -ForegroundColor Green
    } catch {
        Write-Host "[错误] NSSM 下载失败，请手动下载：https://nssm.cc/download" -ForegroundColor Red
        Write-Host "下载后解压，将 nssm.exe 复制到 C:\Windows\System32\" -ForegroundColor Yellow
        pause
        exit 1
    }
}

# 检查服务是否已存在
$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "服务已存在，正在卸载..." -ForegroundColor Yellow
    nssm stop $serviceName
    nssm remove $serviceName confirm
    Start-Sleep -Seconds 2
}

# 安装服务
Write-Host "正在安装服务..." -ForegroundColor Yellow
nssm install $serviceName node "$PSScriptRoot\dist\index.js"
nssm set $serviceName AppDirectory "$PSScriptRoot"
nssm set $serviceName DisplayName "$displayName"
nssm set $serviceName Description "$description"
nssm set $serviceName Start SERVICE_AUTO_START
nssm set $serviceName AppStdout "$PSScriptRoot\logs\stdout.log"
nssm set $serviceName AppStderr "$PSScriptRoot\logs\stderr.log"
nssm set $serviceName AppRotateFiles 1
nssm set $serviceName AppRotateBytes 10485760

# 创建日志目录
New-Item -ItemType Directory -Path "$PSScriptRoot\logs" -Force | Out-Null

# 启动服务
Write-Host "正在启动服务..." -ForegroundColor Yellow
nssm start $serviceName

Start-Sleep -Seconds 3

# 检查服务状态
$service = Get-Service -Name $serviceName
if ($service.Status -eq "Running") {
    Write-Host ""
    Write-Host "[OK] 服务安装并启动成功！" -ForegroundColor Green
    Write-Host ""
    Write-Host "服务名称：$serviceName" -ForegroundColor Cyan
    Write-Host "服务状态：运行中" -ForegroundColor Green
    Write-Host ""
    Write-Host "管理命令：" -ForegroundColor Yellow
    Write-Host "  查看状态：Get-Service $serviceName" -ForegroundColor Gray
    Write-Host "  停止服务：Stop-Service $serviceName" -ForegroundColor Gray
    Write-Host "  启动服务：Start-Service $serviceName" -ForegroundColor Gray
    Write-Host "  重启服务：Restart-Service $serviceName" -ForegroundColor Gray
    Write-Host "  查看日志：Get-Content logs\stdout.log -Tail 50" -ForegroundColor Gray
} else {
    Write-Host "[错误] 服务启动失败，请检查日志：logs\stderr.log" -ForegroundColor Red
}

Write-Host ""
pause
