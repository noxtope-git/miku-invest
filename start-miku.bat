@echo off
chcp 65001 >nul
title Miku AI Launcher
echo ========================================
echo        MIKU AI - Launcher
echo ========================================
echo.

echo [1/4] Iniciando Ollama...
tasklist /FI "IMAGENAME eq ollama.exe" 2>nul | find /I "ollama.exe" >nul
if %errorlevel%==0 (
    echo       Ollama ya esta en ejecucion.
) else (
    start "" "C:\Users\USUARIO\AppData\Local\Ollama\ollama.exe" serve
    echo       Ollama iniciado.
)

echo [2/4] Iniciando servidor OpenCode...
netstat -an | findstr "37999" | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo       OpenCode ya esta en ejecucion.
) else (
    start "" "C:\Users\USUARIO\AppData\Roaming\npm\opencode.cmd" serve --port 37999 --hostname 127.0.0.1
    echo       OpenCode iniciado en puerto 37999.
)

echo [3/4] Iniciando backend de Miku (puerto 4000)...
netstat -an | findstr ":4000" | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo       Backend ya esta en ejecucion.
) else (
    start "Miku Backend" cmd /k "cd /d C:\Users\USUARIO\Desktop\gamma4\backend && node server.js"
    echo       Backend iniciado.
)

echo [4/4] Abriendo interfaz Miku...
timeout /t 3 /nobreak >nul
start "" http://localhost:4000

echo.
echo ========================================
echo  Miku esta lista en http://localhost:4000
echo ========================================
