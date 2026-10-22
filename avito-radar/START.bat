@echo off
chcp 65001 >nul
title Avito Radar
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Не найден Node.js. Установите LTS-версию с https://nodejs.org/ и запустите файл снова.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo Первый запуск: устанавливаю зависимости, это займёт пару минут...
  call npm install
  if errorlevel 1 (
    echo Не удалось установить зависимости. Проверьте интернет и запустите снова.
    pause
    exit /b 1
  )
)

echo Запускаю Avito Radar...
call npm start
if errorlevel 1 pause
