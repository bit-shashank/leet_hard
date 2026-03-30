from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app import auth
from app.db import get_db
from app.config import get_settings
from app.models import (
    LeetCodeVerificationChallenge,
    Participant,
    ParticipantSolve,
    Room,
    RoomStatus,
    User,
    VerificationChallengeStatus,
)
from app.schemas import (
    DashboardResponse,
    DashboardRoomItem,
    MeResponse,
    OnboardingStartRequest,
    OnboardingStartResponse,
    OnboardingVerifyRequest,
    OnboardingVerifyResponse,
    UpdateMeRequest,
)
from app.security import get_current_user
from app.services.leetcode import LeetCodeServiceError, get_recent_submissions, get_user_profile

router = APIRouter(prefix='/me', tags=['me'])

ONBOARDING_PROBLEM_SLUG = 'fizz-buzz'
ONBOARDING_PROBLEM_TITLE = 'Fizz Buzz'
ONBOARDING_WINDOW_MINUTES = 30
ONBOARDING_INSTRUCTIONS = (
    'Open Fizz Buzz on LeetCode, submit an Accepted solution, then click Verify below. '
    'Your LeetCode username will be locked after verification.'
)
SOFT_ONBOARDING_INSTRUCTIONS = (
    'Confirm this is your LeetCode profile to finish setup. '
    'Your LeetCode username will be locked after verification.'
)
ONBOARDING_REFERENCE_CODE = """class Solution:
    def fizzBuzz(self, n: int) -> list[str]:
        result = []
        for i in range(1, n + 1):
            if i % 15 == 0:
                result.append("FizzBuzz")
            elif i % 3 == 0:
                result.append("Fizz")
            elif i % 5 == 0:
                result.append("Buzz")
            else:
                result.append(str(i))
        return result
"""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _profile_complete(user: User) -> bool:
    return bool(
        user.primary_leetcode_username
        and user.leetcode_verified_at is not None
        and user.leetcode_username_locked
    )


def _to_me_response(user: User) -> MeResponse:
    profile_complete = _profile_complete(user)
    return MeResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        primary_leetcode_username=user.primary_leetcode_username,
        leetcode_verified=user.leetcode_verified_at is not None,
        leetcode_locked=user.leetcode_username_locked,
        onboarding_required=not profile_complete,
        onboarding_completed_at=user.onboarding_completed_at,
        profile_complete=profile_complete,
        role=user.role,
        account_status=user.account_status,
    )


def _extract_avatar_url(payload: dict) -> str | None:
    profile = payload.get('profile')
    if isinstance(profile, dict):
        avatar = profile.get('userAvatar')
        if isinstance(avatar, str) and avatar.strip():
            return avatar.strip()

    avatar = payload.get('userAvatar')
    if isinstance(avatar, str) and avatar.strip():
        return avatar.strip()
    return None


def _assert_valid_leetcode_username(username: str) -> dict:
    normalized = auth.normalize_leetcode_username(username)
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Invalid primary LeetCode username',
        )

    try:
        return get_user_profile(normalized)
    except LeetCodeServiceError as exc:
        error_text = str(exc)
        if '404' in error_text:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='LeetCode username was not found',
            )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'LeetCode profile validation unavailable right now: {exc}',
        )


def _match_accepted_submission_time(
    submission: dict,
    problem_slug: str,
    issued_at: datetime,
    expires_at: datetime,
) -> datetime | None:
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

    if solved_at < issued_at:
        return None
    if solved_at > expires_at:
        return None
    return solved_at


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


def _build_onboarding_response(challenge: LeetCodeVerificationChallenge) -> OnboardingStartResponse:
    return OnboardingStartResponse(
        verification_mode='strict',
        profile_preview_username=challenge.leetcode_username,
        profile_preview_avatar_url=None,
        profile_preview_url=f'https://leetcode.com/u/{challenge.leetcode_username}/',
        problem_slug=challenge.problem_slug,
        problem_title=challenge.problem_title,
        instructions=ONBOARDING_INSTRUCTIONS,
        reference_code=challenge.reference_code or ONBOARDING_REFERENCE_CODE,
        issued_at=challenge.issued_at,
        expires_at=challenge.expires_at,
    )


def _verification_mode() -> str:
    mode = get_settings().leetcode_verification_mode.strip().lower()
    if mode not in {'soft', 'strict'}:
        return 'soft'
    return mode


@router.get('', response_model=MeResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return _to_me_response(current_user)


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

        if (
            current_user.leetcode_username_locked
            and current_user.primary_leetcode_username
            and normalized != current_user.primary_leetcode_username
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='Primary LeetCode username is locked after verification',
            )

        if normalized != current_user.primary_leetcode_username:
            profile_payload = _assert_valid_leetcode_username(normalized)
            current_user.primary_leetcode_username = normalized
            current_user.leetcode_verified_at = None
            current_user.onboarding_completed_at = None
            current_user.leetcode_username_locked = False
            avatar_url = _extract_avatar_url(profile_payload)
            if avatar_url:
                current_user.avatar_url = avatar_url
            dirty = True

    if dirty:
        db.commit()
        db.refresh(current_user)

    return _to_me_response(current_user)


@router.delete('', status_code=status.HTTP_204_NO_CONTENT)
def delete_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.delete(current_user)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post('/onboarding/start', response_model=OnboardingStartResponse)
def start_onboarding(
    payload: OnboardingStartRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if _profile_complete(current_user):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='LeetCode identity is already verified for this account',
        )

    normalized = auth.normalize_leetcode_username(payload.leetcode_username)
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Invalid LeetCode username format',
        )

    if (
        current_user.leetcode_username_locked
        and current_user.primary_leetcode_username
        and normalized != current_user.primary_leetcode_username
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Primary LeetCode username is locked after verification',
        )

    profile_payload = _assert_valid_leetcode_username(normalized)

    mode = _verification_mode()

    now = _utcnow()
    active_challenges = db.scalars(
        select(LeetCodeVerificationChallenge)
        .where(
            LeetCodeVerificationChallenge.user_id == current_user.id,
            LeetCodeVerificationChallenge.status == VerificationChallengeStatus.ISSUED,
        )
        .order_by(LeetCodeVerificationChallenge.issued_at.desc())
    ).all()

    reusable: LeetCodeVerificationChallenge | None = None
    for challenge in active_challenges:
        expires_at = _coerce_utc(challenge.expires_at)
        can_reuse = mode == 'strict' and (
            reusable is None
            and expires_at is not None
            and expires_at > now
            and challenge.leetcode_username == normalized
        )
        if can_reuse:
            reusable = challenge
            continue
        challenge.status = VerificationChallengeStatus.EXPIRED

    avatar_url = _extract_avatar_url(profile_payload)
    dirty = False
    if current_user.primary_leetcode_username != normalized:
        current_user.primary_leetcode_username = normalized
        dirty = True
    if avatar_url and current_user.avatar_url != avatar_url:
        current_user.avatar_url = avatar_url
        dirty = True
    if current_user.leetcode_verified_at is not None:
        current_user.leetcode_verified_at = None
        dirty = True
    if current_user.onboarding_completed_at is not None:
        current_user.onboarding_completed_at = None
        dirty = True
    if current_user.leetcode_username_locked:
        current_user.leetcode_username_locked = False
        dirty = True

    if mode == 'strict' and reusable is None:
        reusable = LeetCodeVerificationChallenge(
            user_id=current_user.id,
            leetcode_username=normalized,
            problem_slug=ONBOARDING_PROBLEM_SLUG,
            problem_title=ONBOARDING_PROBLEM_TITLE,
            reference_code=ONBOARDING_REFERENCE_CODE,
            status=VerificationChallengeStatus.ISSUED,
            issued_at=now,
            expires_at=now + timedelta(minutes=ONBOARDING_WINDOW_MINUTES),
        )
        db.add(reusable)
        dirty = True

    if dirty:
        db.commit()
        db.refresh(current_user)
        if reusable is not None:
            db.refresh(reusable)

    if mode == 'soft':
        return OnboardingStartResponse(
            verification_mode='soft',
            profile_preview_username=normalized,
            profile_preview_avatar_url=current_user.avatar_url,
            profile_preview_url=f'https://leetcode.com/u/{normalized}/',
            instructions=SOFT_ONBOARDING_INSTRUCTIONS,
        )

    if reusable is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail='Unable to initialize strict verification challenge.',
        )

    strict_response = _build_onboarding_response(reusable)
    strict_response.profile_preview_avatar_url = current_user.avatar_url
    return strict_response


@router.post('/onboarding/verify', response_model=OnboardingVerifyResponse)
def verify_onboarding(
    payload: OnboardingVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mode = _verification_mode()
    now = _utcnow()
    username = auth.normalize_leetcode_username(current_user.primary_leetcode_username or '')
    if not username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Primary LeetCode username is missing. Start onboarding first.',
        )

    if mode == 'soft':
        if not payload.confirm_ownership:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='Please confirm this is your LeetCode profile before verifying.',
            )
        _assert_valid_leetcode_username(username)
        current_user.primary_leetcode_username = username
        current_user.leetcode_verified_at = now
        current_user.leetcode_username_locked = True
        current_user.onboarding_completed_at = now
        db.commit()
        db.refresh(current_user)
        return OnboardingVerifyResponse(
            verified=True,
            verified_at=now,
            me=_to_me_response(current_user),
        )

    challenge = db.scalar(
        select(LeetCodeVerificationChallenge)
        .where(
            LeetCodeVerificationChallenge.user_id == current_user.id,
            LeetCodeVerificationChallenge.status == VerificationChallengeStatus.ISSUED,
        )
        .order_by(LeetCodeVerificationChallenge.issued_at.desc())
    )
    if challenge is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='No active onboarding challenge. Start onboarding first.',
        )

    expires_at = _coerce_utc(challenge.expires_at)
    if expires_at is None or expires_at <= now:
        challenge.status = VerificationChallengeStatus.EXPIRED
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Your onboarding challenge expired. Start onboarding again.',
        )

    if not username or username != challenge.leetcode_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='LeetCode username mismatch. Restart onboarding with your intended username.',
        )

    issued_at = _coerce_utc(challenge.issued_at) or now

    try:
        submissions = get_recent_submissions(username, limit=100)
    except LeetCodeServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'LeetCode submission verification unavailable right now: {exc}',
        )

    matched_times: list[datetime] = []
    for submission in submissions:
        solved_at = _match_accepted_submission_time(
            submission=submission,
            problem_slug=challenge.problem_slug,
            issued_at=issued_at,
            expires_at=expires_at,
        )
        if solved_at is not None:
            matched_times.append(solved_at)

    if not matched_times:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='No accepted Fizz Buzz submission found in your challenge window.',
        )

    verified_at = min(matched_times)
    challenge.status = VerificationChallengeStatus.VERIFIED
    challenge.verified_at = verified_at

    current_user.primary_leetcode_username = username
    current_user.leetcode_verified_at = verified_at
    current_user.leetcode_username_locked = True
    current_user.onboarding_completed_at = now

    db.commit()
    db.refresh(current_user)

    return OnboardingVerifyResponse(
        verified=True,
        verified_at=verified_at,
        me=_to_me_response(current_user),
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
