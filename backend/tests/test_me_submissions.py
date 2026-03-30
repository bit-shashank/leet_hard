from datetime import datetime, timedelta, timezone
import os

import pytest
from fastapi import Depends
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
from app.services.leetcode import LeetCodeServiceError


@pytest.fixture()
def me_client():
    engine = create_engine(
        'sqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    SessionTest = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    Base.metadata.create_all(bind=engine)

    now = datetime.now(timezone.utc)
    with SessionTest() as db:
        user_one = User(
            id='user-1',
            email='user1@example.com',
            primary_leetcode_username='user_one_lc',
            leetcode_username_locked=True,
            leetcode_verified_at=now,
        )
        user_two = User(
            id='user-2',
            email='user2@example.com',
            primary_leetcode_username='user_two_lc',
            leetcode_username_locked=True,
            leetcode_verified_at=now,
        )
        db.add_all([user_one, user_two])

        room = Room(
            room_code='MYSUB1',
            room_title='Submission Room',
            status=RoomStatus.ENDED,
            problem_source=ProblemSource.RANDOM,
            problem_count=3,
            easy_count=1,
            medium_count=2,
            hard_count=0,
            duration_minutes=60,
            scheduled_start_at=now - timedelta(hours=3),
            starts_at=now - timedelta(hours=3),
            ends_at=now - timedelta(hours=2),
        )
        db.add(room)
        db.flush()

        participant_one = Participant(
            room_id=room.id,
            user_id='user-1',
            nickname='u1',
            leetcode_username='user_one_lc',
            token_hash='u1-token',
            is_host=True,
            joined_at=now - timedelta(hours=3, minutes=5),
        )
        participant_two = Participant(
            room_id=room.id,
            user_id='user-2',
            nickname='u2',
            leetcode_username='user_two_lc',
            token_hash='u2-token',
            is_host=False,
            joined_at=now - timedelta(hours=3, minutes=4),
        )
        db.add_all([participant_one, participant_two])
        db.flush()
        room.host_participant_id = participant_one.id

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
                    title_slug='3sum',
                    title='3Sum',
                    frontend_id='15',
                    url='https://leetcode.com/problems/3sum/',
                    difficulty='Medium',
                    sort_order=2,
                ),
            ]
        )

        db.add_all(
            [
                ParticipantSolve(
                    room_id=room.id,
                    participant_id=participant_one.id,
                    problem_slug='two-sum',
                    first_solved_at=now - timedelta(hours=2, minutes=30),
                    source=SolveSource.AUTO,
                    submission_url='https://leetcode.com/submissions/detail/111/',
                ),
                ParticipantSolve(
                    room_id=room.id,
                    participant_id=participant_one.id,
                    problem_slug='3sum',
                    first_solved_at=now - timedelta(hours=2, minutes=20),
                    source=SolveSource.MANUAL,
                    submission_url=None,
                ),
                ParticipantSolve(
                    room_id=room.id,
                    participant_id=participant_two.id,
                    problem_slug='two-sum',
                    first_solved_at=now - timedelta(hours=2, minutes=10),
                    source=SolveSource.AUTO,
                    submission_url='https://leetcode.com/submissions/detail/999/',
                ),
            ]
        )

        db.commit()

    def override_get_db():
        db = SessionTest()
        try:
            yield db
        finally:
            db.close()

    def override_get_current_user(db: Session = Depends(get_db)) -> User:
        return db.scalar(select(User).where(User.id == 'user-1'))

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    try:
        yield TestClient(app), SessionTest
    finally:
        app.dependency_overrides.clear()


def test_me_submissions_reads_room_solves_only_and_respects_limit(me_client):
    client, _ = me_client

    response = client.get('/api/v1/me/submissions?limit=1')
    assert response.status_code == 200
    payload = response.json()

    assert len(payload) == 1
    assert payload[0]['problem_slug'] == '3sum'
    assert payload[0]['problem_title'] == '3Sum'
    assert payload[0]['problem_difficulty'] == 'medium'
    assert payload[0]['submission_url'] is None


def test_me_submissions_ignores_other_users_and_works_without_primary_username(me_client):
    client, SessionTest = me_client

    with SessionTest() as db:
        user = db.scalar(select(User).where(User.id == 'user-1'))
        user.primary_leetcode_username = None
        db.commit()

    response = client.get('/api/v1/me/submissions?limit=10')
    assert response.status_code == 200
    payload = response.json()

    assert len(payload) == 2
    slugs = [item['problem_slug'] for item in payload]
    assert slugs == ['3sum', 'two-sum']
    assert all(item.get('submission_url') != 'https://leetcode.com/submissions/detail/999/' for item in payload)


def test_me_submissions_backfills_missing_urls_when_matching_submission_exists(me_client, monkeypatch):
    client, _ = me_client

    now = datetime.now(timezone.utc)
    monkeypatch.setattr(
        'app.routers.me.get_recent_submissions',
        lambda username, limit=100: [
            {
                'titleSlug': '3sum',
                'statusDisplay': 'Accepted',
                'status': 10,
                'timestamp': int((now - timedelta(hours=2, minutes=20)).timestamp()),
                'submissionId': 123456,
            }
        ],
    )

    response = client.get('/api/v1/me/submissions')
    assert response.status_code == 200
    payload = response.json()
    by_slug = {item['problem_slug']: item for item in payload}
    assert by_slug['3sum']['submission_url'] == 'https://leetcode.com/submissions/detail/123456/'


def test_me_submissions_backfill_is_best_effort_on_api_failure(me_client, monkeypatch):
    client, _ = me_client

    def _raise_error(*args, **kwargs):
        raise LeetCodeServiceError('upstream down')

    monkeypatch.setattr('app.routers.me.get_recent_submissions', _raise_error)
    response = client.get('/api/v1/me/submissions')
    assert response.status_code == 200
    payload = response.json()
    by_slug = {item['problem_slug']: item for item in payload}
    assert by_slug['3sum']['submission_url'] is None
