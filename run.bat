@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Hallery - khoi dong app
echo ============================================
echo.

REM Cai dependencies neu chua co node_modules
if not exist "node_modules" (
    echo [1/2] Chua co node_modules - dang cai dat dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo Loi khi cai dependencies. Dung lai.
        pause
        exit /b 1
    )
) else (
    echo [1/2] node_modules da co - bo qua cai dat.
)

echo.
echo [2/2] Chay dev server (Next.js)...
echo App se mo tai http://localhost:3000
echo Nhan Ctrl+C de dung.
echo.

call npm run dev

pause
