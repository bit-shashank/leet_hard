from datetime import datetime, timedelta, timezone
import os
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault('DATABASE_URL', 'sqlite:///./test_bootstrap.db')

from app.db import get_db
from app.main import app
from app.models import Base, User
from app.security import get_current_user


@pytest.fixture()
def client(monkeypatch):
    engine = create_engine(
        'sqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    SessionTest = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    Base.metadata.create_all(bind=engine)

    db = SessionTest()
    db.add(
        User(
            id='topic-user',
            email='topic@example.com',
            primary_leetcode_username='topic_lc',
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
        return SimpleNamespace(
            id='topic-user',
            primary_leetcode_username='topic_lc',
            leetcode_username_locked=True,
            leetcode_verified_at=datetime.now(timezone.utc),
        )

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    try:
        yield TestClient(app), monkeypatch
    finally:
        app.dependency_overrides.clear()


def test_room_topics_endpoint_aggregates_tags(client):
    test_client, monkeypatch = client

    monkeypatch.setattr(
        'app.services.leetcode._fetch_topic_catalog_from_api',
        lambda: [
            {'slug': 'array', 'name': 'Array', 'count': 2},
            {'slug': 'dynamic-programming', 'name': 'DP', 'count': 1},
        ],
    )
    monkeypatch.setattr('app.services.leetcode._TOPIC_CACHE', {'expires_at': None, 'topics': []})

    response = test_client.get('/api/v1/rooms/topics')
    assert response.status_code == 200
    payload = response.json()
    slugs = {entry['slug'] for entry in payload}
    assert 'array' in slugs
    assert 'dynamic-programming' in slugs


def test_create_room_rejects_invalid_topic_slug(client):
    test_client, monkeypatch = client

    monkeypatch.setattr(
        'app.services.leetcode.get_topic_catalog',
        lambda: [{'slug': 'array', 'name': 'Array', 'count': 10}],
    )

    response = test_client.post(
        '/api/v1/rooms',
        json={
            'room_title': 'Topics Test',
            'settings': {
                'easy_count': 1,
                'medium_count': 1,
                'hard_count': 1,
                'duration_minutes': 60,
                'start_at': (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
                'topic_slugs': ['unknown-topic'],
            },
        },
    )
    assert response.status_code == 400
    assert 'Invalid topic slugs' in response.json()['detail']
