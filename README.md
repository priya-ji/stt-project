## Vercel hosted transcription

Set `HF_TOKEN` to a Hugging Face token with **Make calls to Inference Providers**
permission in the deployment's environment (Production or Preview), then deploy
this code. `HF_ASR_MODEL` defaults to `openai/whisper-large-v3`; the model must
have an available ASR inference provider for your account. Provider credits may
be required. Never commit tokens or put them in frontend JavaScript.

On Vercel, recording uses HTTP: record up to 60 seconds, then press Stop to
upload audio for transcription. Language is automatically detected. The browser
shows provider errors and stops waiting after 60 seconds. Audio is sent to the
hosted provider. Local installations without `HF_TOKEN` retain the WebSocket
streaming mode and require `backend/requirements.txt` (including faster-whisper).
The root `requirements.txt` is for hosted deployment and omits local Whisper.

Set `DATABASE_URL` to a persistent PostgreSQL database for dashboard history.
Vercel's default SQLite fallback is under `/tmp` and is temporary, instance-local
storage: recordings can disappear between invocations. If saving fails, the
transcript is still displayed so it can be copied.

Validation: `python -m pytest -q -c backend/pytest.ini backend/tests` and
`node --test frontend/tests/record.test.cjs`.

# Speech to Text · Real-time Multilingual Transcription

Speak in Hindi, English, or a mix of both (Hinglish) and watch the transcript appear live.
Each recording is saved to a relational database and can be managed from a dashboard with full CRUD.

## Features

- **Real-time transcription** over a WebSocket (audio streams from the browser, text streams back)
- **Multilingual**: Auto-detect (Hinglish), Hindi, or English
- **Open-source STT**: self-hosted [faster-whisper](https://github.com/SYSTRAN/faster-whisper), no API key or paid service
- **Text-to-speech** of the transcript using the browser's built-in speech synthesis (free)
- **Database**: SQLite locally, PostgreSQL in production (one env variable switches it)
- **Dashboard**: stats, search, paging, create / view / edit / delete

## Tech stack

| Layer          | Choice                                                    |
|----------------|-----------------------------------------------------------|
| Backend        | Python 3.11, FastAPI, WebSockets                          |
| Speech-to-text | faster-whisper (Whisper, open source, runs on your server) |
| Database       | SQLAlchemy 2.0 → SQLite (dev) / PostgreSQL (prod)         |
| Frontend       | HTML, CSS, vanilla JavaScript (no build step)             |
| Tests          | pytest + FastAPI TestClient                               |
| Deployment     | Docker → Render / Railway / Google Cloud Run              |

## Architecture

```
 Browser (mic)                                 FastAPI server
 ──────────────                                ──────────────────────────────────────
 record.js                                     
  │  16 kHz PCM frames  ── WebSocket ──────▶   /ws/transcribe
  │                                              │  buffers audio, runs Whisper every 2 s
  │  partial / final text ◀── WebSocket ───────  │  on "stop": saves transcript to DB
  │                                              ▼
  │                                           faster-whisper (open-source STT)
  │
  └─ REST ─────────────────────────────────▶  /api/transcriptions  (CRUD + search + stats)
                                                 │
 dashboard.js ─────── REST ──────────────────────▶ SQLAlchemy ──▶ transcriptions table
                                                                    (SQLite or PostgreSQL)
```

## Project structure

```
stt-project/
├── Dockerfile                    # container for cloud deployment
├── .env.example                  # copy to backend/.env
├── README.md
├── backend/
│   ├── requirements.txt
│   ├── requirements-dev.txt      # + pytest
│   ├── pytest.ini
│   ├── app/
│   │   ├── main.py               # FastAPI app, routers, static frontend
│   │   ├── config.py             # settings from env / .env
│   │   ├── database.py           # engine, session, init
│   │   ├── models.py             # Transcription table
│   │   ├── schemas.py            # request / response models
│   │   ├── stt.py                # Whisper wrapper (speech → text)
│   │   ├── routes_ws.py          # live transcription WebSocket
│   │   └── routes_transcriptions.py  # REST CRUD endpoints
│   └── tests/
│       ├── conftest.py
│       ├── test_transcriptions.py    # CRUD tests
│       └── test_ws.py                # WebSocket protocol tests
└── frontend/
    ├── index.html                # record page
    ├── dashboard.html            # dashboard page
    ├── css/style.css
    └── js/
        ├── api.js                # REST helper
        ├── record.js             # microphone → WebSocket → live text
        └── dashboard.js          # list, search, create, edit, delete
```

---

## Run it locally (step by step)

### Prerequisites

- **Python 3.11** (3.12 also works; check with `python3 --version`)
- **Google Chrome, Edge, or Firefox** (for the microphone)
- About 1 GB of free disk space (the Whisper `base` model is about 150 MB)

### 1. Get the code

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
```

(Or unzip the project folder and `cd` into it.)

### 2. Create a virtual environment and install dependencies

macOS / Linux:
```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

Windows (PowerShell):
```powershell
py -3.11 -m venv .venv
.venv\Scripts\activate
pip install -r backend\requirements.txt
```

### 3. Create the configuration file

```bash
cp .env.example backend/.env       # Windows: copy .env.example backend\.env
```

The defaults work out of the box (SQLite database, Whisper `base` model on CPU).

### 4. Start the server

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

On the **first run** the Whisper model is downloaded automatically (about 150 MB). You will see
`Loading Whisper model 'base'...` in the terminal. Later runs start immediately.

The database file `backend/transcriptions.db` is created automatically.

### 5. Open the app

- Record page: **http://localhost:8000**
- Dashboard: **http://localhost:8000/dashboard.html**
- API docs (Swagger UI): **http://localhost:8000/docs**

### 6. Try it

1. Open the Record page and pick a language (**Auto** for Hinglish).
2. Click the mic and allow microphone access.
3. Speak, for example: *"Aaj ka meeting 3 baje hai, please confirm karna. Let's start with the demo."*
4. Click the mic again to stop. The transcript is saved and the status shows its ID.
5. Open the **Dashboard**. You can search, view/edit, delete, and create transcriptions manually.

### 7. Run the tests

```bash
cd backend
pip install -r requirements-dev.txt    # only once
pytest -v
```

The tests use a temporary SQLite file and a fake transcriber, so they run in seconds without
downloading the model.

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/health` | Health check |
| GET    | `/api/transcriptions?page=1&page_size=10&q=text` | List, search and paginate |
| POST   | `/api/transcriptions` | Create (manual) |
| GET    | `/api/transcriptions/{id}` | Read one |
| PUT    | `/api/transcriptions/{id}` | Update title / text / language |
| DELETE | `/api/transcriptions/{id}` | Delete (returns 204) |
| GET    | `/api/transcriptions/stats` | Totals: count, live vs manual, words, minutes |
| WS     | `/ws/transcribe?lang=auto\|hi\|en` | Live transcription stream |

Example:
```bash
curl -X POST http://localhost:8000/api/transcriptions \
  -H "Content-Type: application/json" \
  -d '{"title":"Standup","text":"Kal demo hai, aaj bug fix karenge.","language":"hi"}'
```

### WebSocket protocol

- Client sends **binary frames**: 16-bit PCM, mono, 16 kHz.
- Client sends the text frame `{"type":"stop"}` when finished.
- Server sends `{"type":"partial","confirmed":"...","pending":"...","language":"hi"}` about every 2 seconds.
- Server sends `{"type":"final","id":5,"text":"...","language":"hi","duration_seconds":12.4}` after stop, and saves the row.

---

## Configuration

Set these in `backend/.env` (or as real environment variables in your cloud host):

| Variable | Default | Meaning |
|----------|---------|---------|
| `DATABASE_URL` | `sqlite:///./transcriptions.db` | SQLite file, or PostgreSQL URL (see below) |
| `WHISPER_MODEL` | `base` | `tiny`, `base`, `small`, `medium`, `large-v3`. Bigger = more accurate, slower, more RAM |
| `WHISPER_DEVICE` | `cpu` | `cpu` or `cuda` (NVIDIA GPU) |
| `WHISPER_COMPUTE_TYPE` | `int8` | `int8` on CPU, `float16` on GPU |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins if the frontend is hosted elsewhere |

Partial-update timing and the Hinglish hint prompt are in `backend/app/config.py`.

---

## Deployment (cloud)

The app is one container: the API, the WebSocket and the frontend are served together.
Microphone access requires **HTTPS**, which Render, Railway and Cloud Run provide automatically.

### Option A: Render (recommended, free tier available)

**A1. Push the code to GitHub**

```bash
git init
git add .
git commit -m "Speech to text app"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

**A2. Create a PostgreSQL database**
1. Render dashboard → **New → PostgreSQL** → create it.
2. Copy the **Internal Database URL**. It looks like `postgresql://user:pass@host/db`.
3. Change the prefix to `postgresql+psycopg2://` before using it as `DATABASE_URL`.

**A3. Create the web service**
1. **New → Web Service** → connect your GitHub repo.
2. Runtime: **Docker** (Render detects the `Dockerfile`).
3. Instance: at least **1 GB RAM** for the `base` model (`small` needs about 2 GB).
4. Environment variables:
   - `DATABASE_URL` = the PostgreSQL URL from step A2
   - `WHISPER_MODEL` = `base`
5. Deploy. Your app is live at `https://<your-service>.onrender.com`.

### Option B: Railway / Google Cloud Run

Both build the same `Dockerfile`. Set the same environment variables, and use a PostgreSQL
add-on (Railway) or Cloud SQL (Cloud Run). Cloud Run: `gcloud run deploy --source .`

### Run the Docker image locally (optional)

```bash
docker build -t speech-to-text .
docker run -p 8000:8000 -e DATABASE_URL=sqlite:///./transcriptions.db speech-to-text
```

---

## Notes and limitations

- **Hinglish accuracy**: Whisper is multilingual and handles Hindi-English code-switching reasonably well.
  It usually picks one dominant language per window, so very fast switching can be less accurate. The
  `initial_prompt` in `config.py` nudges it towards Hinglish. Use `small` or `medium` for better quality.
- **Latency**: partial text appears about every 2 seconds on CPU. A GPU or a Gemini Live / streaming
  STT API would reduce this.
- **Silence**: Voice activity detection (`vad_filter`) removes most silence, which avoids Whisper's
  habit of hallucinating text such as "Thank you" on quiet audio.
- **Free-tier hosts** can sleep when idle and wake up slowly on the first request.
- **SQLite on cloud hosts** is wiped on redeploy because the disk is not persistent. Use PostgreSQL in production.
- **Text-to-speech** uses the browser's built-in voices (free, no API). Hindi voices depend on the OS.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Mic button does nothing | Use `http://localhost:8000` or HTTPS. Allow the microphone in the browser. |
| `Loading Whisper model` takes forever | First run downloads the model; check your internet connection. |
| Transcript is empty | Speak for at least 2 seconds; check the mic is the right input device. |
| `ModuleNotFoundError: faster_whisper` | Activate the virtual environment and run `pip install -r backend/requirements.txt`. |
| `Address already in use` | Use another port: `uvicorn app.main:app --port 8001`. |
