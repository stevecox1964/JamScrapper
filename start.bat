@echo off
title VisualAudioScraper

echo Cleaning up old processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8765 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8766 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1

echo Starting backend...
start "Backend" cmd /k "cd /d %~dp0backend && python -u -W ignore server.py"

echo Starting frontend...
start "Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 3 >nul
echo.
echo Backend: http://localhost:8765 (WebSocket)
echo Frontend: http://localhost:5173
echo.
echo Browser will open automatically via backend.
