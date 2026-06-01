# Build Complete ECS Deploy Package
# Simple script without encoding issues

Write-Host "Building ECS deploy package..." -ForegroundColor Cyan

# Build TypeScript
Write-Host "Building TypeScript..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

# Create deploy directory
$deployDir = "feishu-todo-complete"
if (Test-Path $deployDir) {
    Remove-Item -Recurse -Force $deployDir
}
New-Item -ItemType Directory -Path $deployDir | Out-Null

# Copy files
Write-Host "Copying files..." -ForegroundColor Yellow
Copy-Item -Path "dist" -Destination $deployDir -Recurse
Copy-Item -Path "src" -Destination $deployDir -Recurse
Copy-Item -Path "package.json" -Destination $deployDir
Copy-Item -Path "package-lock.json" -Destination $deployDir
Copy-Item -Path "tsconfig.json" -Destination $deployDir
Copy-Item -Path ".gitignore" -Destination $deployDir
Copy-Item -Path "README.md" -Destination $deployDir
Copy-Item -Path "DEPLOYMENT.md" -Destination $deployDir
Copy-Item -Path "AI_FEATURES.md" -Destination $deployDir

# Copy deploy templates
Copy-Item -Path "deploy-template\.env" -Destination "$deployDir\.env.example"
Copy-Item -Path "deploy-template\start.ps1" -Destination $deployDir
Copy-Item -Path "deploy-template\install-service.ps1" -Destination $deployDir
Copy-Item -Path "deploy-template\uninstall-service.ps1" -Destination $deployDir
Copy-Item -Path "deploy-template\README-ECS-DEPLOY.md" -Destination $deployDir
Copy-Item -Path "check-env.ps1" -Destination $deployDir

# Create ZIP
Write-Host "Creating ZIP..." -ForegroundColor Yellow
$zipFile = "feishu-todo-complete.zip"
if (Test-Path $zipFile) {
    Remove-Item -Force $zipFile
}
Compress-Archive -Path $deployDir -DestinationPath $zipFile -CompressionLevel Optimal

# Show result
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Package created successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

$zipItem = Get-Item $zipFile
$sizeMB = [math]::Round($zipItem.Length / 1MB, 2)

Write-Host "Location: $($zipItem.FullName)" -ForegroundColor Cyan
Write-Host "Size: $sizeMB MB" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Open Remote Desktop to 121.43.118.153" -ForegroundColor White
Write-Host "2. Drag $zipFile to ECS desktop" -ForegroundColor White
Write-Host "3. Extract to C:\Apps\" -ForegroundColor White
Write-Host "4. Read README-ECS-DEPLOY.md for deployment" -ForegroundColor White
Write-Host ""
