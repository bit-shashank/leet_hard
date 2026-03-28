from datetime import datetime, timedelta, timezone
import os
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault('DATABASE_URL', 'sqlite:///./test_bootstrap.db')

from app.db import get_db
from app.main import app
from app.models import Base, Participant, ProblemSource, Room, RoomStatus, User
from app.security import get_current_user


@pytest.fixture()
def client():
    engine = create_engine(
        'sqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    SessionTest = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    Base.metadata.create_all(bind=engine)

    db = SessionTest()
    db.add_all(
        [
            User(
                id='host-user',
                email='host@example.com',
                primary_leetcode_username='host_lc',
                leetcode_username_locked=True,
                leetcode_verified_at=datetime.now(timezone.utc),
            ),
            User(
                id='player-user',
                email='player@example.com',
                primary_leetcode_username='player_lc',
                leetcode_username_locked=True,
                leetcode_verified_at=datetime.now(timezone.utc),
            ),
        ]
    )
    db.commit()
    db.close()

    current_user_id = {'value': 'player-user'}

    def override_get_db():
        session = SessionTest()
        try:
            yield session
        finally:
            session.close()

    def override_get_current_user():
        return SimpleNamespace(id=current_user_id['value'])

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    try:
        yield TestClient(app), SessionTest, current_user_id
    finally:
        app.dependency_overrides.clear()


def _seed_room_with_host_and_player(SessionTest, *, room_code: str, status: RoomStatus) -> str:
    now = datetime.now(timezone.utc)
    db = SessionTest()
    room = Room(
        room_code=room_code,
        room_title='Leave Room Test',
        status=status,
        problem_source=ProblemSource.RANDOM,
        problem_count=3,
        easy_count=1,
        medium_count=2,
        hard_count=0,
        exclude_pre_solved=False,
        strict_check=False,
        duration_minutes=60,
        scheduled_start_at=now + timedelta(minutes=10),
        starts_at=now - timedelta(minutes=5) if status == RoomStatus.ACTIVE else None,
        ends_at=now + timedelta(minutes=55) if status == RoomStatus.ACTIVE else None,
    )
    db.add(room)
    db.flush()

    host = Participant(
        room_id=room.id,
        user_id='host-user',
        nickname='host_lc',
        leetcode_username='host_lc',
        token_hash='host-token-hash',
        is_host=True,
        joined_at=now - timedelta(minutes=2),
    )
    db.add(host)
    db.flush()
    room.host_participant_id = host.id

    player = Participant(
        room_id=room.id,
        user_id='player-user',
        nickname='player_lc',
        leetcode_username='player_lc',
        token_hash='player-token-hash',
        is_host=False,
        joined_at=now - timedelta(minutes=1),
    )
    db.add(player)

    db.commit()
    room_id = room.id
    db.close()
    return room_id


def test_leave_room_removes_non_host_participant_in_lobby(client):
    test_client, SessionTest, current_user_id = client
    current_user_id['value'] = 'player-user'
    room_id = _seed_room_with_host_and_player(SessionTest, room_code='LEAVE1', status=RoomStatus.LOBBY)

    response = test_client.delete('/api/v1/rooms/LEAVE1/leave')
    assert response.status_code == 204

    db = SessionTest()
    participants = db.scalars(select(Participant).where(Participant.room_id == room_id)).all()
    assert len(participants) == 1
    assert participants[0].user_id == 'host-user'
    db.close()


def test_leave_room_rejects_host(client):
    test_client, SessionTest, current_user_id = client
    current_user_id['value'] = 'host-user'
    room_id = _seed_room_with_host_and_player(SessionTest, room_code='LEAVE2', status=RoomStatus.LOBBY)

    response = test_client.delete('/api/v1/rooms/LEAVE2/leave')
    assert response.status_code == 400
    assert response.json()['detail'] == 'Host cannot leave this room'

    db = SessionTest()
    participants = db.scalars(select(Participant).where(Participant.room_id == room_id)).all()
    assert len(participants) == 2
    db.close()


def test_leave_room_rejects_after_room_starts(client):
    test_client, SessionTest, current_user_id = client
    current_user_id['value'] = 'player-user'
    room_id = _seed_room_with_host_and_player(SessionTest, room_code='LEAVE3', status=RoomStatus.ACTIVE)

    response = test_client.delete('/api/v1/rooms/LEAVE3/leave')
    assert response.status_code == 400
    assert response.json()['detail'] == 'You can leave only before the room starts'

    db = SessionTest()
    participant = db.scalar(
        select(Participant).where(
            Participant.room_id == room_id,
            Participant.user_id == 'player-user',
        )
    )
    assert participant is not None
    db.close()
