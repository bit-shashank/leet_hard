from datetime import datetime, timedelta, timezone
import os

from fastapi import Depends, Header, HTTPException, status
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault('DATABASE_URL', 'sqlite:///./test_bootstrap.db')

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
    SolveSource,
    User,
)
from app.security import get_current_user


def _seed_ended_room(SessionTest, *, with_solve: bool = False) -> tuple[str, datetime | None]:
    now = datetime.now(timezone.utc)

    db = SessionTest()
    room = Room(
        room_code='HIST01',
        room_title='History Access Room',
        status=RoomStatus.ENDED,
        problem_source=ProblemSource.RANDOM,
        problem_count=3,
        easy_count=1,
        medium_count=2,
        hard_count=0,
        exclude_pre_solved=False,
        strict_check=False,
        duration_minutes=60,
        scheduled_start_at=now - timedelta(hours=2),
        starts_at=now - timedelta(hours=2),
        ends_at=now - timedelta(hours=1),
    )
    db.add(room)
    db.flush()

    host = Participant(
        room_id=room.id,
        user_id='user-host',
        nickname='host_lc',
        leetcode_username='host_lc',
        avatar_url='https://cdn.example.com/host_lc.png',
        avatar_synced_at=now,
        token_hash='host-token-hash',
        is_host=True,
        joined_at=now - timedelta(hours=2, minutes=1),
    )
    db.add(host)
    db.flush()
    room.host_participant_id = host.id

    db.add_all(
        [
            RoomProblem(
                room_id=room.id,
                title_slug='two-sum',
                title='Two Sum',
                frontend_id='1',
                url='https://leetcode.com/problems/two-sum/',
                difficulty='Easy',
                sort_order=1,
            ),
            RoomProblem(
                room_id=room.id,
                title_slug='add-two-numbers',
                title='Add Two Numbers',
                frontend_id='2',
                url='https://leetcode.com/problems/add-two-numbers/',
                difficulty='Medium',
                sort_order=2,
            ),
            RoomProblem(
                room_id=room.id,
                title_slug='3sum',
                title='3Sum',
                frontend_id='15',
                url='https://leetcode.com/problems/3sum/',
                difficulty='Medium',
                sort_order=3,
            ),
        ]
    )

    solved_at = None
    if with_solve:
        solved_at = now - timedelta(hours=1, minutes=20)
        db.add(
            ParticipantSolve(
                room_id=room.id,
                participant_id=host.id,
                problem_slug='two-sum',
                first_solved_at=solved_at,
                source=SolveSource.AUTO,
                submission_url=None,
            )
        )

    db.commit()
    room_code = room.room_code
    db.close()
    return room_code, solved_at


def _auth_headers(user_id: str) -> dict[str, str]:
    return {'Authorization': f'Bearer {user_id}'}


def _setup_client(monkeypatch):
    engine = create_engine(
        'sqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    SessionTest = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    Base.metadata.create_all(bind=engine)

    setup_db = SessionTest()
    setup_db.add_all(
        [
            User(id='user-host', email='host@example.com'),
            User(id='user-viewer', email='viewer@example.com'),
        ]
    )
    setup_db.commit()
    setup_db.close()

    def override_get_db():
        db = SessionTest()
        try:
            yield db
        finally:
            db.close()

    def override_get_current_user(
        authorization: str | None = Header(default=None),
        db: Session = Depends(get_db),
    ) -> User:
        if not authorization:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Unauthorized')

        token = authorization.replace('Bearer', '', 1).strip()
        user = db.scalar(select(User).where(User.id == token))
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Unauthorized')
        return user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    monkeypatch.setattr(
        'app.routers.rooms.get_user_avatar_url',
        lambda username: f'https://cdn.example.com/{username}.png',
    )

    return TestClient(app), SessionTest


def test_room_history_requires_participant_and_includes_problem_set(monkeypatch):
    client, SessionTest = _setup_client(monkeypatch)

    try:
        room_code, _ = _seed_ended_room(SessionTest)

        host_response = client.get(f'/api/v1/rooms/{room_code}/history', headers=_auth_headers('user-host'))
        assert host_response.status_code == 200
        host_payload = host_response.json()
        assert [problem['title_slug'] for problem in host_payload['problems']] == [
            'two-sum',
            'add-two-numbers',
            '3sum',
        ]
        assert [problem['sort_order'] for problem in host_payload['problems']] == [1, 2, 3]
        assert host_payload['accepted_submissions'] == []

        viewer_response = client.get(
            f'/api/v1/rooms/{room_code}/history',
            headers=_auth_headers('user-viewer'),
        )
        assert viewer_response.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_room_history_lazy_backfills_submission_urls(monkeypatch):
    client, SessionTest = _setup_client(monkeypatch)

    try:
        room_code, solved_at = _seed_ended_room(SessionTest, with_solve=True)
        assert solved_at is not None

        monkeypatch.setattr(
            'app.routers.rooms.get_recent_submissions',
            lambda username, limit=100: [
                {
                    'titleSlug': 'two-sum',
                    'statusDisplay': 'Accepted',
                    'status': 10,
                    'timestamp': int(solved_at.timestamp()),
                    'submissionId': 123456789,
                }
            ],
        )

        response = client.get(f'/api/v1/rooms/{room_code}/history', headers=_auth_headers('user-host'))
        assert response.status_code == 200
        payload = response.json()
        assert len(payload['accepted_submissions']) == 1
        assert payload['accepted_submissions'][0]['submission_url'] == 'https://leetcode.com/submissions/detail/123456789/'

        with SessionTest() as db:
            room = db.scalar(select(Room).where(Room.room_code == room_code))
            host = db.scalar(
                select(Participant).where(
                    Participant.room_id == room.id,
                    Participant.user_id == 'user-host',
                )
            )
            solve = db.scalar(
                select(ParticipantSolve).where(
                    ParticipantSolve.room_id == room.id,
                    ParticipantSolve.participant_id == host.id,
                    ParticipantSolve.problem_slug == 'two-sum',
                )
            )
            assert solve is not None
            assert solve.submission_url == 'https://leetcode.com/submissions/detail/123456789/'
    finally:
        app.dependency_overrides.clear()
