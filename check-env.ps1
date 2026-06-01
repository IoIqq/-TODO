# Check .env configuration
Write-Host "Checking .env configuration..." -ForegroundColor Cyan
Write-Host ""

$envFile = ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "[ERROR] .env file not found!" -ForegroundColor Red
    Write-Host "Please copy .env.example to .env first" -ForegroundColor Yellow
    exit 1
}

$config = @{}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([^#][^=]+)=(.*)$') {
        $key = $matches[1].Trim()
        $value = $matches[2].Trim()
        $config[$key] = $value
    }
}

Write-Host "Configuration Status:" -ForegroundColor Yellow
Write-Host ""

# Check required fields
$required = @(
    "PORT",
    "FEISHU_APP_ID",
    "FEISHU_APP_SECRET",
    "FEISHU_VERIFICATION_TOKEN",
    "FEISHU_ENCRYPT_KEY",
    "FEISHU_TASKLIST_GUID",
    "OPENAI_API_BASE_URL",
    "OPENAI_API_KEY",
    "OPENAI_MODEL"
)

$allOk = $true

foreach ($key in $required) {
    $value = $config[$key]
    if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Host "[X] $key - MISSING" -ForegroundColor Red
        $allOk = $false
    } else {
        $masked = if ($key -like "*SECRET*" -or $key -like "*KEY*" -or $key -like "*TOKEN*") {
            $value.Substring(0, [Math]::Min(8, $value.Length)) + "..."
        } else {
            $value
        }
        Write-Host "[OK] $key = $masked" -ForegroundColor Green
    }
}

Write-Host ""

if ($allOk) {
    Write-Host "[SUCCESS] All required fields are configured" -ForegroundColor Green
    Write-Host ""
    Write-Host "Port: $($config['PORT'])" -ForegroundColor Cyan
    Write-Host "App ID: $($config['FEISHU_APP_ID'])" -ForegroundColor Cyan
} else {
    Write-Host "[ERROR] Some required fields are missing" -ForegroundColor Red
    Write-Host "Please edit .env and fill in all values" -ForegroundColor Yellow
}

Write-Host ""
