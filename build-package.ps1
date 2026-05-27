# Feishu Todo Bot - Windows ECS Deploy Package Builder
# Simplified version: copies template files to avoid PowerShell encoding issues

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Feishu Todo Bot - Deploy Package Builder" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js
Write-Host "[1/5] Checking Node.js..." -ForegroundColor Yellow
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js not found. Install from https://nodejs.org/" -ForegroundColor Red
    exit 1
}
$nodeVersion = node --version
Write-Host "[OK] Node.js version: $nodeVersion" -ForegroundColor Green
Write-Host ""

# 2. Build TypeScript
Write-Host "[2/5] Building TypeScript..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Build complete" -ForegroundColor Green
Write-Host ""

# 3. Prepare deploy directory
Write-Host "[3/5] Preparing deploy files..." -ForegroundColor Yellow
$deployDir = "feishu-todo-deploy"
if (Test-Path $deployDir) {
    Remove-Item -Recurse -Force $deployDir
}
New-Item -ItemType Directory -Path $deployDir | Out-Null

# Copy compiled code
Copy-Item -Path "dist" -Destination $deployDir -Recurse
Copy-Item -Path "package.json" -Destination $deployDir
Copy-Item -Path "package-lock.json" -Destination $deployDir

# Copy template files
Copy-Item -Path "deploy-template\.env" -Destination $deployDir
Copy-Item -Path "deploy-template\start.ps1" -Destination $deployDir
Copy-Item -Path "deploy-template\install-service.ps1" -Destination $deployDir
Copy-Item -Path "deploy-template\uninstall-service.ps1" -Destination $deployDir
Copy-Item -Path "deploy-template\README-DEPLOY.md" -Destination $deployDir

Write-Host "[OK] Deploy files ready" -ForegroundColor Green
Write-Host ""

# 4. Create ZIP
Write-Host "[4/5] Creating ZIP..." -ForegroundColor Yellow
$zipFile = "feishu-todo-deploy.zip"
if (Test-Path $zipFile) {
    Remove-Item -Force $zipFile
}

Compress-Archive -Path $deployDir -DestinationPath $zipFile -CompressionLevel Optimal

Write-Host "[OK] ZIP created" -ForegroundColor Green
Write-Host ""

# 5. Show result
Write-Host "========================================" -ForegroundColor Green
Write-Host "[OK] Deploy package built successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

$zipItem = Get-Item $zipFile
$fullPath = $zipItem.FullName
$sizeMB = [math]::Round($zipItem.Length / 1MB, 2)

Write-Host "Package location:" -ForegroundColor Cyan
Write-Host "  $fullPath" -ForegroundColor White
Write-Host ""
Write-Host "File size:" -ForegroundColor Cyan
Write-Host "  $sizeMB MB" -ForegroundColor White
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Upload $zipFile to ECS (121.43.118.153)" -ForegroundColor Gray
Write-Host "  2. Extract to C:\Apps\feishu-todo-deploy on ECS" -ForegroundColor Gray
Write-Host "  3. Read README-DEPLOY.md to complete deployment" -ForegroundColor Gray
Write-Host ""
Write-Host "Tip: Drag and drop via Remote Desktop is the easiest way" -ForegroundColor Cyan
Write-Host ""
