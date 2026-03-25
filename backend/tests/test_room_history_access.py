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
from app.models import Base, Participant, ProblemSource, Room, RoomProblem, RoomStatus, User
from app.security import get_current_user


def _seed_ended_room(SessionTest) -> str:
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

    db.commit()
    room_code = room.room_code
    db.close()
    return room_code


def _auth_headers(user_id: str) -> dict[str, str]:
    return {'Authorization': f'Bearer {user_id}'}


def test_room_history_includes_problem_set_and_allows_non_participant(monkeypatch):
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

    try:
        client = TestClient(app)
        room_code = _seed_ended_room(SessionTest)

        host_response = client.get(f'/api/v1/rooms/{room_code}/history', headers=_auth_headers('user-host'))
        assert host_response.status_code == 200
        host_payload = host_response.json()
        assert [problem['title_slug'] for problem in host_payload['problems']] == [
            'two-sum',
            'add-two-numbers',
            '3sum',
        ]
        assert [problem['sort_order'] for problem in host_payload['problems']] == [1, 2, 3]

        viewer_response = client.get(
            f'/api/v1/rooms/{room_code}/history',
            headers=_auth_headers('user-viewer'),
        )
        assert viewer_response.status_code == 200
        viewer_payload = viewer_response.json()
        assert [problem['title_slug'] for problem in viewer_payload['problems']] == [
            'two-sum',
            'add-two-numbers',
            '3sum',
        ]
    finally:
        app.dependency_overrides.clear()
