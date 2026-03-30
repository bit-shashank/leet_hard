from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    AdminActionLog,
    FeaturedRoom,
    Participant,
    Room,
    RoomStatus,
    User,
    UserAccountStatus,
    UserRole,
)
from app.schemas import (
    AdminActionLogItem,
    AdminFeaturedRoomItem,
    AdminFeaturedRoomUpsertRequest,
    AdminRoomItem,
    AdminRoomUpdateRequest,
    AdminUserItem,
    AdminUserUpdateRequest,
)
from app.security import require_admin

router = APIRouter(prefix='/admin', tags=['admin'])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_room_code(room_code: str) -> str:
    return room_code.strip().upper()


def _log_admin_action(
    db: Session,
    *,
    actor: User,
    action: str,
    resource_type: str,
    resource_id: Optional[str],
    details: Optional[dict] = None,
) -> None:
    db.add(
        AdminActionLog(
            actor_user_id=actor.id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details or {},
        )
    )


def _featured_item(featured: FeaturedRoom, room: Room, now: datetime) -> AdminFeaturedRoomItem:
    starts_at = _coerce_utc(featured.starts_at)
    ends_at = _coerce_utc(featured.ends_at)
    is_currently_featured = featured.is_active and (
        (starts_at is None or starts_at <= now) and (ends_at is None or ends_at > now)
    )
    return AdminFeaturedRoomItem(
        room_code=room.room_code,
        room_title=room.room_title,
        room_status=room.status,
        scheduled_start_at=_coerce_utc(room.scheduled_start_at),
        priority=featured.priority,
        starts_at=starts_at,
        ends_at=ends_at,
        is_active=featured.is_active,
        is_currently_featured=is_currently_featured,
    )


def _get_room_or_404(db: Session, room_code: str) -> Room:
    normalized = _normalize_room_code(room_code)
    room = db.scalar(select(Room).where(Room.room_code == normalized))
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Room not found')
    return room


@router.get('/featured-rooms', response_model=list[AdminFeaturedRoomItem])
def list_featured_rooms(
    state: str = Query(default='all'),
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    now = _utcnow()
    rows = db.execute(
        select(FeaturedRoom, Room)
        .join(Room, Room.id == FeaturedRoom.room_id)
        .order_by(FeaturedRoom.priority.asc(), FeaturedRoom.created_at.desc())
    ).all()

    normalized_state = state.strip().lower()
    if normalized_state not in {'all', 'active', 'scheduled', 'expired'}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='state must be one of: all, active, scheduled, expired',
        )

    items: list[AdminFeaturedRoomItem] = []
    for featured, room in rows:
        item = _featured_item(featured, room, now)
        starts_at = _coerce_utc(featured.starts_at)
        ends_at = _coerce_utc(featured.ends_at)
        is_scheduled = featured.is_active and starts_at is not None and starts_at > now
        is_expired = (not featured.is_active) or (ends_at is not None and ends_at <= now)

        if normalized_state == 'active' and not item.is_currently_featured:
            continue
        if normalized_state == 'scheduled' and not is_scheduled:
            continue
        if normalized_state == 'expired' and not is_expired:
            continue

        items.append(item)
    return items


@router.post('/featured-rooms', response_model=AdminFeaturedRoomItem)
def upsert_featured_room(
    payload: AdminFeaturedRoomUpsertRequest,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(db, payload.room_code)
    featured = db.scalar(select(FeaturedRoom).where(FeaturedRoom.room_id == room.id))
    now = _utcnow()
    before = {}
    if featured:
        before = {
            'priority': featured.priority,
            'starts_at': _coerce_utc(featured.starts_at).isoformat() if featured.starts_at else None,
            'ends_at': _coerce_utc(featured.ends_at).isoformat() if featured.ends_at else None,
            'is_active': featured.is_active,
        }
        featured.priority = payload.priority
        featured.starts_at = payload.starts_at
        featured.ends_at = payload.ends_at
        featured.is_active = payload.is_active
    else:
        featured = FeaturedRoom(
            room_id=room.id,
            priority=payload.priority,
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            is_active=payload.is_active,
            created_by=admin_user.id,
        )
        db.add(featured)

    _log_admin_action(
        db,
        actor=admin_user,
        action='featured_room_upsert',
        resource_type='room',
        resource_id=room.id,
        details={
            'room_code': room.room_code,
            'before': before,
            'after': {
                'priority': payload.priority,
                'starts_at': payload.starts_at.isoformat() if payload.starts_at else None,
                'ends_at': payload.ends_at.isoformat() if payload.ends_at else None,
                'is_active': payload.is_active,
            },
        },
    )
    db.commit()
    db.refresh(featured)
    return _featured_item(featured, room, now)


@router.delete('/featured-rooms/{room_code}', status_code=status.HTTP_204_NO_CONTENT)
def delete_featured_room(
    room_code: str,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(db, room_code)
    featured = db.scalar(select(FeaturedRoom).where(FeaturedRoom.room_id == room.id))
    if featured is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Featured room entry not found')
    db.delete(featured)
    _log_admin_action(
        db,
        actor=admin_user,
        action='featured_room_delete',
        resource_type='room',
        resource_id=room.id,
        details={'room_code': room.room_code},
    )
    db.commit()
    return None


def _parse_status_filters(statuses: str) -> list[RoomStatus]:
    values = [value.strip().lower() for value in statuses.split(',') if value.strip()]
    if not values:
        return [RoomStatus.LOBBY, RoomStatus.ACTIVE, RoomStatus.ENDED]
    allowed = {status.value for status in RoomStatus}
    invalid = [value for value in values if value not in allowed]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'Invalid status filters: {", ".join(sorted(set(invalid)))}',
        )
    return [RoomStatus(value) for value in values]


@router.get('/rooms', response_model=list[AdminRoomItem])
def list_admin_rooms(
    statuses: str = Query(default='lobby,active,ended'),
    search: Optional[str] = Query(default=None),
    created_from: Optional[datetime] = Query(default=None),
    created_to: Optional[datetime] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stmt = select(Room).where(Room.status.in_(_parse_status_filters(statuses)))
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(or_(Room.room_code.ilike(q), Room.room_title.ilike(q)))
    if created_from:
        stmt = stmt.where(Room.created_at >= _coerce_utc(created_from))
    if created_to:
        stmt = stmt.where(Room.created_at <= _coerce_utc(created_to))
    rooms = db.scalars(stmt.order_by(Room.created_at.desc()).limit(limit)).all()

    if not rooms:
        return []

    room_ids = [room.id for room in rooms]
    participant_counts = {
        room_id: count
        for room_id, count in db.execute(
            select(Participant.room_id, func.count(Participant.id))
            .where(Participant.room_id.in_(room_ids))
            .group_by(Participant.room_id)
        ).all()
    }
    featured_by_room = {
        row.room_id: row
        for row in db.scalars(select(FeaturedRoom).where(FeaturedRoom.room_id.in_(room_ids))).all()
    }
    now = _utcnow()

    items: list[AdminRoomItem] = []
    for room in rooms:
        featured = featured_by_room.get(room.id)
        is_featured = False
        featured_priority = None
        if featured:
            starts_at = _coerce_utc(featured.starts_at)
            ends_at = _coerce_utc(featured.ends_at)
            is_featured = featured.is_active and (
                (starts_at is None or starts_at <= now) and (ends_at is None or ends_at > now)
            )
            featured_priority = featured.priority

        items.append(
            AdminRoomItem(
                room_code=room.room_code,
                room_title=room.room_title,
                status=room.status,
                scheduled_start_at=_coerce_utc(room.scheduled_start_at),
                starts_at=_coerce_utc(room.starts_at),
                ends_at=_coerce_utc(room.ends_at),
                created_at=_coerce_utc(room.created_at),
                participant_count=int(participant_counts.get(room.id, 0)),
                is_joinable=room.is_joinable,
                is_featured=is_featured,
                featured_priority=featured_priority,
            )
        )
    return items


@router.patch('/rooms/{room_code}', response_model=AdminRoomItem)
def update_admin_room(
    room_code: str,
    payload: AdminRoomUpdateRequest,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(db, room_code)
    before = {
        'room_title': room.room_title,
        'scheduled_start_at': _coerce_utc(room.scheduled_start_at).isoformat() if room.scheduled_start_at else None,
        'status': room.status.value,
        'is_joinable': room.is_joinable,
    }

    if payload.room_title is not None:
        room.room_title = payload.room_title
    if payload.scheduled_start_at is not None:
        room.scheduled_start_at = payload.scheduled_start_at
    if payload.is_joinable is not None:
        room.is_joinable = payload.is_joinable

    if payload.status is not None and payload.status != room.status:
        if room.status == RoomStatus.ENDED and payload.status != RoomStatus.ENDED:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='Ended rooms cannot be moved back to lobby/active',
            )
        if room.status == RoomStatus.ACTIVE and payload.status == RoomStatus.LOBBY:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='Active rooms cannot be moved back to lobby',
            )

        now = _utcnow()
        if payload.status == RoomStatus.ACTIVE:
            room.status = RoomStatus.ACTIVE
            if room.starts_at is None:
                room.starts_at = now
            if room.ends_at is None:
                room.ends_at = now + timedelta(minutes=room.duration_minutes)
        elif payload.status == RoomStatus.ENDED:
            room.status = RoomStatus.ENDED
            if room.starts_at is None:
                room.starts_at = now
            room.ends_at = now
        elif payload.status == RoomStatus.LOBBY:
            room.status = RoomStatus.LOBBY
            room.starts_at = None
            room.ends_at = None

    _log_admin_action(
        db,
        actor=admin_user,
        action='room_update',
        resource_type='room',
        resource_id=room.id,
        details={
            'room_code': room.room_code,
            'before': before,
            'after': {
                'room_title': room.room_title,
                'scheduled_start_at': _coerce_utc(room.scheduled_start_at).isoformat() if room.scheduled_start_at else None,
                'status': room.status.value,
                'is_joinable': room.is_joinable,
            },
        },
    )

    db.commit()
    db.refresh(room)

    participant_count = db.scalar(
        select(func.count(Participant.id)).where(Participant.room_id == room.id)
    )
    featured = db.scalar(select(FeaturedRoom).where(FeaturedRoom.room_id == room.id))
    now = _utcnow()
    is_featured = False
    featured_priority = None
    if featured:
        starts_at = _coerce_utc(featured.starts_at)
        ends_at = _coerce_utc(featured.ends_at)
        is_featured = featured.is_active and (
            (starts_at is None or starts_at <= now) and (ends_at is None or ends_at > now)
        )
        featured_priority = featured.priority

    return AdminRoomItem(
        room_code=room.room_code,
        room_title=room.room_title,
        status=room.status,
        scheduled_start_at=_coerce_utc(room.scheduled_start_at),
        starts_at=_coerce_utc(room.starts_at),
        ends_at=_coerce_utc(room.ends_at),
        created_at=_coerce_utc(room.created_at),
        participant_count=int(participant_count or 0),
        is_joinable=room.is_joinable,
        is_featured=is_featured,
        featured_priority=featured_priority,
    )


@router.get('/users', response_model=list[AdminUserItem])
def list_admin_users(
    search: Optional[str] = Query(default=None),
    role: Optional[UserRole] = Query(default=None),
    account_status: Optional[UserAccountStatus] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=300),
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stmt = select(User)
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                User.email.ilike(q),
                User.display_name.ilike(q),
                User.primary_leetcode_username.ilike(q),
                User.id.ilike(q),
            )
        )
    if role is not None:
        stmt = stmt.where(User.role == role)
    if account_status is not None:
        stmt = stmt.where(User.account_status == account_status)
    users = db.scalars(stmt.order_by(User.created_at.desc()).limit(limit)).all()
    return [
        AdminUserItem(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            primary_leetcode_username=user.primary_leetcode_username,
            role=user.role,
            account_status=user.account_status,
            created_at=_coerce_utc(user.created_at),
            updated_at=_coerce_utc(user.updated_at),
        )
        for user in users
    ]


@router.patch('/users/{user_id}', response_model=AdminUserItem)
def update_admin_user(
    user_id: str,
    payload: AdminUserUpdateRequest,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    target = db.scalar(select(User).where(User.id == user_id))
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')

    before = {
        'role': target.role.value,
        'account_status': target.account_status.value,
    }

    if payload.role is not None and payload.role != target.role:
        if target.id == admin_user.id and payload.role != UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='You cannot remove your own admin role',
            )
        if target.role == UserRole.ADMIN and payload.role != UserRole.ADMIN:
            admin_count = db.scalar(select(func.count()).where(User.role == UserRole.ADMIN)) or 0
            if admin_count <= 1:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail='At least one admin user must remain',
                )
        target.role = payload.role

    if payload.account_status is not None:
        target.account_status = payload.account_status

    _log_admin_action(
        db,
        actor=admin_user,
        action='user_update',
        resource_type='user',
        resource_id=target.id,
        details={
            'before': before,
            'after': {
                'role': target.role.value,
                'account_status': target.account_status.value,
            },
        },
    )
    db.commit()
    db.refresh(target)

    return AdminUserItem(
        id=target.id,
        email=target.email,
        display_name=target.display_name,
        primary_leetcode_username=target.primary_leetcode_username,
        role=target.role,
        account_status=target.account_status,
        created_at=_coerce_utc(target.created_at),
        updated_at=_coerce_utc(target.updated_at),
    )


@router.get('/logs', response_model=list[AdminActionLogItem])
def list_admin_logs(
    limit: int = Query(default=100, ge=1, le=500),
    action: Optional[str] = Query(default=None),
    resource_type: Optional[str] = Query(default=None),
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stmt = (
        select(AdminActionLog, User)
        .outerjoin(User, User.id == AdminActionLog.actor_user_id)
        .order_by(AdminActionLog.created_at.desc())
        .limit(limit)
    )
    if action and action.strip():
        stmt = stmt.where(AdminActionLog.action == action.strip())
    if resource_type and resource_type.strip():
        stmt = stmt.where(AdminActionLog.resource_type == resource_type.strip())

    rows = db.execute(stmt).all()
    items: list[AdminActionLogItem] = []
    for log, actor in rows:
        items.append(
            AdminActionLogItem(
                id=log.id,
                actor_user_id=log.actor_user_id,
                actor_email=actor.email if actor else None,
                action=log.action,
                resource_type=log.resource_type,
                resource_id=log.resource_id,
                details=log.details or {},
                created_at=_coerce_utc(log.created_at),
            )
        )
    return items
