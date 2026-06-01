# Feishu Todo Bot - Uninstall Windows Service
# Requires Administrator privileges

$serviceName = "FeishuTodoBot"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Uninstall Windows Service" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check Administrator privileges
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[ERROR] Please run this script as Administrator" -ForegroundColor Red
    pause
    exit 1
}

# Check if service exists
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Host "Service does not exist, nothing to uninstall" -ForegroundColor Yellow
    pause
    exit 0
}

# Stop and remove service
Write-Host "Stopping service..." -ForegroundColor Yellow
nssm stop $serviceName

Write-Host "Removing service..." -ForegroundColor Yellow
nssm remove $serviceName confirm

Write-Host ""
Write-Host "[OK] Service uninstalled" -ForegroundColor Green
Write-Host ""
pause
