# Miku AI - Inicia todos los servicios (invisible)
# Abre la interfaz en Firefox

$ErrorActionPreference = 'SilentlyContinue'

function Test-Port($port) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen
    return $null -ne $conn
}

# Firefox
$firefox = "C:\Program Files\Mozilla Firefox\firefox.exe"
if (-not (Test-Path $firefox)) { $firefox = "C:\Program Files (x86)\Mozilla Firefox\firefox.exe" }
if (-not (Test-Path $firefox)) { $firefox = "firefox.exe" }

# 1. Ollama
$ollamaPath = "C:\Users\USUARIO\AppData\Local\Ollama\ollama.exe"
if (-not (Test-Port 11434)) {
    if (Test-Path $ollamaPath) {
        Start-Process $ollamaPath -ArgumentList "serve" -WindowStyle Hidden
    }
}

# 2. OpenCode serve
if (-not (Test-Port 37999)) {
    Start-Process "opencode.cmd" -ArgumentList "serve --port 37999 --hostname 127.0.0.1" -WindowStyle Hidden
}

# 3. Backend Miku (node, sin ventana)
if (-not (Test-Port 4000)) {
    Start-Process "cmd.exe" -ArgumentList "/c","node server.js" -WorkingDirectory "C:\Users\USUARIO\Desktop\gamma4\backend" -WindowStyle Hidden
}

# 4. Esperar y abrir Firefox
Start-Sleep -Seconds 6
Start-Process $firefox -ArgumentList "http://localhost:4000"
