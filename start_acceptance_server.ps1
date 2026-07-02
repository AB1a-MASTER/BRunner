$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Serving BRunner acceptance fixtures from:"
Write-Host "  $root"
Write-Host ""
Write-Host "Open:"
Write-Host "  http://127.0.0.1:8765/BRunner/test.html"
Write-Host ""
Write-Host "Press Ctrl+C to stop the server."

python -m http.server 8765
