# Build Windows ECS Deploy Package
# 用途：将本项目打包为可上传到 Windows Server 部署的 ZIP

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Build Windows ECS Deploy Package" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. 编译 TypeScript
Write-Host "`n[1/4] Building TypeScript..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] TypeScript compiled" -ForegroundColor Green

# 2. 准备目录
$deployDir = "feishu-todo-deploy"
if (Test-Path $deployDir) {
    Remove-Item -Recurse -Force $deployDir
}
New-Item -ItemType Directory -Path $deployDir | O  -Destination $deployDir
Copy-Item -Path "README.md"          -Destination $deployDir

# 4. 拷贝部署模板（部署脚本 + 部署步骤 + bat 启动文件）
Copy-Item -Path "deploy-template\start.ps1"               -Destination $deployDir
Copy-Item -Path "deploy-template\install-service.ps1"     -Destination $deployDir
Copy-Item -Path "deploy-template\uninstall-service.ps1"   -Destination $deployDir
Copy-Item -Path "deploy-template\DEPLOY-STEPS.md"         -Destination $deployDir
Copy-Item -Path "deploy-template\启动服务.bat"             -Destination $deployDir
Copy-Item -Path "deploy-template\停止服务.bat"             -Destination $deployDir

# 5. .env：使用服务器版 .env.production（端口 80 等已就位）
if (Test-Path "deploy-template\.env.production") {
    Copy-Item -Path "deploy-template\.env.production" -Destination "$deployDir\.env" -Force
    Write-Host "[OK] Server .env (port=80) prepared" -ForegroundColor Green
}
Copy-Item -Path ".env.example" -Destination "$deployDir\.env.example"

Write-Host "[OK] Files copied" -ForegroundColor Green

# 6. 打包 ZIP
Write-Host "`n[3/4] Creating ZIP..." -ForegroundColor Yellow
$zipFile = "feishu-todo-deploy.zip"
if (Test-Path $zipFile) {
    Remove-Item -Force $zipFile
}
Compress-Archive -Path $deployDir -DestinationPath $zipFile -CompressionLevel Optimal
Write-Host "[OK] ZIP created" -ForegroundColor Green

# 7. 显示结果
$zipItem = Get-Item $zipFile
$sizeMB = [math]::Round($zipItem.Length / 1MB, 2)

Write-Host "`n[4/4] Done!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Package: $($zipItem.FullName)" -ForegroundColor Cyan
Write-Host "Size:    $sizeMB MB" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green

Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "  1. Connect to your Windows Server via mstsc" -ForegroundColor White
Write-Host "  2. Drag '$zipFile' to the server desktop" -ForegroundColor White
Write-Host "  3. Extract to C:\Apps\feishu-todo" -ForegroundColor White
Write-Host "  4. On server: cd C:\Apps\feishu-todo; npm install --omit=dev" -ForegroundColor White
Write-Host "  5. If better-sqlite3 still fails, run: npm rebuild better-sqlite3 --build-from-source" -ForegroundColor White
Write-Host "  6. Edit .env (PORT=80, etc.)" -ForegroundColor White
Write-Host "  7. Right-click PowerShell -> Run as Admin" -ForegroundColor White
Write-Host "     .\install-service.ps1" -ForegroundColor White
Write-Host "  8. Configure firewall:" -ForegroundColor White
Write-Host "     New-NetFirewallRule -DisplayName 'Feishu Bot' -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow" -ForegroundColor White
Write-Host "  9. Update Feishu callback to: http://YOUR_SERVER_IP/feishu/events" -ForegroundColor White
Write-Host ""
