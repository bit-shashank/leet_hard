from datetime import datetime, timedelta, timezone
import os

from sqlalchemy import func, select
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault('DATABASE_URL', 'sqlite:///./test_bootstrap.db')

from app.models import Base, ProblemSource, Room, RoomProblem, RoomStatus
from app.routers.rooms import _maybe_auto_start_room


def _make_problem(slug: str, difficulty: str, idx: int) -> dict:
    return {
        'title_slug': slug,
        'title': slug.replace('-', ' ').title(),
        'frontend_id': str(idx),
        'url': f'https://leetcode.com/problems/{slug}/',
        'difficulty': difficulty,
        'paid_only': False,
    }


def test_auto_start_is_idempotent_across_stale_sessions(monkeypatch):
    engine = create_engine(
        'sqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    SessionTest = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    Base.metadata.create_all(bind=engine)

    monkeypatch.setattr(
        'app.routers.rooms.choose_random_problems_by_source',
        lambda source, easy_count, medium_count, hard_count, excluded_slugs=None, topic_slugs=None: [
            _make_problem('two-sum', 'Easy', 1),
            _make_problem('add-two-numbers', 'Medium', 2),
            _make_problem('3sum', 'Medium', 3),
            _make_problem('group-anagrams', 'Medium', 4),
        ],
    )

    now = datetime.now(timezone.utc)

    setup = SessionTest()
    room = Room(
        room_code='RACE01',
        room_title='Race Condition Room',
        status=RoomStatus.LOBBY,
        problem_source=ProblemSource.RANDOM,
        problem_count=4,
        easy_count=1,
        medium_count=3,
        hard_count=0,
        exclude_pre_solved=False,
        strict_check=False,
        duration_minutes=60,
        scheduled_start_at=now - timedelta(minutes=1),
    )
    setup.add(room)
    setup.commit()
    room_id = room.id
    setup.close()

    session_a = SessionTest()
    session_b = SessionTest()

    room_a = session_a.scalar(select(Room).where(Room.id == room_id))
    room_b = session_b.scalar(select(Room).where(Room.id == room_id))

    started_a = _maybe_auto_start_room(session_a, room_a)
    session_a.commit()
    assert started_a is True

    started_b = _maybe_auto_start_room(session_b, room_b)
    session_b.commit()
    assert started_b is False

    verify = SessionTest()
    room_after = verify.scalar(select(Room).where(Room.id == room_id))
    problem_count = verify.scalar(
        select(func.count(RoomProblem.id)).where(RoomProblem.room_id == room_id)
    )
    assert room_after.status == RoomStatus.ACTIVE
    assert problem_count == 4

    session_a.close()
    session_b.close()
    verify.close()
