#!/bin/bash
set -e

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$BACKEND_DIR/python-sandbox-venv"

echo "Setting up Python sandbox environment..."

if [ -d "$VENV_DIR" ]; then
  echo "Sandbox venv already exists at $VENV_DIR"
  read -p "Remove and recreate? (y/N): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$VENV_DIR"
  else
    echo "Aborted."
    exit 1
  fi
fi

python3 -m venv "$VENV_DIR"
echo "Created virtual environment at $VENV_DIR"

source "$VENV_DIR/bin/activate"

pip install --upgrade pip setuptools wheel --quiet

echo "Installing whitelist packages..."
pip install --quiet \
  "pandas==2.2.3" \
  "openpyxl==3.1.5" \
  "python-docx==1.2.0" \
  "Pillow==12.2.0" \
  "xlrd==2.0.1" \
  "reportlab==4.2.5" \
  "chardet==5.2.0" \
  "python-dateutil==2.9.0" \
  "pypdf==5.1.0" \
  "pdfplumber==0.11.4"

echo "Installed packages:"
pip list --format=columns

deactivate

echo ""
echo "Python sandbox setup complete."
echo "Virtual environment: $VENV_DIR"
echo "Python binary:       $VENV_DIR/bin/python3"
