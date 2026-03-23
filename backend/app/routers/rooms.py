from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import auth
from app.config import get_settings
from app.db import get_db
from app.models import (
    Participant,
    ParticipantSolve,
    ProblemSource,
    Room,
    RoomProblem,
    RoomStatus,
    SolveEvent,
    SolveEventType,
    SolveSource,
    User,
)
from app.security import get_current_user
from app.schemas import (
    CreateRoomRequest,
    CreateRoomResponse,
    DiscoverRoomResponse,
    HistoryEvent,
    HistoryResponse,
    JoinRoomRequest,
    JoinRoomResponse,
    LeaderboardEntry,
    ManualSolveRequest,
    ManualSolveResponse,
    ParticipantPublic,
    ProblemPublic,
    RoomPublic,
    RoomStateResponse,
    StartRoomResponse,
    UpdateRoomSettingsRequest,
    UpdateRoomSettingsResponse,
)
from app.services.leetcode import (
    LeetCodeServiceError,
    ProblemSelectionError,
    choose_random_problems_by_source,
    get_recent_submissions,
    get_user_avatar_url,
)

router = APIRouter(prefix='/rooms', tags=['rooms'])


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


def _is_room_joinable(room: Room) -> bool:
    if room.status not in (RoomStatus.LOBBY, RoomStatus.ACTIVE):
        return False
    if room.status == RoomStatus.ACTIVE and room.ends_at and _coerce_utc(room.ends_at) <= _utcnow():
        return False
    return True


def _room_to_public(room: Room) -> RoomPublic:
    return RoomPublic(
        id=room.id,
        room_code=room.room_code,
        room_title=room.room_title,
        status=room.status,
        problem_source=room.problem_source,
        problem_count=room.problem_count,
        easy_count=room.easy_count,
        medium_count=room.medium_count,
        hard_count=room.hard_count,
        strict_check=room.strict_check,
        duration_minutes=room.duration_minutes,
        scheduled_start_at=room.scheduled_start_at,
        starts_at=room.starts_at,
        ends_at=room.ends_at,
        created_at=room.created_at,
        has_passcode=bool(room.passcode_hash),
        sync_warning=room.sync_warning,
    )


def _participant_to_public(participant: Participant) -> ParticipantPublic:
    return ParticipantPublic(
        id=participant.id,
        leetcode_username=participant.leetcode_username,
        avatar_url=participant.avatar_url,
        is_host=participant.is_host,
        joined_at=participant.joined_at,
    )


def _problem_to_public(problem: RoomProblem) -> ProblemPublic:
    return ProblemPublic(
        title_slug=problem.title_slug,
        title=problem.title,
        frontend_id=problem.frontend_id,
        url=problem.url,
        difficulty=problem.difficulty,
        sort_order=problem.sort_order,
    )


def _get_room_or_404(db: Session, room_code: str) -> Room:
    normalized = _normalize_room_code(room_code)
    room = db.scalar(select(Room).where(Room.room_code == normalized))
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Room not found')
    return room


def _update_room_status_if_expired(room: Room) -> bool:
    if room.status == RoomStatus.ACTIVE and room.ends_at and _coerce_utc(room.ends_at) <= _utcnow():
        room.status = RoomStatus.ENDED
        return True
    return False


def _get_participant_for_user(
    db: Session,
    room: Room,
    user_id: str,
    required: bool,
) -> Optional[Participant]:
    participant = db.scalar(
        select(Participant).where(
            Participant.room_id == room.id,
            Participant.user_id == user_id,
        )
    )
    if not participant and required:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='You are not a participant in this room',
        )
    return participant


def _require_primary_leetcode_username(current_user: User) -> str:
    username = auth.normalize_leetcode_username(current_user.primary_leetcode_username or '')
    if not username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Set your primary LeetCode username in profile before creating or joining rooms',
        )
    return username


def _maybe_refresh_participant_avatar(db: Session, participant: Participant, force: bool = False) -> bool:
    settings = get_settings()
    now = _utcnow()
    current_synced_at = _coerce_utc(participant.avatar_synced_at)

    should_refresh = force or participant.avatar_url is None
    if not should_refresh and current_synced_at is not None:
        elapsed = (now - current_synced_at).total_seconds()
        should_refresh = elapsed >= settings.avatar_sync_ttl_seconds

    if not should_refresh:
        return False

    original_avatar = participant.avatar_url
    original_synced = current_synced_at

    try:
        avatar_url = get_user_avatar_url(participant.leetcode_username)
    except LeetCodeServiceError:
        participant.avatar_synced_at = now
        return _coerce_utc(participant.avatar_synced_at) != original_synced

    participant.avatar_synced_at = now
    if avatar_url:
        participant.avatar_url = avatar_url

    return (
        participant.avatar_url != original_avatar
        or _coerce_utc(participant.avatar_synced_at) != original_synced
    )


def _refresh_room_participant_avatars(db: Session, room: Room) -> bool:
    participants = db.scalars(select(Participant).where(Participant.room_id == room.id)).all()
    dirty = False
    for participant in participants:
        if _maybe_refresh_participant_avatar(db, participant):
            dirty = True
    return dirty


def _build_leaderboard(db: Session, room: Room) -> list[LeaderboardEntry]:
    stmt = (
        select(
            Participant.id,
            Participant.leetcode_username,
            Participant.avatar_url,
            Participant.is_host,
            Participant.joined_at,
            func.count(ParticipantSolve.id).label('solved_count'),
            func.max(ParticipantSolve.first_solved_at).label('last_solved_at'),
        )
        .outerjoin(
            ParticipantSolve,
            and_(
                ParticipantSolve.room_id == room.id,
                ParticipantSolve.participant_id == Participant.id,
            ),
        )
        .where(Participant.room_id == room.id)
        .group_by(Participant.id)
    )

    rows = db.execute(stmt).all()

    def sort_key(row):
        solved_count = int(row.solved_count or 0)
        last_solved_at = row.last_solved_at or datetime.max.replace(tzinfo=timezone.utc)
        last_solved_at = _coerce_utc(last_solved_at)
        joined_at = _coerce_utc(row.joined_at) or datetime.max.replace(tzinfo=timezone.utc)
        return (-solved_count, last_solved_at, joined_at)

    sorted_rows = sorted(rows, key=sort_key)

    leaderboard: list[LeaderboardEntry] = []
    for index, row in enumerate(sorted_rows, start=1):
        leaderboard.append(
            LeaderboardEntry(
                rank=index,
                participant_id=row.id,
                leetcode_username=row.leetcode_username,
                avatar_url=row.avatar_url,
                is_host=row.is_host,
                solved_count=int(row.solved_count or 0),
                last_solved_at=row.last_solved_at,
            )
        )
    return leaderboard


def _ensure_problem_in_room(db: Session, room: Room, problem_slug: str) -> None:
    exists = db.scalar(
        select(RoomProblem.id).where(
            RoomProblem.room_id == room.id,
            RoomProblem.title_slug == problem_slug,
        )
    )
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Problem does not belong to this room challenge set',
        )


def _upsert_auto_solve(
    db: Session,
    room: Room,
    participant: Participant,
    problem_slug: str,
    solved_at: datetime,
) -> bool:
    existing = db.scalar(
        select(ParticipantSolve).where(
            ParticipantSolve.room_id == room.id,
            ParticipantSolve.participant_id == participant.id,
            ParticipantSolve.problem_slug == problem_slug,
        )
    )

    if existing is None:
        db.add(
            ParticipantSolve(
                room_id=room.id,
                participant_id=participant.id,
                problem_slug=problem_slug,
                first_solved_at=solved_at,
                source=SolveSource.AUTO,
            )
        )
        db.add(
            SolveEvent(
                room_id=room.id,
                participant_id=participant.id,
                problem_slug=problem_slug,
                event_type=SolveEventType.AUTO_DETECTED,
                source=SolveSource.AUTO,
                event_at=solved_at,
            )
        )
        return True

    updated = False
    if solved_at < _coerce_utc(existing.first_solved_at):
        existing.first_solved_at = solved_at
        existing.source = SolveSource.AUTO
        updated = True
    elif existing.source == SolveSource.MANUAL:
        existing.source = SolveSource.AUTO
        updated = True

    if updated:
        db.add(
            SolveEvent(
                room_id=room.id,
                participant_id=participant.id,
                problem_slug=problem_slug,
                event_type=SolveEventType.AUTO_DETECTED,
                source=SolveSource.AUTO,
                event_at=solved_at,
            )
        )

    return updated


def _participant_solve_window(room: Room, participant: Participant) -> tuple[Optional[datetime], Optional[datetime]]:
    room_starts_at = _coerce_utc(room.starts_at)
    room_ends_at = _coerce_utc(room.ends_at)
    participant_joined_at = _coerce_utc(participant.joined_at)

    solve_window_start = room_starts_at
    if participant_joined_at is not None:
        if solve_window_start is None or participant_joined_at > solve_window_start:
            solve_window_start = participant_joined_at

    return solve_window_start, room_ends_at


def _match_accepted_submission_time(
    submission: dict,
    problem_slug: str,
    solve_window_start: Optional[datetime],
    solve_window_end: Optional[datetime],
) -> Optional[datetime]:
    status_display = submission.get('statusDisplay')
    status_code = submission.get('status')
    is_accepted = status_display == 'Accepted' or status_code == 10
    if not is_accepted:
        return None

    slug = submission.get('titleSlug') or submission.get('title_slug')
    if not slug or slug != problem_slug:
        return None

    raw_ts = submission.get('timestamp')
    if raw_ts is None:
        return None

    try:
        solved_at = datetime.fromtimestamp(int(raw_ts), tz=timezone.utc)
    except (TypeError, ValueError):
        return None

    if solve_window_start and solved_at < solve_window_start:
        return None
    if solve_window_end and solved_at > solve_window_end:
        return None

    return solved_at


def _get_strict_verified_solve_time(room: Room, participant: Participant, problem_slug: str) -> datetime:
    solve_window_start, solve_window_end = _participant_solve_window(room, participant)

    try:
        submissions = get_recent_submissions(participant.leetcode_username, limit=100)
    except LeetCodeServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'Strict verification unavailable right now: {exc}',
        )

    matches: list[datetime] = []
    for submission in submissions:
        solved_at = _match_accepted_submission_time(
            submission=submission,
            problem_slug=problem_slug,
            solve_window_start=solve_window_start,
            solve_window_end=solve_window_end,
        )
        if solved_at is not None:
            matches.append(solved_at)

    if not matches:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                'Strict verification failed: no accepted submission found for this problem '
                'in your contest window.'
            ),
        )

    return min(matches)


def _sync_room_solves(db: Session, room: Room) -> None:
    if room.status != RoomStatus.ACTIVE:
        return

    now = _utcnow()
    problem_slugs = set(
        db.scalars(select(RoomProblem.title_slug).where(RoomProblem.room_id == room.id)).all()
    )
    if not problem_slugs:
        room.last_synced_at = now
        return

    participants = db.scalars(select(Participant).where(Participant.room_id == room.id)).all()
    errors: list[str] = []

    for participant in participants:
        solve_window_start, solve_window_end = _participant_solve_window(room, participant)

        try:
            submissions = get_recent_submissions(participant.leetcode_username, limit=100)
        except LeetCodeServiceError as exc:
            errors.append(f'{participant.leetcode_username}: {exc}')
            continue

        for submission in submissions:
            problem_slug = submission.get('titleSlug') or submission.get('title_slug')
            if not problem_slug or problem_slug not in problem_slugs:
                continue

            solved_at = _match_accepted_submission_time(
                submission=submission,
                problem_slug=problem_slug,
                solve_window_start=solve_window_start,
                solve_window_end=solve_window_end,
            )
            if solved_at is None:
                continue

            _upsert_auto_solve(db, room, participant, problem_slug, solved_at)

    room.last_synced_at = now
    room.sync_warning = None
    if errors:
        room.sync_warning = (
            'Auto sync partial: manual fallback is available. '
            + '; '.join(errors[:3])
        )


def _activate_room(db: Session, room: Room, now: Optional[datetime] = None) -> None:
    if room.status != RoomStatus.LOBBY:
        return

    if now is None:
        now = _utcnow()

    problem_source = room.problem_source
    if isinstance(problem_source, str):
        problem_source = ProblemSource(problem_source)

    selected = choose_random_problems_by_source(
        problem_source,
        easy_count=room.easy_count,
        medium_count=room.medium_count,
        hard_count=room.hard_count,
    )

    room.starts_at = now
    room.ends_at = now + timedelta(minutes=room.duration_minutes)
    room.status = RoomStatus.ACTIVE
    room.last_synced_at = None
    room.sync_warning = None

    for order, problem in enumerate(selected, start=1):
        slug = problem.get('title_slug') or problem.get('titleSlug')
        db.add(
            RoomProblem(
                room_id=room.id,
                title_slug=slug,
                title=problem.get('title') or slug or 'Untitled Problem',
                frontend_id=(str(problem.get('frontend_id')) if problem.get('frontend_id') else None),
                url=problem.get('url') or f"https://leetcode.com/problems/{slug}/",
                difficulty=problem.get('difficulty', 'Medium'),
                sort_order=order,
            )
        )


def _maybe_auto_start_room(db: Session, room: Room) -> bool:
    if room.status != RoomStatus.LOBBY:
        return False

    scheduled_start_at = _coerce_utc(room.scheduled_start_at)
    now = _utcnow()
    if scheduled_start_at is None or scheduled_start_at > now:
        return False

    try:
        _activate_room(db, room, now=now)
    except ProblemSelectionError as exc:
        room.sync_warning = f'Auto-start failed: {exc}'
        return True
    except LeetCodeServiceError as exc:
        room.sync_warning = f'Auto-start failed: {exc}'
        return True

    return True


def _build_room_state(
    db: Session,
    room: Room,
    participant: Optional[Participant],
) -> RoomStateResponse:
    participants = db.scalars(
        select(Participant)
        .where(Participant.room_id == room.id)
        .order_by(Participant.joined_at.asc())
    ).all()

    problems = db.scalars(
        select(RoomProblem)
        .where(RoomProblem.room_id == room.id)
        .order_by(RoomProblem.sort_order.asc())
    ).all()

    my_solved_slugs: list[str] = []
    if participant is not None:
        my_solved_slugs = db.scalars(
            select(ParticipantSolve.problem_slug).where(
                ParticipantSolve.room_id == room.id,
                ParticipantSolve.participant_id == participant.id,
            )
        ).all()

    return RoomStateResponse(
        room=_room_to_public(room),
        participants=[_participant_to_public(p) for p in participants],
        problems=[_problem_to_public(problem) for problem in problems],
        leaderboard=_build_leaderboard(db, room),
        my_participant_id=participant.id if participant else None,
        my_solved_slugs=my_solved_slugs,
        server_time=_utcnow(),
    )


def _parse_status_filters(statuses: str) -> list[RoomStatus]:
    values = [value.strip().lower() for value in statuses.split(',') if value.strip()]
    if not values:
        values = ['lobby', 'active']

    allowed = {status.value for status in RoomStatus}
    invalid = [value for value in values if value not in allowed]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'Invalid status filters: {", ".join(sorted(set(invalid)))}',
        )

    return [RoomStatus(value) for value in values]


@router.get('/discover', response_model=list[DiscoverRoomResponse])
def discover_rooms(
    statuses: str = Query(default='lobby,active'),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    requested_statuses = _parse_status_filters(statuses)

    stmt = (
        select(Room)
        .where(Room.status.in_(requested_statuses))
        .order_by(
            case((Room.status == RoomStatus.ACTIVE, 0), (Room.status == RoomStatus.LOBBY, 1), else_=2),
            Room.created_at.desc(),
        )
    )
    rooms = db.scalars(stmt).all()

    dirty = False
    for room in rooms:
        if _maybe_auto_start_room(db, room):
            dirty = True
        if _update_room_status_if_expired(room):
            dirty = True

    if dirty:
        db.commit()
        rooms = db.scalars(stmt).all()

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

    host_ids = [room.host_participant_id for room in rooms if room.host_participant_id]
    hosts = {}
    if host_ids:
        host_rows = db.scalars(select(Participant).where(Participant.id.in_(host_ids))).all()
        for host in host_rows:
            hosts[host.id] = host

        host_dirty = False
        for host in host_rows:
            if _maybe_refresh_participant_avatar(db, host):
                host_dirty = True

        if host_dirty:
            db.commit()

    now = _utcnow()
    discovered: list[DiscoverRoomResponse] = []
    for room in rooms:
        host = hosts.get(room.host_participant_id) if room.host_participant_id else None
        joinable = room.status in (RoomStatus.LOBBY, RoomStatus.ACTIVE)
        if room.status == RoomStatus.ACTIVE and room.ends_at and _coerce_utc(room.ends_at) <= now:
            joinable = False

        discovered.append(
            DiscoverRoomResponse(
                room_code=room.room_code,
                room_title=room.room_title,
                status=room.status,
                problem_source=room.problem_source,
                scheduled_start_at=room.scheduled_start_at,
                starts_at=room.starts_at,
                ends_at=room.ends_at,
                created_at=room.created_at,
                has_passcode=bool(room.passcode_hash),
                easy_count=room.easy_count,
                medium_count=room.medium_count,
                hard_count=room.hard_count,
                participant_count=int(participant_counts.get(room.id, 0)),
                host_leetcode_username=host.leetcode_username if host else None,
                host_avatar_url=host.avatar_url if host else None,
                joinable=joinable,
            )
        )

    return discovered


@router.get('', response_model=list[RoomPublic])
def list_rooms(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rooms = db.scalars(select(Room).order_by(Room.created_at.desc())).all()

    dirty = False
    for room in rooms:
        if _maybe_auto_start_room(db, room):
            dirty = True
        if _update_room_status_if_expired(room):
            dirty = True

    if dirty:
        db.commit()
        for room in rooms:
            db.refresh(room)

    return [_room_to_public(room) for room in rooms]


@router.post('', response_model=CreateRoomResponse, status_code=status.HTTP_201_CREATED)
def create_room(
    payload: CreateRoomRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    username = _require_primary_leetcode_username(current_user)
    room_title = payload.room_title.strip()
    scheduled_start_at = _coerce_utc(payload.settings.start_at)

    if not room_title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid room title')
    if not scheduled_start_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid room start time')

    now = _utcnow()
    if scheduled_start_at < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Room start time must be in the future',
        )

    room_code = None
    for _ in range(20):
        candidate = auth.generate_room_code()
        exists = db.scalar(select(Room.id).where(Room.room_code == candidate))
        if not exists:
            room_code = candidate
            break

    if room_code is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail='Could not generate room code')

    passcode_hash = None
    if payload.settings.passcode:
        passcode_hash = auth.hash_passcode(payload.settings.passcode)

    total_problem_count = payload.settings.easy_count + payload.settings.medium_count + payload.settings.hard_count

    room = Room(
        room_code=room_code,
        room_title=room_title,
        passcode_hash=passcode_hash,
        problem_source=payload.settings.problem_source,
        problem_count=total_problem_count,
        easy_count=payload.settings.easy_count,
        medium_count=payload.settings.medium_count,
        hard_count=payload.settings.hard_count,
        strict_check=payload.settings.strict_check,
        duration_minutes=payload.settings.duration_minutes,
        scheduled_start_at=scheduled_start_at,
        status=RoomStatus.LOBBY,
    )
    db.add(room)
    db.flush()

    host = Participant(
        room_id=room.id,
        user_id=current_user.id,
        nickname=username,
        leetcode_username=username,
        token_hash=auth.hash_token(auth.generate_participant_token()),
        is_host=True,
    )
    db.add(host)
    db.flush()

    _maybe_refresh_participant_avatar(db, host, force=True)

    room.host_participant_id = host.id
    db.commit()
    db.refresh(room)
    db.refresh(host)

    return CreateRoomResponse(
        room=_room_to_public(room),
        participant=_participant_to_public(host),
    )


@router.post('/{room_code}/join', response_model=JoinRoomResponse)
def join_room(
    room_code: str,
    payload: JoinRoomRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(db, room_code)
    username = _require_primary_leetcode_username(current_user)

    room_dirty = False
    if _maybe_auto_start_room(db, room):
        room_dirty = True
    if _update_room_status_if_expired(room):
        room_dirty = True
    if room_dirty:
        db.commit()
        db.refresh(room)

    if room.status == RoomStatus.ENDED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Room has ended. Joining is closed.',
        )

    if not auth.verify_passcode(payload.passcode or '', room.passcode_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid room passcode')

    settings = get_settings()
    participant_count = db.scalar(
        select(func.count(Participant.id)).where(Participant.room_id == room.id)
    )
    if participant_count >= settings.max_participants_per_room:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Room has reached maximum participants',
        )

    existing_for_user = db.scalar(
        select(Participant).where(
            Participant.room_id == room.id,
            Participant.user_id == current_user.id,
        )
    )
    if existing_for_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='You have already joined this room',
        )

    participant = Participant(
        room_id=room.id,
        user_id=current_user.id,
        nickname=username,
        leetcode_username=username,
        token_hash=auth.hash_token(auth.generate_participant_token()),
        is_host=False,
    )
    db.add(participant)
    db.flush()

    _maybe_refresh_participant_avatar(db, participant, force=True)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='LeetCode username already exists in this room',
        )

    db.refresh(participant)

    return JoinRoomResponse(
        room=_room_to_public(room),
        participant=_participant_to_public(participant),
    )


@router.patch('/{room_code}/settings', response_model=UpdateRoomSettingsResponse)
def update_room_settings(
    room_code: str,
    payload: UpdateRoomSettingsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(db, room_code)
    participant = _get_participant_for_user(db, room, current_user.id, required=True)

    if not participant or not participant.is_host:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Only host can update settings')

    now = _utcnow()
    dirty = False
    if _maybe_auto_start_room(db, room):
        dirty = True
    if _update_room_status_if_expired(room):
        dirty = True
    if dirty:
        db.commit()
        db.refresh(room)

    if room.status != RoomStatus.LOBBY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Room settings can be edited only before room starts',
        )

    current_scheduled_start = _coerce_utc(room.scheduled_start_at)
    if current_scheduled_start is not None and current_scheduled_start <= now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Scheduled start time has passed. Settings are locked.',
        )

    room_title = payload.room_title.strip()
    if not room_title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid room title')

    scheduled_start_at = _coerce_utc(payload.settings.start_at)
    if not scheduled_start_at or scheduled_start_at < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Room start time must be in the future',
        )

    total_problem_count = (
        payload.settings.easy_count + payload.settings.medium_count + payload.settings.hard_count
    )

    room.room_title = room_title
    room.problem_source = payload.settings.problem_source
    room.problem_count = total_problem_count
    room.easy_count = payload.settings.easy_count
    room.medium_count = payload.settings.medium_count
    room.hard_count = payload.settings.hard_count
    room.strict_check = payload.settings.strict_check
    room.duration_minutes = payload.settings.duration_minutes
    room.scheduled_start_at = scheduled_start_at
    if payload.settings.passcode is not None:
        room.passcode_hash = auth.hash_passcode(payload.settings.passcode)

    db.commit()
    db.refresh(room)
    return UpdateRoomSettingsResponse(room=_room_to_public(room))


@router.post('/{room_code}/start', response_model=StartRoomResponse)
def start_room(
    room_code: str,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail='Manual start is deprecated. Rooms now auto-start at scheduled time.',
    )


@router.get('/{room_code}/state', response_model=RoomStateResponse)
def get_room_state(
    room_code: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(db, room_code)

    participant = _get_participant_for_user(db, room, current_user.id, required=False)

    dirty = False
    if _maybe_auto_start_room(db, room):
        dirty = True
    if _update_room_status_if_expired(room):
        dirty = True

    if _refresh_room_participant_avatars(db, room):
        dirty = True

    if room.status == RoomStatus.ACTIVE:
        settings = get_settings()
        now = _utcnow()
        last_synced_at = _coerce_utc(room.last_synced_at)
        should_sync = (
            last_synced_at is None
            or (now - last_synced_at).total_seconds() >= settings.sync_interval_seconds
        )

        if should_sync:
            _sync_room_solves(db, room)
            dirty = True

    if _update_room_status_if_expired(room):
        dirty = True

    if dirty:
        db.commit()
        db.refresh(room)

    return _build_room_state(db, room, participant)


@router.post('/{room_code}/solves/manual', response_model=ManualSolveResponse)
def toggle_manual_solve(
    room_code: str,
    payload: ManualSolveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(db, room_code)
    participant = _get_participant_for_user(db, room, current_user.id, required=True)
    if not participant:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Unauthorized')

    if room.status != RoomStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Manual updates are allowed only while room is active',
        )

    if _update_room_status_if_expired(room):
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Room has ended. Manual updates are disabled.',
        )

    _ensure_problem_in_room(db, room, payload.problem_slug)

    existing = db.scalar(
        select(ParticipantSolve).where(
            ParticipantSolve.room_id == room.id,
            ParticipantSolve.participant_id == participant.id,
            ParticipantSolve.problem_slug == payload.problem_slug,
        )
    )

    now = _utcnow()
    solved_at = now
    if payload.solved and room.strict_check:
        solved_at = _get_strict_verified_solve_time(room, participant, payload.problem_slug)

    if payload.solved:
        if existing is None:
            db.add(
                ParticipantSolve(
                    room_id=room.id,
                    participant_id=participant.id,
                    problem_slug=payload.problem_slug,
                    first_solved_at=solved_at,
                    source=SolveSource.MANUAL,
                )
            )
            db.add(
                SolveEvent(
                    room_id=room.id,
                    participant_id=participant.id,
                    problem_slug=payload.problem_slug,
                    event_type=SolveEventType.MARKED_SOLVED,
                    source=SolveSource.MANUAL,
                    event_at=solved_at,
                )
            )
    else:
        if existing and existing.source == SolveSource.AUTO:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='Cannot unmark an auto-detected solve',
            )
        if existing and existing.source == SolveSource.MANUAL:
            db.delete(existing)
            db.add(
                SolveEvent(
                    room_id=room.id,
                    participant_id=participant.id,
                    problem_slug=payload.problem_slug,
                    event_type=SolveEventType.UNMARKED,
                    source=SolveSource.MANUAL,
                    event_at=now,
                )
            )

    db.commit()
    return ManualSolveResponse(ok=True)


@router.get('/{room_code}/history', response_model=HistoryResponse)
def get_room_history(
    room_code: str,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(db, room_code)

    dirty = False
    if _maybe_auto_start_room(db, room):
        dirty = True
    if _update_room_status_if_expired(room):
        dirty = True

    if _refresh_room_participant_avatars(db, room):
        dirty = True

    if dirty:
        db.commit()
        db.refresh(room)

    if room.status != RoomStatus.ENDED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='History is available after the room ends',
        )

    problems = db.scalars(
        select(RoomProblem)
        .where(RoomProblem.room_id == room.id)
        .order_by(RoomProblem.sort_order.asc())
    ).all()

    username_by_participant = {
        participant.id: participant.leetcode_username
        for participant in db.scalars(select(Participant).where(Participant.room_id == room.id)).all()
    }

    events = db.scalars(
        select(SolveEvent)
        .where(SolveEvent.room_id == room.id)
        .order_by(SolveEvent.event_at.asc(), SolveEvent.created_at.asc())
    ).all()

    history_events = [
        HistoryEvent(
            participant_id=event.participant_id,
            participant_leetcode_username=username_by_participant.get(event.participant_id, 'unknown'),
            problem_slug=event.problem_slug,
            event_type=event.event_type,
            source=event.source,
            event_at=event.event_at,
        )
        for event in events
    ]

    return HistoryResponse(
        room=_room_to_public(room),
        problems=[_problem_to_public(problem) for problem in problems],
        leaderboard=_build_leaderboard(db, room),
        events=history_events,
    )
