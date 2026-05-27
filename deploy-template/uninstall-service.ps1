# 飞书 Todo 机器人 - 卸载 Windows 服务
# 需要管理员权限运行

$serviceName = "FeishuTodoBot"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "卸载 Windows 服务" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否以管理员身份运行
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[错误] 请以管理员身份运行此脚本" -ForegroundColor Red
    pause
    exit 1
}

# 检查服务是否存在
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Host "服务不存在，无需卸载" -ForegroundColor Yellow
    pause
    exit 0
}

# 停止并卸载服务
Write-Host "正在停止服务..." -ForegroundColor Yellow
nssm stop $serviceName

Write-Host "正在卸载服务..." -ForegroundColor Yellow
nssm remove $serviceName confirm

Write-Host ""
Write-Host "[OK] 服务卸载完成" -ForegroundColor Green
Write-Host ""
pause
