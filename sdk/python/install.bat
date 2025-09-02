@echo off
REM Installation script for WorkerSQL Python SDK (Windows)

echo 🚀 Installing WorkerSQL Python SDK...

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python is required but not found. Please install Python 3.8 or higher.
    echo Download from: https://python.org/downloads/
    pause
    exit /b 1
)

REM Check Python version
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo ✅ Python %PYTHON_VERSION% found

REM Install the package
echo 📦 Installing package and dependencies...
pip install -e .

echo 🎉 Installation complete!
echo.
echo 📚 Usage:
echo   from workersql_client import WorkerSQLClient
echo.
echo 🧪 Run tests:
echo   pytest
echo.
echo 📖 Documentation:
echo   https://workersql.readthedocs.io/

pause
