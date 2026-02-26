@echo off
title VisualAudioScraper

echo Starting backend...
start "Backend" cmd /k "cd /d %~dp0backend && python -u -W ignore server.py"

echo Starting frontend...
start "Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 3 >nul
echo.
echo Backend: http://localhost:8765 (WebSocket)
echo Frontend: http://localhost:5173
echo.
echo Opening browser...
start http://localhost:5173
