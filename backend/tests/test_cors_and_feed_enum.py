import asyncio
from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models import (
    Base,
    Participant,
    ProblemSource,
    Room,
    RoomFeedEvent,
    RoomFeedEventType,
    RoomStatus,
    SolveSource,
)


async def _preflight(path: str, method: str, origin: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url='http://testserver') as client:
        return await client.options(
            path,
            headers={
                'Origin': origin,
                'Access-Control-Request-Method': method,
                'Access-Control-Request-Headers': 'authorization,content-type',
            },
        )


async def _get(path: str, origin: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url='http://testserver') as client:
        return await client.get(path, headers={'Origin': origin})


def test_cors_preflight_allows_explicit_origin_for_join():
    response = asyncio.run(
        _preflight(
            '/api/v1/rooms/ABCD/join',
            'POST',
            'http://localhost:3000',
        )
    )
    assert response.status_code == 200
    assert response.headers.get('access-control-allow-origin') == 'http://localhost:3000'
    assert response.headers.get('access-control-allow-credentials') == 'true'


@pytest.mark.parametrize(
    'path,method',
    [
        ('/api/v1/rooms/ABCD/join', 'POST'),
        ('/api/v1/rooms/ABCD/state', 'GET'),
        ('/api/v1/rooms/ABCD/feed', 'GET'),
    ],
)
def test_cors_preflight_allows_vercel_preview_origin(path: str, method: str):
    preview_origin = 'https://leet-hard-git-feature-xyz.vercel.app'
    response = asyncio.run(_preflight(path, method, preview_origin))
    assert response.status_code == 200
    assert response.headers.get('access-control-allow-origin') == preview_origin
    assert response.headers.get('access-control-allow-credentials') == 'true'


def test_cors_preflight_blocks_disallowed_origin():
    response = asyncio.run(
        _preflight(
            '/api/v1/rooms/ABCD/join',
            'POST',
            'https://evil.example.com',
        )
    )
    assert response.status_code == 400
    assert response.headers.get('access-control-allow-origin') is None


@pytest.mark.parametrize(
    'path',
    [
        '/api/v1/rooms/ABCD/state/stream',
        '/api/v1/rooms/ABCD/feed/stream',
    ],
)
def test_removed_stream_endpoints_return_404(path: str):
    response = asyncio.run(_get(path, 'https://leet-hard.vercel.app'))
    assert response.status_code == 404


def test_room_feed_source_enum_uses_lowercase_values():
    engine = create_engine(
        'sqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    SessionTest = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    with SessionTest() as session:
        room = Room(
            room_code='ABC123',
            room_title='Enum Test Room',
            status=RoomStatus.LOBBY,
            problem_source=ProblemSource.RANDOM,
        )
        session.add(room)
        session.flush()

        participant = Participant(
            room_id=room.id,
            nickname='enum-user',
            leetcode_username='enum_user',
            token_hash='token',
            is_host=True,
        )
        session.add(participant)
        session.flush()

        event = RoomFeedEvent(
            room_id=room.id,
            participant_id=participant.id,
            event_type=RoomFeedEventType.SOLVE,
            source=SolveSource.MANUAL,
            actor_username=participant.leetcode_username,
            event_at=datetime.now(timezone.utc),
        )
        session.add(event)
        session.commit()

        loaded = session.get(RoomFeedEvent, event.id)
        assert loaded is not None
        assert loaded.source == SolveSource.MANUAL

    with engine.connect() as connection:
        raw_source = connection.execute(text('SELECT source FROM room_feed_events LIMIT 1')).scalar_one()
        assert raw_source == 'manual'
