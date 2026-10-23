FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WHISPER_MODEL=base

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Bake the open-source Whisper model into the image so the first request is not slow.
RUN python -c "import os; from faster_whisper import WhisperModel; WhisperModel(os.environ.get('WHISPER_MODEL', 'base'), device='cpu', compute_type='int8')"

COPY backend ./backend
COPY frontend ./frontend

WORKDIR /app/backend
EXPOSE 8000

# Cloud platforms inject $PORT (Render, Railway, Cloud Run...)
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
