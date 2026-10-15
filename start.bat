@echo off
REM Juicy Booster v0.4 - launcher Windows
REM Klik dua kali file ini untuk memulai Juicy Booster.
REM Browser otomatis terbuka ke alamat server (127.0.0.1:3003).

title Juicy Booster
cd /d "%~dp0"

echo.
echo   ===============================================
echo     JUICY BOOSTER v0.4 - Windows Booster
echo   ===============================================
echo.
echo   Memulai server di 127.0.0.1:3003 (loopback only)
echo   Browser akan terbuka otomatis.
echo   Tekan Ctrl+C di window ini untuk berhenti.
echo.

where node >nul 2>nul
if %errorlevel%==0 (
  node index.js
) else (
  where bun >nul 2>nul
  if %errorlevel%==0 (
    bun run index.js
  ) else (
    echo.
    echo   [ERROR] Node.js atau Bun tidak ditemukan.
    echo   Install Node.js dari https://nodejs.org (LTS)
    echo   lalu klik dua kali file ini lagi.
    echo.
    pause
    exit /b 1
  )
)

pause
