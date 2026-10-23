from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TranscriptionCreate(BaseModel):
    title: str = Field(default="Untitled", min_length=1, max_length=200)
    text: str = Field(default="", max_length=100_000)
    language: str | None = Field(default=None, max_length=20)
    source: str = Field(default="manual", pattern="^(live|manual)$")
    duration_seconds: float = Field(default=0.0, ge=0)


class TranscriptionUpdate(BaseModel):
    """Only the fields that are sent get changed (PATCH-like behaviour on PUT)."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    text: str | None = Field(default=None, max_length=100_000)
    language: str | None = Field(default=None, max_length=20)


class TranscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    text: str
    language: str | None
    source: str
    duration_seconds: float
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at", mode="after")
    @classmethod
    def _assume_utc(cls, value: datetime) -> datetime:
        # SQLite returns naive datetimes; mark them as UTC so the browser converts them correctly.
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class TranscriptionPage(BaseModel):
    items: list[TranscriptionOut]
    total: int
    page: int
    page_size: int
