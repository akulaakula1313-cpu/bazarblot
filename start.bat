@echo off
chcp 65001 >nul
title BAZAR-BLOT Launcher

echo ═════════════════════════════════════════════════════
echo   BAZAR-BLOT · SANI GROUP
echo ═════════════════════════════════════════════════════
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js не установлен. Скачай с https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [INFO] Установка зависимостей...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
)

echo [INFO] Запуск Vite (порт 3000)...
start "BB Vite" cmd /k "npm run dev"

timeout /t 2 /nobreak >nul

echo [INFO] Запуск WS сервера (порт 3001)...
start "BB Server" cmd /k "npm run start"

echo.
echo ═════════════════════════════════════════════════════
echo   Открой в браузере: http://localhost:3000
echo ═════════════════════════════════════════════════════
pause