# Analyze C drive space usage

Write-Host "=== C Drive Space Overview ===" -ForegroundColor Cyan
$drive = Get-PSDrive C
$total = $drive.Used + $drive.Free
Write-Host ("Total: {0:N2} GB" -f ($total/1GB))
Write-Host ("Used:  {0:N2} GB" -f ($drive.Used/1GB))
Write-Host ("Free:  {0:N2} GB ({1:N1}%)" -f ($drive.Free/1GB), ($drive.Free/$total*100))

Write-Host "`n=== Cleanable Locations ===" -ForegroundColor Cyan

$paths = @(
    @{Name="User Temp Files"; Path="$env:LOCALAPPDATA\Temp"; Safe="Safe to delete all"},
    @{Name="Windows Temp"; Path="C:\Windows\Temp"; Safe="Safe to delete all"},
    @{Name="Windows Update Cache"; Path="C:\Windows\SoftwareDistribution\Download"; Safe="Safe"},
    @{Name="Windows.old (old system)"; Path="C:\Windows.old"; Safe="Safe within 10 days"},
    @{Name="Prefetch"; Path="C:\Windows\Prefetch"; Safe="Safe (rebuilt)"},
    @{Name="Hibernation File"; Path="C:\hiberfil.sys"; Safe="Disable hibernate to remove"},
    @{Name="Page File"; Path="C:\pagefile.sys"; Safe="System managed"},
    @{Name="Downloads Folder"; Path="$env:USERPROFILE\Downloads"; Safe="Review then delete"},
    @{Name="Desktop"; Path="$env:USERPROFILE\Desktop"; Safe="Review then clean"},
    @{Name="Chrome Cache"; Path="$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Cache"; Safe="Safe"},
    @{Name="Edge Cache"; Path="$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Cache"; Safe="Safe"},
    @{Name="Recycle Bin"; Path="C:\`$Recycle.Bin"; Safe="Review then empty"},
    @{Name="npm cache"; Path="$env:APPDATA\npm-cache"; Safe="Safe"},
    @{Name="pip cache"; Path="$env:LOCALAPPDATA\pip\Cache"; Safe="Safe"},
    @{Name="VSCode Cache"; Path="$env:APPDATA\Code\Cache"; Safe="Safe"},
    @{Name="Cursor Cache"; Path="$env:APPDATA\Cursor\Cache"; Safe="Safe"},
    @{Name="Cursor CachedData"; Path="$env:APPDATA\Cursor\CachedData"; Safe="Safe"},
    @{Name="Windows Logs"; Path="C:\Windows\Logs"; Safe="Safe"},
    @{Name="Windows Error Reports"; Path="C:\ProgramData\Microsoft\Windows\WER"; Safe="Safe"},
    @{Name="Delivery Optimization"; Path="C:\Windows\SoftwareDistribution\DeliveryOptimization"; Safe="Safe"}
)

$results = @()
foreach ($item in $paths) {
    if (Test-Path $item.Path) {
        try {
            $info = Get-Item $item.Path -Force -ErrorAction SilentlyContinue
            if ($info.PSIsContainer) {
                $size = (Get-ChildItem $item.Path -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
            } else {
                $size = $info.Length
            }
            if ($null -eq $size) { $size = 0 }
            $results += [PSCustomObject]@{
                Name = $item.Name
                "SizeMB" = [math]::Round($size/1MB, 2)
                "Note" = $item.Safe
            }
        } catch {}
    }
}

$results | Sort-Object "SizeMB" -Descending | Format-Table -AutoSize

Write-Host "`n=== Top Folders in User Profile ===" -ForegroundColor Cyan
Get-ChildItem "$env:USERPROFILE" -Force -ErrorAction SilentlyContinue | Where-Object { $_.PSIsContainer } | ForEach-Object {
    $s = (Get-ChildItem $_.FullName -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    [PSCustomObject]@{
        Name = $_.Name
        "SizeGB" = [math]::Round(($s/1GB), 2)
    }
} | Sort-Object "SizeGB" -Descending | Select-Object -First 10 | Format-Table -AutoSize

Write-Host "`n=== Top Folders in ProgramData ===" -ForegroundColor Cyan
Get-ChildItem "C:\ProgramData" -Force -ErrorAction SilentlyContinue | Where-Object { $_.PSIsContainer } | ForEach-Object {
    $s = (Get-ChildItem $_.FullName -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    [PSCustomObject]@{
        Name = $_.Name
        "SizeMB" = [math]::Round(($s/1MB), 2)
    }
} | Sort-Object "SizeMB" -Descending | Select-Object -First 10 | Format-Table -AutoSize

Write-Host "`n=== Top Folders in AppData\Local ===" -ForegroundColor Cyan
Get-ChildItem "$env:LOCALAPPDATA" -Force -ErrorAction SilentlyContinue | Where-Object { $_.PSIsContainer } | ForEach-Object {
    $s = (Get-ChildItem $_.FullName -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    [PSCustomObject]@{
        Name = $_.Name
        "SizeMB" = [math]::Round(($s/1MB), 2)
    }
} | Sort-Object "SizeMB" -Descending | Select-Object -First 10 | Format-Table -AutoSize
