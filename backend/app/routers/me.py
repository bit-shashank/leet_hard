from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app import auth
from app.db import get_db
from app.models import Participant, ParticipantSolve, Room, RoomStatus, User
from app.schemas import DashboardResponse, DashboardRoomItem, MeResponse, UpdateMeRequest
from app.security import get_current_user

router = APIRouter(prefix='/me', tags=['me'])


def _coerce_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _room_rank_map(db: Session, room_id: str) -> dict[str, int]:
    stmt = (
        select(
            Participant.id,
            Participant.joined_at,
            func.count(ParticipantSolve.id).label('solved_count'),
            func.max(ParticipantSolve.first_solved_at).label('last_solved_at'),
        )
        .outerjoin(
            ParticipantSolve,
            and_(
                ParticipantSolve.room_id == room_id,
                ParticipantSolve.participant_id == Participant.id,
            ),
        )
        .where(Participant.room_id == room_id)
        .group_by(Participant.id)
    )
    rows = db.execute(stmt).all()

    def sort_key(row):
        solved_count = int(row.solved_count or 0)
        last_solved_at = row.last_solved_at or datetime.max.replace(tzinfo=timezone.utc)
        joined_at = row.joined_at or datetime.max.replace(tzinfo=timezone.utc)
        return (-solved_count, _coerce_utc(last_solved_at), _coerce_utc(joined_at))

    sorted_rows = sorted(rows, key=sort_key)
    return {row.id: index for index, row in enumerate(sorted_rows, start=1)}


@router.get('', response_model=MeResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return MeResponse(
        id=current_user.id,
        email=current_user.email,
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
        primary_leetcode_username=current_user.primary_leetcode_username,
        profile_complete=bool(current_user.primary_leetcode_username),
    )


@router.patch('', response_model=MeResponse)
def update_me(
    payload: UpdateMeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    dirty = False

    if payload.display_name is not None and payload.display_name != current_user.display_name:
        current_user.display_name = payload.display_name
        dirty = True

    if payload.primary_leetcode_username is not None:
        normalized = auth.normalize_leetcode_username(payload.primary_leetcode_username)
        if not normalized:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='Invalid primary LeetCode username',
            )
        if normalized != current_user.primary_leetcode_username:
            current_user.primary_leetcode_username = normalized
            dirty = True

    if dirty:
        db.commit()
        db.refresh(current_user)

    return MeResponse(
        id=current_user.id,
        email=current_user.email,
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
        primary_leetcode_username=current_user.primary_leetcode_username,
        profile_complete=bool(current_user.primary_leetcode_username),
    )


@router.get('/dashboard', response_model=DashboardResponse)
def get_dashboard(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    participants = db.scalars(
        select(Participant)
        .where(Participant.user_id == current_user.id)
        .order_by(Participant.joined_at.desc())
    ).all()

    rooms_joined = len(participants)
    rooms_created = sum(1 for participant in participants if participant.is_host)

    total_solves = int(
        db.scalar(
            select(func.count(ParticipantSolve.id))
            .join(Participant, Participant.id == ParticipantSolve.participant_id)
            .where(Participant.user_id == current_user.id)
        )
        or 0
    )

    room_ids = [participant.room_id for participant in participants]
    rooms_by_id: dict[str, Room] = {}
    if room_ids:
        rooms = db.scalars(select(Room).where(Room.id.in_(room_ids))).all()
        rooms_by_id = {room.id: room for room in rooms}

    rank_cache: dict[str, dict[str, int]] = {}
    wins = 0
    ended_ranks: list[int] = []
    recent_rooms: list[DashboardRoomItem] = []

    for participant in participants[:20]:
        room = rooms_by_id.get(participant.room_id)
        if room is None:
            continue

        my_rank = None
        if room.status == RoomStatus.ENDED:
            if room.id not in rank_cache:
                rank_cache[room.id] = _room_rank_map(db, room.id)
            my_rank = rank_cache[room.id].get(participant.id)
            if my_rank is not None:
                ended_ranks.append(my_rank)
                if my_rank == 1:
                    wins += 1

        my_solved_count = int(
            db.scalar(
                select(func.count(ParticipantSolve.id)).where(
                    ParticipantSolve.room_id == room.id,
                    ParticipantSolve.participant_id == participant.id,
                )
            )
            or 0
        )

        recent_rooms.append(
            DashboardRoomItem(
                room_code=room.room_code,
                room_title=room.room_title,
                status=room.status,
                joined_at=participant.joined_at,
                my_rank=my_rank,
                my_solved_count=my_solved_count,
                starts_at=room.starts_at,
                ends_at=room.ends_at,
            )
        )

    avg_rank = None
    if ended_ranks:
        avg_rank = round(sum(ended_ranks) / len(ended_ranks), 2)

    return DashboardResponse(
        rooms_created=rooms_created,
        rooms_joined=rooms_joined,
        wins=wins,
        total_solves=total_solves,
        avg_rank=avg_rank,
        recent_rooms=recent_rooms,
    )
