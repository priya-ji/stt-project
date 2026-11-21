#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PYTHON="$PROJECT_DIR/.venv/bin/python"

if [ ! -x "$PYTHON" ]; then
    echo "Create the project environment first: python3.11 -m venv \"$PROJECT_DIR/.venv\"" >&2
    exit 1
fi

cd "$PROJECT_DIR/backend"
exec "$PYTHON" -m uvicorn app.main:app --reload --port 8000 "$@"
