@echo off
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js not found. Please run setup.bat first.
    pause
    exit /b 1
)
node start.js
if errorlevel 1 pause
