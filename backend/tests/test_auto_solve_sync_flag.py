from datetime import datetime, timedelta, timezone
import os
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault('DATABASE_URL', 'sqlite:///./test_bootstrap.db')

from app.config import get_settings
from app.db import get_db
from app.main import app
from app.models import (
    Base,
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


@pytest.fixture(autouse=True)
def clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
def client(monkeypatch):
    engine = create_engine(
        'sqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    SessionTest = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    Base.metadata.create_all(bind=engine)

    user_id = 'test-user-id'
    db = SessionTest()
    db.add(
        User(
            id=user_id,
            email='tester@example.com',
            primary_leetcode_username='tester_lc',
            leetcode_username_locked=True,
            leetcode_verified_at=datetime.now(timezone.utc),
        )
    )
    db.commit()
    db.close()

    def override_get_db():
        session = SessionTest()
        try:
            yield session
        finally:
            session.close()

    def override_get_current_user():
        return SimpleNamespace(id=user_id)

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    # Keep state endpoint deterministic for tests and avoid external calls.
    monkeypatch.setattr(
        'app.routers.rooms.get_user_avatar_url',
        lambda username: f'https://cdn.example.com/{username}.png',
    )

    yield TestClient(app), SessionTest, user_id, monkeypatch

    app.dependency_overrides.clear()


def _set_auto_sync_enabled(monkeypatch, enabled: bool) -> None:
    monkeypatch.setenv('AUTO_SOLVE_SYNC_ENABLED', 'true' if enabled else 'false')
    get_settings.cache_clear()


def _seed_active_room(
    SessionTest,
    *,
    user_id: str,
    room_code: str,
    participant_username: str,
    problem_slug: str = 'two-sum',
    strict_check: bool = False,
    with_auto_solve: bool = False,
) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    db = SessionTest()

    room = Room(
        room_code=room_code,
        room_title='Flag Test Room',
        status=RoomStatus.ACTIVE,
        problem_source=ProblemSource.RANDOM,
        problem_count=1,
        easy_count=1,
        medium_count=0,
        hard_count=0,
        exclude_pre_solved=False,
        strict_check=strict_check,
        duration_minutes=60,
        scheduled_start_at=now - timedelta(minutes=5),
        starts_at=now - timedelta(minutes=5),
        ends_at=now + timedelta(minutes=55),
    )
    db.add(room)
    db.flush()

    participant = Participant(
        room_id=room.id,
        user_id=user_id,
        nickname=participant_username,
        leetcode_username=participant_username,
        avatar_url=f'https://cdn.example.com/{participant_username}.png',
        token_hash='test-token-hash',
        is_host=True,
        joined_at=now - timedelta(minutes=1),
    )
    db.add(participant)
    db.flush()

    room.host_participant_id = participant.id

    db.add(
        RoomProblem(
            room_id=room.id,
            title_slug=problem_slug,
            title='Two Sum',
            frontend_id='1',
            url=f'https://leetcode.com/problems/{problem_slug}/',
            difficulty='Easy',
            sort_order=1,
        )
    )

    if with_auto_solve:
        db.add(
            ParticipantSolve(
                room_id=room.id,
                participant_id=participant.id,
                problem_slug=problem_slug,
                first_solved_at=now - timedelta(seconds=15),
                source=SolveSource.AUTO,
            )
        )

    db.commit()
    db.close()
    return room_code, problem_slug


def test_get_room_state_does_not_auto_sync_solves_when_flag_disabled(client):
    test_client, SessionTest, user_id, monkeypatch = client
    _set_auto_sync_enabled(monkeypatch, False)
    room_code, problem_slug = _seed_active_room(
        SessionTest,
        user_id=user_id,
        room_code='FLAGOFF',
        participant_username='flag_off_user',
    )

    def _should_not_be_called(username: str, limit: int = 100):
        raise AssertionError('get_recent_submissions should not be called when auto sync is disabled')

    monkeypatch.setattr('app.routers.rooms.get_recent_submissions', _should_not_be_called)

    response = test_client.get(f'/api/v1/rooms/{room_code}/state')
    assert response.status_code == 200
    payload = response.json()
    assert problem_slug not in payload['my_solved_slugs']

    db = SessionTest()
    room = db.scalar(select(Room).where(Room.room_code == room_code))
    assert room.last_synced_at is None
    db.close()


def test_get_room_state_auto_syncs_solves_when_flag_enabled(client):
    test_client, SessionTest, user_id, monkeypatch = client
    _set_auto_sync_enabled(monkeypatch, True)
    room_code, problem_slug = _seed_active_room(
        SessionTest,
        user_id=user_id,
        room_code='FLAGON1',
        participant_username='flag_on_user',
    )

    solved_at = datetime.now(timezone.utc)
    monkeypatch.setattr(
        'app.routers.rooms.get_recent_submissions',
        lambda username, limit=100: [
            {
                'titleSlug': problem_slug,
                'statusDisplay': 'Accepted',
                'status': 10,
                'timestamp': int(solved_at.timestamp()),
                'submissionId': 554433221,
            }
        ],
    )

    response = test_client.get(f'/api/v1/rooms/{room_code}/state')
    assert response.status_code == 200
    payload = response.json()
    assert problem_slug in payload['my_solved_slugs']

    db = SessionTest()
    room = db.scalar(select(Room).where(Room.room_code == room_code))
    solve = db.scalar(
        select(ParticipantSolve).where(
            ParticipantSolve.room_id == room.id,
            ParticipantSolve.problem_slug == problem_slug,
        )
    )
    assert room.last_synced_at is not None
    assert solve is not None
    assert solve.source == SolveSource.AUTO
    assert solve.submission_url == 'https://leetcode.com/submissions/detail/554433221/'
    db.close()


def test_manual_unmark_allows_legacy_auto_solve_when_flag_disabled(client):
    test_client, SessionTest, user_id, monkeypatch = client
    _set_auto_sync_enabled(monkeypatch, False)
    room_code, problem_slug = _seed_active_room(
        SessionTest,
        user_id=user_id,
        room_code='FLAGOFF2',
        participant_username='legacy_auto_user',
        with_auto_solve=True,
    )

    response = test_client.post(
        f'/api/v1/rooms/{room_code}/solves/manual',
        json={'problem_slug': problem_slug, 'solved': False},
    )
    assert response.status_code == 200
    assert response.json() == {'ok': True}

    db = SessionTest()
    room = db.scalar(select(Room).where(Room.room_code == room_code))
    participant = db.scalar(
        select(Participant).where(
            Participant.room_id == room.id,
            Participant.user_id == user_id,
        )
    )
    solve = db.scalar(
        select(ParticipantSolve).where(
            ParticipantSolve.room_id == room.id,
            ParticipantSolve.participant_id == participant.id,
            ParticipantSolve.problem_slug == problem_slug,
        )
    )
    unmark_event = db.scalar(
        select(SolveEvent).where(
            SolveEvent.room_id == room.id,
            SolveEvent.participant_id == participant.id,
            SolveEvent.problem_slug == problem_slug,
            SolveEvent.event_type == SolveEventType.UNMARKED,
        )
    )
    assert solve is None
    assert unmark_event is not None
    assert unmark_event.source == SolveSource.MANUAL
    db.close()


def test_manual_unmark_rejects_auto_solve_when_flag_enabled(client):
    test_client, SessionTest, user_id, monkeypatch = client
    _set_auto_sync_enabled(monkeypatch, True)
    room_code, problem_slug = _seed_active_room(
        SessionTest,
        user_id=user_id,
        room_code='FLAGON2',
        participant_username='legacy_auto_blocked',
        with_auto_solve=True,
    )

    response = test_client.post(
        f'/api/v1/rooms/{room_code}/solves/manual',
        json={'problem_slug': problem_slug, 'solved': False},
    )
    assert response.status_code == 400
    assert response.json()['detail'] == 'Cannot unmark an auto-detected solve'

    db = SessionTest()
    room = db.scalar(select(Room).where(Room.room_code == room_code))
    participant = db.scalar(
        select(Participant).where(
            Participant.room_id == room.id,
            Participant.user_id == user_id,
        )
    )
    solve = db.scalar(
        select(ParticipantSolve).where(
            ParticipantSolve.room_id == room.id,
            ParticipantSolve.participant_id == participant.id,
            ParticipantSolve.problem_slug == problem_slug,
        )
    )
    assert solve is not None
    assert solve.source == SolveSource.AUTO
    db.close()


@pytest.mark.parametrize('auto_sync_enabled', [False, True])
def test_manual_strict_check_mark_solved_unchanged_with_flag(client, auto_sync_enabled):
    test_client, SessionTest, user_id, monkeypatch = client
    _set_auto_sync_enabled(monkeypatch, auto_sync_enabled)
    room_code, problem_slug = _seed_active_room(
        SessionTest,
        user_id=user_id,
        room_code='FLAGST1' if auto_sync_enabled else 'FLAGST0',
        participant_username='strict_user',
        strict_check=True,
        with_auto_solve=False,
    )

    calls = {'count': 0}
    verified_at = datetime.now(timezone.utc) - timedelta(seconds=30)

    def _strict_verify(room, participant, slug):
        calls['count'] += 1
        assert slug == problem_slug
        return verified_at, 'https://leetcode.com/submissions/detail/777888999/'

    monkeypatch.setattr('app.routers.rooms._get_strict_verified_solve_time', _strict_verify)

    response = test_client.post(
        f'/api/v1/rooms/{room_code}/solves/manual',
        json={'problem_slug': problem_slug, 'solved': True},
    )
    assert response.status_code == 200
    assert response.json() == {'ok': True}
    assert calls['count'] == 1

    db = SessionTest()
    room = db.scalar(select(Room).where(Room.room_code == room_code))
    participant = db.scalar(
        select(Participant).where(
            Participant.room_id == room.id,
            Participant.user_id == user_id,
        )
    )
    solve = db.scalar(
        select(ParticipantSolve).where(
            ParticipantSolve.room_id == room.id,
            ParticipantSolve.participant_id == participant.id,
            ParticipantSolve.problem_slug == problem_slug,
        )
    )
    assert solve is not None
    assert solve.source == SolveSource.MANUAL
    stored = solve.first_solved_at
    if stored.tzinfo is None:
        stored = stored.replace(tzinfo=timezone.utc)
    assert int(stored.timestamp()) == int(verified_at.timestamp())
    assert solve.submission_url == 'https://leetcode.com/submissions/detail/777888999/'
    db.close()
