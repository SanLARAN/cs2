@echo off
chcp 65001 >nul
title Сборка Avito Radar
cd /d "%~dp0"
call npm install
if errorlevel 1 ( pause & exit /b 1 )
call npm run build:win
if errorlevel 1 ( echo Сборка не удалась. & pause & exit /b 1 )
echo.
echo Готово! Файлы лежат в папке dist.
explorer "%~dp0dist"
pause
