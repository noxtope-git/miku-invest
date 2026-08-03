@echo off
chcp 65001 >nul
title Miku AI - Instalador
echo ========================================
echo    MIKU AI - Instalacion completa
echo ========================================
echo.

echo [1/4] Instalando dependencias del backend (Node.js)...
cd /d C:\Users\USUARIO\Desktop\gamma4\backend
call npm install 2>nul
echo       OK.

echo [2/4] Instalando dependencias del frontend (React/Vite)...
cd /d C:\Users\USUARIO\Desktop\gamma4\frontend
call npm install 2>nul
echo       OK.

echo [3/4] Compilando frontend...
call npm run build 2>nul
echo       OK.

echo.
echo ========================================
echo  Instalacion completada.
echo  Ahora ejecuta:  start-miku.bat
echo ========================================
pause
