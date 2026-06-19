# Feishu Todo Bot - Install as Windows Service
# Requires Administrator privileges

$serviceName = "FeishuTodoBot"
$displayName = "FeishuTodoBot"
$description = "Feishu Todo Bot Service"
$nodeExe = Get-Command node -ErrorAction SilentlyContinue
$npmExe = Get-Command npm -ErrorAction SilentlyContinue

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Install Windows Service" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

function Assert-ToolExists {
    param(
        [string]$ToolName,
        [object]$ToolCommand
    )

    if (-not $ToolCommand) {
        Write-Host "[ERROR] $ToolName not found in PATH" -ForegroundColor Red
        Write-Host "Please install Node.js LTS (includes npm) first." -ForegroundColor Yellow
        pause
        exit 1
    }
}

Assert-ToolExists -ToolName "node" -ToolCommand $nodeExe
Assert-ToolExists -ToolName "npm" -ToolCommand $npmExe

Set-Location $PSScriptRoot

# Ensure production dependencies are installed in the deployed directory.
Write-Host "Checking production dependencies..." -ForegroundColor Yellow
if (-not (Test-Path "$PSScriptRoot\node_modules\better-sqlite3")) {
    Write-Host "Installing production dependencies..." -ForegroundColor Yellow
    npm install --omit=dev
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] npm install --omit=dev failed" -ForegroundColor Red
        Write-Host "Please inspect network access and npm logs, then rerun this script." -ForegroundColor Yellow
        pause
        exit 1
    }
}

if (-not (Test-Path "$PSScriptRoot\node_modules\better-sqlite3")) {
    Write-Host "Attempting to rebuild better-sqlite3..." -ForegroundColor Yellow
    npm rebuild better-sqlite3 --build-from-source
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] better-sqlite3 is still missing after rebuild." -ForegroundColor Red
        Write-Host "On Windows Server, please ensure the Visual Studio Build Tools are installed." -ForegroundColor Yellow
        pause
        exit 1
    }
}

if (-not (Test-Path "$PSScriptRoot\node_modules\better-sqlite3")) {
    Write-Host "[ERROR] better-sqlite3 was not installed correctly." -ForegroundColor Red
    Write-Host "Please run: npm install --omit=dev; npm rebuild better-sqlite3 --build-from-source" -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host "[OK] Production dependencies are ready" -ForegroundColor Green

# Check Administrator privileges
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[ERROR] Please run this script as Administrator" -ForegroundColor Red
    Write-Host "Right-click PowerShell -> Run as administrator" -ForegroundColor Yellow
    pause
    exit 1
}

# Check if NSSM is installed
if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Host "NSSM not found, downloading..." -ForegroundColor Yellow

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
        Write-Host "[OK] NSSM installed" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] NSSM download failed. Please download manually: https://nssm.cc/download" -ForegroundColor Red
        Write-Host "Extract and copy nssm.exe to C:\Windows\System32\" -ForegroundColor Yellow
        pause
        exit 1
    }
}

# Check if service already exists
$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Service exists, removing..." -ForegroundColor Yellow
    nssm stop $serviceName
    nssm remove $serviceName confirm
    Start-Sleep -Seconds 2
}

# Install service
Write-Host "Installing service..." -ForegroundColor Yellow
nssm install $serviceName node "$PSScriptRoot\dist\index.js"
nssm set $serviceName AppDirectory "$PSScriptRoot"
nssm set $serviceName DisplayName "$displayName"
nssm set $serviceName Description "$description"
nssm set $serviceName Start SERVICE_AUTO_START
nssm set $serviceName AppStdout "$PSScriptRoot\logs\stdout.log"
nssm set $serviceName AppStderr "$PSScriptRoot\logs\stderr.log"
nssm set $serviceName AppRotateFiles 1
nssm set $serviceName AppRotateBytes 10485760

# Create logs directory
New-Item -ItemType Directory -Path "$PSScriptRoot\logs" -Force | Out-Null

# Start service
Write-Host "Starting service..." -ForegroundColor Yellow
nssm start $serviceName

Start-Sleep -Seconds 3

# Check service status
$service = Get-Service -Name $serviceName
if ($service.Status -eq "Running") {
    Write-Host ""
    Write-Host "[OK] Service installed and started!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Service name: $serviceName" -ForegroundColor Cyan
    Write-Host "Status: Running" -ForegroundColor Green
    Write-Host ""
    Write-Host "Management commands:" -ForegroundColor Yellow
    Write-Host "  Status:  Get-Service $serviceName" -ForegroundColor Gray
    Write-Host "  Stop:    Stop-Service $serviceName" -ForegroundColor Gray
    Write-Host "  Start:   Start-Service $serviceName" -ForegroundColor Gray
    Write-Host "  Restart: Restart-Service $serviceName" -ForegroundColor Gray
    Write-Host "  Logs:    Get-Content logs\stdout.log -Tail 50" -ForegroundColor Gray
} else {
    Write-Host "[ERROR] Service failed to start. Check logs: logs\stderr.log" -ForegroundColor Red
}

Write-Host ""
pause
