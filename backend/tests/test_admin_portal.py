from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import get_db
from app.main import app
from app.models import (
    AdminActionLog,
    Base,
    ProblemSource,
    Room,
    RoomStatus,
    User,
    UserAccountStatus,
    UserRole,
)
from app.security import get_current_user


@pytest.fixture()
def admin_client():
    engine = create_engine(
        'sqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
        future=True,
    )
    SessionTest = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    Base.metadata.create_all(bind=engine)

    now = datetime.now(timezone.utc)
    with SessionTest() as db:
        admin_user = User(
            id='admin-1',
            email='admin@example.com',
            display_name='Admin',
            primary_leetcode_username='admin_lc',
            role=UserRole.ADMIN,
            account_status=UserAccountStatus.ACTIVE,
            leetcode_verified_at=now,
            leetcode_username_locked=True,
        )
        regular_user = User(
            id='user-1',
            email='user@example.com',
            display_name='User',
            primary_leetcode_username='user_lc',
            role=UserRole.USER,
            account_status=UserAccountStatus.ACTIVE,
            leetcode_verified_at=now,
            leetcode_username_locked=True,
        )
        db.add_all([admin_user, regular_user])

        db.add_all(
            [
                Room(
                    room_code='FEAT01',
                    room_title='Featured Candidate',
                    status=RoomStatus.LOBBY,
                    problem_source=ProblemSource.RANDOM,
                    problem_count=4,
                    easy_count=0,
                    medium_count=4,
                    hard_count=0,
                    duration_minutes=60,
                    scheduled_start_at=now + timedelta(hours=2),
                    created_at=now - timedelta(minutes=1),
                ),
                Room(
                    room_code='REG001',
                    room_title='Regular Candidate',
                    status=RoomStatus.LOBBY,
                    problem_source=ProblemSource.RANDOM,
                    problem_count=4,
                    easy_count=0,
                    medium_count=4,
                    hard_count=0,
                    duration_minutes=60,
                    scheduled_start_at=now + timedelta(minutes=5),
                    created_at=now,
                ),
            ]
        )
        db.commit()

    current = {'user': SimpleNamespace(id='admin-1', role=UserRole.ADMIN)}

    def override_get_db():
        db = SessionTest()
        try:
            yield db
        finally:
            db.close()

    def override_get_current_user():
        return current['user']

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    try:
        yield TestClient(app), SessionTest, current
    finally:
        app.dependency_overrides.clear()


def test_admin_apis_forbid_non_admin(admin_client):
    client, _, current = admin_client
    current['user'] = SimpleNamespace(id='user-1', role=UserRole.USER)

    response = client.get('/api/v1/admin/rooms')
    assert response.status_code == 403
    assert response.json()['detail'] == 'Admin access required'


def test_featured_rooms_surface_in_discover_with_priority(admin_client):
    client, _, current = admin_client
    current['user'] = SimpleNamespace(id='admin-1', role=UserRole.ADMIN)

    upsert = client.post(
        '/api/v1/admin/featured-rooms',
        json={
            'room_code': 'FEAT01',
            'priority': 1,
            'is_active': True,
        },
    )
    assert upsert.status_code == 200
    assert upsert.json()['room_code'] == 'FEAT01'

    featured_list = client.get('/api/v1/admin/featured-rooms?state=active')
    assert featured_list.status_code == 200
    assert featured_list.json()
    assert featured_list.json()[0]['room_code'] == 'FEAT01'

    discover = client.get('/api/v1/rooms/discover?statuses=lobby,active&limit=12')
    assert discover.status_code == 200
    cards = discover.json()
    assert cards[0]['room_code'] == 'FEAT01'
    assert cards[0]['is_featured'] is True
    assert cards[0]['featured_priority'] == 1


def test_admin_room_user_mutations_emit_audit_logs(admin_client):
    client, SessionTest, current = admin_client
    current['user'] = SimpleNamespace(id='admin-1', role=UserRole.ADMIN)

    room_patch = client.patch(
        '/api/v1/admin/rooms/REG001',
        json={
            'room_title': 'Moderated Room',
            'status': 'lobby',
            'is_joinable': False,
        },
    )
    assert room_patch.status_code == 200
    assert room_patch.json()['room_title'] == 'Moderated Room'
    assert room_patch.json()['is_joinable'] is False

    user_promote = client.patch('/api/v1/admin/users/user-1', json={'role': 'admin'})
    assert user_promote.status_code == 200
    assert user_promote.json()['role'] == 'admin'

    self_demote = client.patch('/api/v1/admin/users/admin-1', json={'role': 'user'})
    assert self_demote.status_code == 400
    assert 'cannot remove your own admin role' in self_demote.json()['detail'].lower()

    logs_resp = client.get('/api/v1/admin/logs?limit=20')
    assert logs_resp.status_code == 200
    actions = [item['action'] for item in logs_resp.json()]
    assert 'room_update' in actions
    assert 'user_update' in actions

    with SessionTest() as db:
        log_count = db.scalar(select(func.count(AdminActionLog.id)))
        assert int(log_count or 0) >= 2
