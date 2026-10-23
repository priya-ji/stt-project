from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .database import get_db
from .models import Transcription
from .schemas import (
    TranscriptionCreate,
    TranscriptionOut,
    TranscriptionPage,
    TranscriptionUpdate,
)

router = APIRouter(prefix="/api/transcriptions", tags=["transcriptions"])


def _get_or_404(db: Session, transcription_id: int) -> Transcription:
    obj = db.get(Transcription, transcription_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Transcription not found")
    return obj


# NOTE: "/stats" must be declared before "/{transcription_id}" so it is not treated as an id.
@router.get("/stats")
def stats(db: Session = Depends(get_db)) -> dict:
    total = db.scalar(select(func.count(Transcription.id))) or 0
    live = db.scalar(select(func.count(Transcription.id)).where(Transcription.source == "live")) or 0
    seconds = db.scalar(select(func.coalesce(func.sum(Transcription.duration_seconds), 0.0))) or 0.0
    words = sum(len(text.split()) for text in db.scalars(select(Transcription.text)))
    return {
        "total": total,
        "live": live,
        "manual": total - live,
        "total_seconds": round(float(seconds), 1),
        "total_words": words,
    }


@router.get("", response_model=TranscriptionPage)
def list_transcriptions(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    q: str | None = Query(None, max_length=200),
    db: Session = Depends(get_db),
) -> TranscriptionPage:
    stmt = select(Transcription)
    count_stmt = select(func.count(Transcription.id))
    if q:
        pattern = f"%{q}%"
        condition = or_(Transcription.title.ilike(pattern), Transcription.text.ilike(pattern))
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    total = db.scalar(count_stmt) or 0
    rows = db.scalars(
        stmt.order_by(Transcription.created_at.desc(), Transcription.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return TranscriptionPage(
        items=[TranscriptionOut.model_validate(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=TranscriptionOut, status_code=201)
def create_transcription(payload: TranscriptionCreate, db: Session = Depends(get_db)):
    obj = Transcription(**payload.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/{transcription_id}", response_model=TranscriptionOut)
def get_transcription(transcription_id: int, db: Session = Depends(get_db)):
    return _get_or_404(db, transcription_id)


@router.put("/{transcription_id}", response_model=TranscriptionOut)
def update_transcription(
    transcription_id: int, payload: TranscriptionUpdate, db: Session = Depends(get_db)
):
    obj = _get_or_404(db, transcription_id)
    changes = payload.model_dump(exclude_unset=True)
    for required in ("title", "text"):
        if changes.get(required) is None:
            changes.pop(required, None)  # these columns cannot be NULL
    for field, value in changes.items():
        setattr(obj, field, value)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{transcription_id}", status_code=204)
def delete_transcription(transcription_id: int, db: Session = Depends(get_db)):
    obj = _get_or_404(db, transcription_id)
    db.delete(obj)
    db.commit()
    return Response(status_code=204)
