$ErrorActionPreference = "Stop"

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
  throw "Missing .env file. Copy .env.example to .env and fill in the values first."
}

Push-Location $PSScriptRoot
try {
  npm.cmd run dev
} finally {
  Pop-Location
}
