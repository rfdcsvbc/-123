param([switch]$NoBrowser, [int]$PreferredPort = 5188)

$ErrorActionPreference = 'Stop'
$projectPath = $PSScriptRoot
$distPath = Join-Path $projectPath 'dist'
$mutex = New-Object System.Threading.Mutex($false, 'Local\HuiGestureBaguaLauncher')
$ownsMutex = $false

function Get-HuiHealth([int]$Port) {
    try {
        $result = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/__hui_health" -TimeoutSec 1
        if ($result.app -eq 'hui-gesture-bagua' -and $result.root -eq $distPath) { return $result }
    } catch { }
    return $null
}

try {
    try { $ownsMutex = $mutex.WaitOne(45000) }
    catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { throw 'Another launch is taking too long. Please try again.' }

    $nodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $nodePath) {
        $nodePath = Join-Path $env:ProgramFiles 'nodejs\node.exe'
        if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js 20 or newer is required.' }
    }

    $builtPage = Join-Path $distPath 'index.html'
    $needsBuild = -not (Test-Path -LiteralPath $builtPage)
    if (-not $needsBuild) {
        $builtAt = (Get-Item -LiteralPath $builtPage).LastWriteTimeUtc
        $sourceFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectPath 'src') -File -Recurse)
        $sourceFiles += @(Get-Item -LiteralPath (Join-Path $projectPath 'index.html'), `
            (Join-Path $projectPath 'vite.config.js'), (Join-Path $projectPath 'package.json'))
        $needsBuild = [bool]($sourceFiles | Where-Object { $_.LastWriteTimeUtc -gt $builtAt } | Select-Object -First 1)
    }
    if ($needsBuild) {
        Push-Location -LiteralPath $projectPath
        try {
            & (Join-Path (Split-Path $nodePath) 'npm.cmd') run build *> (Join-Path $projectPath 'build.log')
            if ($LASTEXITCODE -ne 0) { throw 'Build failed. See build.log in the project folder.' }
        } finally { Pop-Location }
    }

    $ready = $null
    for ($port = $PreferredPort; $port -lt $PreferredPort + 12; $port++) {
        $ready = Get-HuiHealth $port
        if ($ready) { break }
        $occupied = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($occupied) { continue }

        $serverPath = Join-Path $projectPath 'scripts\serve.mjs'
        $serverArgs = '"{0}" {1} "{2}"' -f $serverPath, $port, $distPath
        $serverProcess = Start-Process -FilePath $nodePath -ArgumentList $serverArgs `
            -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $projectPath "server-$port.log") `
            -RedirectStandardError (Join-Path $projectPath "server-$port.err.log")

        $deadline = (Get-Date).AddSeconds(15)
        do {
            $ready = Get-HuiHealth $port
            if ($ready) { break }
            if ($serverProcess.HasExited) { break }
            Start-Sleep -Milliseconds 200
        } while ((Get-Date) -lt $deadline)
        if ($ready) { break }
    }
    if (-not $ready) { throw 'Unable to start the local page. See server-*.err.log in the project folder.' }
    $url = "http://127.0.0.1:$port/"
    @{ url = $url; pid = $ready.pid; root = $distPath } | ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $projectPath 'launch-state.json') -Encoding UTF8
    if (-not $NoBrowser) { Start-Process $url }
    Write-Output $url
} catch {
    if ($NoBrowser) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'HUI - Unable to open page') | Out-Null
    exit 1
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
