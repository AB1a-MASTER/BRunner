param(
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

$port = 8765
$bindAddress = "127.0.0.1"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverPath = Join-Path $root "acceptance_fixture_server.py"
$fixtureRelativePath = "tests/fixtures/navigate-acceptance.html"
$fixturePath = Join-Path $root $fixtureRelativePath
$fixtureUrl = (
    "http://${bindAddress}:${port}/" +
    "$($fixtureRelativePath -replace '\\', '/')" +
    "?acceptance=001-navigate-v2"
)

if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) {
    throw "Navigate acceptance fixture is missing: $fixturePath"
}

if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
    throw "Acceptance fixture server is missing: $serverPath"
}

function Test-ExpectedFixtureServer {
    param([string]$Url)

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        $cacheControl = [string]$response.Headers["Cache-Control"]
        return (
            $response.StatusCode -eq 200 -and
            $response.Content -match '<title>BRunner Navigate Acceptance</title>' -and
            $response.Content -match 'data-acceptance="navigate"' -and
            $cacheControl -match '(^|,)\s*no-store(\s*,|$)'
        )
    } catch {
        return $false
    }
}

$existingListener = Get-NetTCPConnection `
    -State Listen `
    -LocalPort $port `
    -ErrorAction SilentlyContinue |
    Select-Object -First 1

if ($existingListener) {
    if (Test-ExpectedFixtureServer -Url $fixtureUrl) {
        Write-Host "The expected repository fixture server is already running:"
        Write-Host "  $fixtureUrl"
        exit 0
    }

    throw (
        "Port $port is already used by PID $($existingListener.OwningProcess), " +
        "but it does not serve the expected Navigate fixture. Stop that process " +
        "and run this launcher again."
    )
}

Write-Host "Serving BRunner acceptance fixtures from:"
Write-Host "  $root"
Write-Host ""
Write-Host "Open:"
Write-Host "  $fixtureUrl"
Write-Host "  http://127.0.0.1:8765/BRunner_Host/test.html"
Write-Host "  http://127.0.0.1:8765/BRunner_Host/mapper_test.html"
Write-Host "  http://127.0.0.1:8765/BRunner_Host/mapper_stress_test.html"
Write-Host "  http://127.0.0.1:8765/BRunner_Host/mapper_platform_profiles_test.html"
Write-Host ""

if ($CheckOnly) {
    Write-Host "Acceptance server configuration is valid."
    exit 0
}

Write-Host "Press Ctrl+C to stop the server."

$python = Get-Command python -ErrorAction Stop
& $python.Source $serverPath --port $port --bind $bindAddress --directory $root

if ($LASTEXITCODE -ne 0) {
    throw "Acceptance fixture server exited with code $LASTEXITCODE."
}
