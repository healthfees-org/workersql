#!/usr/bin/env bash
"""
Installation script for WorkerSQL Python SDK
"""

set -e

echo "🚀 Installing WorkerSQL Python SDK..."

# Check if Python 3.8+ is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required but not found. Please install Python 3.8 or higher."
    exit 1
fi

# Check Python version
PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
REQUIRED_VERSION="3.8"

if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$PYTHON_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
    echo "❌ Python $REQUIRED_VERSION or higher is required. Found Python $PYTHON_VERSION."
    exit 1
fi

echo "✅ Python $PYTHON_VERSION found"

# Install the package
echo "📦 Installing package and dependencies..."
pip install -e .

echo "🎉 Installation complete!"
echo ""
echo "📚 Usage:"
echo "  from workersql_client import WorkerSQLClient"
echo ""
echo "🧪 Run tests:"
echo "  pytest"
echo ""
echo "📖 Documentation:"
echo "  https://workersql.readthedocs.io/"
