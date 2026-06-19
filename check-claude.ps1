Write-Host "=== VS Code Terminal Claude Check ==="
Write-Host ""
Write-Host "1. Current PATH entries with Feishu or npm:"
$env:Path -split ';' | Where-Object { $_ -like '*Feishu*' -or $_ -like '*npm*' } | ForEach-Object { Write-Host "  $_" }
Write-Host ""

Write-Host "2. Try Get-Command claude:"
$cmd = Get-Command claude -ErrorAction SilentlyContinue
if ($cmd) {
  Write-Host "  FOUND: $($cmd.Source)"
} else {
  Write-Host "  NOT FOUND"
}
Write-Host ""

Write-Host "3. Try running claude --version:"
try {
  $output = & claude --version 2>&1
  Write-Host "  SUCCESS: $output"
} catch {
  Write-Host "  FAILED: $_"
}
