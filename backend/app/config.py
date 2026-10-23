from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All settings can be overridden with environment variables or a .env file."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # SQLite for local dev. For production use PostgreSQL, e.g.
    # postgresql+psycopg2://user:password@host:5432/dbname
    database_url: str = "sqlite:///./transcriptions.db"

    # Open-source Whisper model: tiny | base | small | medium | large-v3
    whisper_model: str = "base"
    whisper_device: str = "cpu"          # "cpu" or "cuda"
    whisper_compute_type: str = "int8"   # "int8" on CPU, "float16" on GPU

    # Biases Whisper towards Hinglish (Hindi + English mixed) speech.
    initial_prompt: str = (
        "Yeh ek Hindi aur English ka mix hai. This is a conversation in Hindi and English."
    )

    # Streaming behaviour
    partial_interval_sec: float = 2.0   # how often we send a live update
    max_window_sec: float = 20.0        # audio longer than this is locked in and a new window starts

    cors_origins: str = "*"


settings = Settings()
