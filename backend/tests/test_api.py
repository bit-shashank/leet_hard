from datetime import datetime, timedelta, timezone
import os

import pytest
from fastapi import Depends, Header, HTTPException, status
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault('DATABASE_URL', 'sqlite:///./test_bootstrap.db')

from app.db import get_db
from app.main import app
from app.config import get_settings
from app.models import Base, Participant, ParticipantSolve, ProblemSource, Room, RoomStatus, User
from app.security import get_current_user
from app.services.leetcode import LeetCodeServiceError, ProblemSelectionError


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
        if not token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Unauthorized')

        user = db.scalar(select(User).where(User.id == token))
        if user is None:
            user = User(
                id=token,
                email=f'{token}@example.com',
                primary_leetcode_username=token,
                leetcode_verified_at=datetime.now(timezone.utc),
                leetcode_username_locked=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            return user

        dirty = False
        if user.primary_leetcode_username != token:
            user.primary_leetcode_username = token
            dirty = True
        if user.leetcode_verified_at is None:
            user.leetcode_verified_at = datetime.now(timezone.utc)
            dirty = True
        if not user.leetcode_username_locked:
            user.leetcode_username_locked = True
            dirty = True
        if dirty:
            db.commit()
            db.refresh(user)
        return user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    monkeypatch.setattr(
        'app.routers.rooms.get_user_avatar_url',
        lambda username: f'https://cdn.example.com/{username}.png',
    )
    monkeypatch.setattr('app.routers.rooms.get_recent_submissions', lambda username, limit=100: [])

    yield TestClient(app), SessionTest, monkeypatch

    app.dependency_overrides.clear()


def _make_problem(slug: str, difficulty: str, idx: int) -> dict:
    return {
        'title_slug': slug,
        'title': slug.replace('-', ' ').title(),
        'frontend_id': str(idx),
        'url': f'https://leetcode.com/problems/{slug}/',
        'difficulty': difficulty,
        'paid_only': False,
    }


def _auth_headers(user_id: str) -> dict[str, str]:
    return {'Authorization': f'Bearer {user_id}'}


def _create_room(
    test_client: TestClient,
    host_nickname: str = 'Host',
    host_username: str = 'host_lc',
    settings: dict | None = None,
):
    merged_settings = {
        'easy_count': 0,
        'medium_count': 4,
        'hard_count': 0,
        'duration_minutes': 60,
        'start_at': (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
        **(settings or {}),
    }
    if 'start_at' not in merged_settings:
        merged_settings['start_at'] = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()

    payload = {
        'room_title': f'{host_nickname} Room',
        'settings': merged_settings,
    }
    response = test_client.post('/api/v1/rooms', json=payload, headers=_auth_headers(host_username))
    assert response.status_code == 201
    data = response.json()
    data['participant_token'] = host_username
    return data


def _start_room(test_client: TestClient, SessionTest, room_code: str, token: str):
    db = SessionTest()
    room = db.query(Room).filter(Room.room_code == room_code).first()
    room.scheduled_start_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()
    db.close()

    response = test_client.get(
        f'/api/v1/rooms/{room_code}/state',
        headers=_auth_headers(token),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload['room']['status'] == 'active'
    return {'room': payload['room']}


def test_create_room_difficulty_validation_and_backcompat(client):
    test_client, _, _ = client
    start_at = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()

    explicit = test_client.post(
        '/api/v1/rooms',
        json={
            'room_title': 'Host Room',
            'settings': {
                'easy_count': 1,
                'medium_count': 2,
                'hard_count': 1,
                'duration_minutes': 60,
                'start_at': start_at,
            },
        },
        headers=_auth_headers('host_lc'),
    )
    assert explicit.status_code == 201
    explicit_room = explicit.json()['room']
    assert explicit_room['easy_count'] == 1
    assert explicit_room['medium_count'] == 2
    assert explicit_room['hard_count'] == 1
    assert explicit_room['problem_count'] == 4
    assert explicit_room['problem_source'] == 'random'
    assert explicit_room['strict_check'] is False

    invalid_total = test_client.post(
        '/api/v1/rooms',
        json={
            'room_title': 'Host2 Room',
            'settings': {
                'easy_count': 1,
                'medium_count': 1,
                'hard_count': 0,
                'start_at': start_at,
            },
        },
        headers=_auth_headers('host2_lc'),
    )
    assert invalid_total.status_code == 422

    backcompat = test_client.post(
        '/api/v1/rooms',
        json={
            'room_title': 'Host3 Room',
            'settings': {
                'problem_count': 5,
                'duration_minutes': 45,
                'start_at': start_at,
            },
        },
        headers=_auth_headers('host3_lc'),
    )
    assert backcompat.status_code == 201
    backcompat_room = backcompat.json()['room']
    assert backcompat_room['easy_count'] == 0
    assert backcompat_room['medium_count'] == 5
    assert backcompat_room['hard_count'] == 0
    assert backcompat_room['problem_count'] == 5
    assert backcompat_room['problem_source'] == 'random'
    assert backcompat_room['strict_check'] is False


def test_create_room_strict_check_default_and_explicit(client):
    test_client, _, _ = client
    start_at = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()

    default_resp = test_client.post(
        '/api/v1/rooms',
        json={
            'room_title': 'Default Strict Room',
            'settings': {
                'easy_count': 1,
                'medium_count': 2,
                'hard_count': 0,
                'start_at': start_at,
            },
        },
        headers=_auth_headers('default_strict_lc'),
    )
    assert default_resp.status_code == 201
    assert default_resp.json()['room']['strict_check'] is False

    explicit_resp = test_client.post(
        '/api/v1/rooms',
        json={
            'room_title': 'Explicit Strict Room',
            'settings': {
                'easy_count': 1,
                'medium_count': 2,
                'hard_count': 0,
                'strict_check': True,
                'start_at': start_at,
            },
        },
        headers=_auth_headers('explicit_strict_lc'),
    )
    assert explicit_resp.status_code == 201
    assert explicit_resp.json()['room']['strict_check'] is True


def test_create_room_problem_source_validation(client):
    test_client, _, _ = client
    start_at = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()

    valid = test_client.post(
        '/api/v1/rooms',
        json={
            'room_title': 'Sheet Host Room',
            'settings': {
                'easy_count': 1,
                'medium_count': 2,
                'hard_count': 0,
                'problem_source': 'neetcode_150',
                'start_at': start_at,
            },
        },
        headers=_auth_headers('sheet_host_lc'),
    )
    assert valid.status_code == 201
    assert valid.json()['room']['problem_source'] == 'neetcode_150'

    a2z_valid = test_client.post(
        '/api/v1/rooms',
        json={
            'room_title': 'A2Z Host Room',
            'settings': {
                'easy_count': 1,
                'medium_count': 2,
                'hard_count': 0,
                'problem_source': 'striver_a2z_sheet',
                'start_at': start_at,
            },
        },
        headers=_auth_headers('a2z_host_lc'),
    )
    assert a2z_valid.status_code == 201
    assert a2z_valid.json()['room']['problem_source'] == 'striver_a2z_sheet'

    invalid = test_client.post(
        '/api/v1/rooms',
        json={
            'room_title': 'Bad Host Room',
            'settings': {
                'easy_count': 1,
                'medium_count': 2,
                'hard_count': 0,
                'problem_source': 'unknown_sheet',
                'start_at': start_at,
            },
        },
        headers=_auth_headers('bad_host_lc'),
    )
    assert invalid.status_code == 422


def test_discover_rooms_returns_lobby_and_active_with_host_data(client):
    test_client, SessionTest, monkeypatch = client

    monkeypatch.setattr(
        'app.routers.rooms.choose_random_problems_by_source',
        lambda source, easy_count, medium_count, hard_count, excluded_slugs=None, topic_slugs=None: [
            _make_problem('two-sum', 'Easy', 1),
            _make_problem('add-two-numbers', 'Medium', 2),
            _make_problem('merge-k-sorted-lists', 'Hard', 3),
        ][: easy_count + medium_count + hard_count],
    )

    lobby_room = _create_room(
        test_client,
        host_nickname='LobbyHost',
        host_username='lobby_host_lc',
        settings={'easy_count': 0, 'medium_count': 3, 'hard_count': 0, 'duration_minutes': 60},
    )

    active_room = _create_room(
        test_client,
        host_nickname='ActiveHost',
        host_username='active_host_lc',
        settings={'easy_count': 1, 'medium_count': 1, 'hard_count': 1, 'duration_minutes': 60},
    )
    active_code = active_room['room']['room_code']
    _start_room(test_client, SessionTest, active_code, active_room['participant_token'])

    join_active = test_client.post(
        f'/api/v1/rooms/{active_code}/join',
        json={},
        headers=_auth_headers('runner_lc'),
    )
    assert join_active.status_code == 200

    ended_room = _create_room(
        test_client,
        host_nickname='EndedHost',
        host_username='ended_host_lc',
        settings={'easy_count': 0, 'medium_count': 3, 'hard_count': 0, 'duration_minutes': 60},
    )

    db = SessionTest()
    ended_row = db.query(Room).filter(Room.room_code == ended_room['room']['room_code']).first()
    ended_row.status = RoomStatus.ENDED
    db.commit()
    db.close()

    discover = test_client.get('/api/v1/rooms/discover')
    assert discover.status_code == 200
    cards = discover.json()

    codes = {card['room_code'] for card in cards}
    assert lobby_room['room']['room_code'] in codes
    assert active_code in codes
    assert ended_room['room']['room_code'] not in codes

    active_card = next(card for card in cards if card['room_code'] == active_code)
    assert active_card['status'] == 'active'
    assert active_card['participant_count'] == 2
    assert active_card['host_leetcode_username'] == 'active_host_lc'
    assert active_card['host_avatar_url'] == 'https://cdn.example.com/active_host_lc.png'
    assert active_card['joinable'] is True
    assert active_card['problem_source'] == 'random'


def test_join_active_room_succeeds_join_ended_fails(client):
    test_client, SessionTest, monkeypatch = client

    monkeypatch.setattr(
        'app.routers.rooms.choose_random_problems_by_source',
        lambda source, easy_count, medium_count, hard_count, excluded_slugs=None, topic_slugs=None: [
            _make_problem('add-two-numbers', 'Medium', 1),
            _make_problem('3sum', 'Medium', 2),
            _make_problem('group-anagrams', 'Medium', 3),
        ][: easy_count + medium_count + hard_count],
    )

    created = _create_room(
        test_client,
        settings={'easy_count': 0, 'medium_count': 3, 'hard_count': 0, 'duration_minutes': 60},
    )
    room_code = created['room']['room_code']
    host_token = created['participant_token']
    _start_room(test_client, SessionTest, room_code, host_token)

    active_join = test_client.post(
        f'/api/v1/rooms/{room_code}/join',
        json={},
        headers=_auth_headers('late_joiner_lc'),
    )
    assert active_join.status_code == 200

    db = SessionTest()
    room = db.query(Room).filter(Room.room_code == room_code).first()
    room.status = RoomStatus.ENDED
    db.commit()
    db.close()

    ended_join = test_client.post(
        f'/api/v1/rooms/{room_code}/join',
        json={},
        headers=_auth_headers('too_late_lc'),
    )
    assert ended_join.status_code == 400


def test_start_room_assigns_exact_difficulty_mix(client):
    test_client, SessionTest, monkeypatch = client

    captured: dict[str, int | str] = {}

    def _select(
        source: ProblemSource,
        easy_count: int,
        medium_count: int,
        hard_count: int,
        topic_slugs=None,
        **_,
    ):
        captured['source'] = source.value
        captured['easy'] = easy_count
        captured['medium'] = medium_count
        captured['hard'] = hard_count
        return [
            _make_problem('two-sum', 'Easy', 1),
            _make_problem('valid-parentheses', 'Easy', 2),
            _make_problem('add-two-numbers', 'Medium', 3),
            _make_problem('merge-k-sorted-lists', 'Hard', 4),
        ]

    monkeypatch.setattr('app.routers.rooms.choose_random_problems_by_source', _select)

    created = _create_room(
        test_client,
        settings={'easy_count': 2, 'medium_count': 1, 'hard_count': 1, 'duration_minutes': 60},
    )
    room_code = created['room']['room_code']
    host_token = created['participant_token']

    start = _start_room(test_client, SessionTest, room_code, host_token)
    assert start['room']['status'] == 'active'
    assert captured == {'source': 'random', 'easy': 2, 'medium': 1, 'hard': 1}

    state = test_client.get(
        f'/api/v1/rooms/{room_code}/state',
        headers=_auth_headers(host_token),
    )
    assert state.status_code == 200

    by_difficulty: dict[str, int] = {}
    for problem in state.json()['problems']:
        by_difficulty[problem['difficulty']] = by_difficulty.get(problem['difficulty'], 0) + 1

    assert by_difficulty.get('Easy', 0) == 2
    assert by_difficulty.get('Medium', 0) == 1
    assert by_difficulty.get('Hard', 0) == 1


def test_late_join_window_ignores_submissions_before_participant_join(client):
    test_client, SessionTest, monkeypatch = client
    monkeypatch.setenv('AUTO_SOLVE_SYNC_ENABLED', 'true')
    get_settings.cache_clear()

    target_slug = 'add-two-numbers'

    monkeypatch.setattr(
        'app.routers.rooms.choose_random_problems_by_source',
        lambda source, easy_count, medium_count, hard_count, excluded_slugs=None, topic_slugs=None: [
            _make_problem(target_slug, 'Medium', 1),
            _make_problem('3sum', 'Medium', 2),
            _make_problem('group-anagrams', 'Medium', 3),
        ],
    )

    base_time = datetime.now(timezone.utc)
    early = base_time + timedelta(minutes=5)
    valid = base_time + timedelta(minutes=15)

    def _submissions(username: str, limit: int = 100):
        if username == 'late_user_lc':
            return [
                {
                    'titleSlug': target_slug,
                    'statusDisplay': 'Accepted',
                    'status': 10,
                    'timestamp': int(early.timestamp()),
                },
                {
                    'titleSlug': target_slug,
                    'statusDisplay': 'Accepted',
                    'status': 10,
                    'timestamp': int(valid.timestamp()),
                },
            ]
        return []

    monkeypatch.setattr('app.routers.rooms.get_recent_submissions', _submissions)

    created = _create_room(
        test_client,
        settings={'easy_count': 0, 'medium_count': 3, 'hard_count': 0, 'duration_minutes': 60},
    )
    room_code = created['room']['room_code']
    host_token = created['participant_token']
    _start_room(test_client, SessionTest, room_code, host_token)

    late_join = test_client.post(
        f'/api/v1/rooms/{room_code}/join',
        json={},
        headers=_auth_headers('late_user_lc'),
    )
    assert late_join.status_code == 200
    late_token = 'late_user_lc'

    db = SessionTest()
    room = db.query(Room).filter(Room.room_code == room_code).first()
    room.starts_at = base_time
    room.ends_at = base_time + timedelta(hours=1)
    room.status = RoomStatus.ACTIVE
    room.last_synced_at = None

    late_participant = (
        db.query(Participant)
        .filter(Participant.room_id == room.id, Participant.leetcode_username == 'late_user_lc')
        .first()
    )
    late_participant.joined_at = base_time + timedelta(minutes=10)

    db.commit()
    db.close()

    state = test_client.get(
        f'/api/v1/rooms/{room_code}/state',
        headers=_auth_headers(late_token),
    )
    assert state.status_code == 200

    payload = state.json()
    assert target_slug in payload['my_solved_slugs']

    late_entry = next(
        entry for entry in payload['leaderboard'] if entry['leetcode_username'] == 'late_user_lc'
    )
    assert late_entry['solved_count'] == 1
    assert late_entry['avatar_url'] == 'https://cdn.example.com/late_user_lc.png'


def test_start_room_uses_selected_problem_source(client):
    test_client, SessionTest, monkeypatch = client

    captured: dict[str, str] = {}

    def _select(
        source: ProblemSource,
        easy_count: int,
        medium_count: int,
        hard_count: int,
        topic_slugs=None,
        **_,
    ):
        captured['source'] = source.value
        return [
            _make_problem('contains-duplicate', 'Easy', 1),
            _make_problem('top-k-frequent-elements', 'Medium', 2),
            _make_problem('trapping-rain-water', 'Hard', 3),
        ]

    monkeypatch.setattr('app.routers.rooms.choose_random_problems_by_source', _select)

    created = _create_room(
        test_client,
        settings={
            'easy_count': 1,
            'medium_count': 1,
            'hard_count': 1,
            'duration_minutes': 60,
            'problem_source': 'blind_75',
        },
    )
    room_code = created['room']['room_code']
    host_token = created['participant_token']

    start = _start_room(test_client, SessionTest, room_code, host_token)
    assert start['room']['problem_source'] == 'blind_75'
    assert captured == {'source': 'blind_75'}


def test_start_room_sheet_source_insufficient_pool_returns_4xx(client):
    test_client, SessionTest, monkeypatch = client

    monkeypatch.setattr(
        'app.routers.rooms.choose_random_problems_by_source',
        lambda source, easy_count, medium_count, hard_count, excluded_slugs=None, topic_slugs=None: (_ for _ in ()).throw(
            ProblemSelectionError('Selected source "blind_75" has only 2 available non-paid problems')
        ),
    )

    created = _create_room(
        test_client,
        settings={
            'easy_count': 1,
            'medium_count': 2,
            'hard_count': 1,
            'duration_minutes': 60,
            'problem_source': 'blind_75',
        },
    )

    db = SessionTest()
    room = db.query(Room).filter(Room.room_code == created['room']['room_code']).first()
    room.scheduled_start_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()
    db.close()

    response = test_client.get(
        f"/api/v1/rooms/{created['room']['room_code']}/state",
        headers=_auth_headers(created['participant_token']),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload['room']['status'] == 'lobby'
    assert 'Auto-start failed' in (payload['room']['sync_warning'] or '')


def test_manual_solve_strict_mode_succeeds_with_verified_submission(client):
    test_client, SessionTest, monkeypatch = client
    target_slug = 'add-two-numbers'
    base_time = datetime.now(timezone.utc)
    verified_ts = base_time + timedelta(minutes=12)
    later_ts = base_time + timedelta(minutes=17)

    monkeypatch.setattr(
        'app.routers.rooms.choose_random_problems_by_source',
        lambda source, easy_count, medium_count, hard_count, excluded_slugs=None, topic_slugs=None: [
            _make_problem(target_slug, 'Medium', 1),
            _make_problem('3sum', 'Medium', 2),
            _make_problem('group-anagrams', 'Medium', 3),
        ],
    )
    monkeypatch.setattr(
        'app.routers.rooms.get_recent_submissions',
        lambda username, limit=100: [
            {
                'titleSlug': target_slug,
                'statusDisplay': 'Wrong Answer',
                'status': 11,
                'timestamp': int((base_time + timedelta(minutes=8)).timestamp()),
            },
            {
                'titleSlug': target_slug,
                'statusDisplay': 'Accepted',
                'status': 10,
                'timestamp': int(verified_ts.timestamp()),
                'submissionId': 987654321,
            },
            {
                'titleSlug': target_slug,
                'statusDisplay': 'Accepted',
                'status': 10,
                'timestamp': int(later_ts.timestamp()),
            },
        ],
    )

    created = _create_room(
        test_client,
        settings={
            'easy_count': 0,
            'medium_count': 3,
            'hard_count': 0,
            'duration_minutes': 60,
            'strict_check': True,
        },
    )
    room_code = created['room']['room_code']
    host_token = created['participant_token']
    _start_room(test_client, SessionTest, room_code, host_token)

    db = SessionTest()
    room = db.query(Room).filter(Room.room_code == room_code).first()
    host = db.query(Participant).filter(Participant.room_id == room.id, Participant.is_host.is_(True)).first()
    room.starts_at = base_time
    room.ends_at = base_time + timedelta(hours=1)
    host.joined_at = base_time - timedelta(minutes=1)
    db.commit()
    db.close()

    mark = test_client.post(
        f'/api/v1/rooms/{room_code}/solves/manual',
        json={'problem_slug': target_slug, 'solved': True},
        headers=_auth_headers(host_token),
    )
    assert mark.status_code == 200

    db = SessionTest()
    room = db.query(Room).filter(Room.room_code == room_code).first()
    host = db.query(Participant).filter(Participant.room_id == room.id, Participant.is_host.is_(True)).first()
    solve = (
        db.query(ParticipantSolve)
        .filter(
            ParticipantSolve.room_id == room.id,
            ParticipantSolve.participant_id == host.id,
            ParticipantSolve.problem_slug == target_slug,
        )
        .first()
    )
    assert solve is not None
    stored = solve.first_solved_at
    if stored.tzinfo is None:
        stored = stored.replace(tzinfo=timezone.utc)
    assert int(stored.timestamp()) == int(verified_ts.timestamp())
    assert solve.submission_url == 'https://leetcode.com/submissions/detail/987654321/'
    db.close()


def test_manual_solve_strict_mode_fails_when_no_verified_submission(client):
    test_client, SessionTest, monkeypatch = client
    target_slug = 'add-two-numbers'

    monkeypatch.setattr(
        'app.routers.rooms.choose_random_problems_by_source',
        lambda source, easy_count, medium_count, hard_count, excluded_slugs=None, topic_slugs=None: [
            _make_problem(target_slug, 'Medium', 1),
            _make_problem('3sum', 'Medium', 2),
            _make_problem('group-anagrams', 'Medium', 3),
        ],
    )
    monkeypatch.setattr(
        'app.routers.rooms.get_recent_submissions',
        lambda username, limit=100: [
            {
                'titleSlug': target_slug,
                'statusDisplay': 'Wrong Answer',
                'status': 11,
                'timestamp': int(datetime.now(timezone.utc).timestamp()),
            }
        ],
    )

    created = _create_room(
        test_client,
        settings={
            'easy_count': 0,
            'medium_count': 3,
            'hard_count': 0,
            'duration_minutes': 60,
            'strict_check': True,
        },
    )
    room_code = created['room']['room_code']
    host_token = created['participant_token']
    _start_room(test_client, SessionTest, room_code, host_token)

    mark = test_client.post(
        f'/api/v1/rooms/{room_code}/solves/manual',
        json={'problem_slug': target_slug, 'solved': True},
        headers=_auth_headers(host_token),
    )
    assert mark.status_code == 400
    assert 'Strict verification failed' in mark.json()['detail']


def test_manual_solve_strict_mode_fails_when_submission_outside_window(client):
    test_client, SessionTest, monkeypatch = client
    target_slug = 'add-two-numbers'
    base_time = datetime.now(timezone.utc)
    submission_ts = base_time + timedelta(minutes=5)

    monkeypatch.setattr(
        'app.routers.rooms.choose_random_problems_by_source',
        lambda source, easy_count, medium_count, hard_count, excluded_slugs=None, topic_slugs=None: [
            _make_problem(target_slug, 'Medium', 1),
            _make_problem('3sum', 'Medium', 2),
            _make_problem('group-anagrams', 'Medium', 3),
        ],
    )
    monkeypatch.setattr(
        'app.routers.rooms.get_recent_submissions',
        lambda username, limit=100: [
            {
                'titleSlug': target_slug,
                'statusDisplay': 'Accepted',
                'status': 10,
                'timestamp': int(submission_ts.timestamp()),
            }
        ],
    )

    created = _create_room(
        test_client,
        settings={
            'easy_count': 0,
            'medium_count': 3,
            'hard_count': 0,
            'duration_minutes': 60,
            'strict_check': True,
        },
    )
    room_code = created['room']['room_code']
    host_token = created['participant_token']
    _start_room(test_client, SessionTest, room_code, host_token)

    db = SessionTest()
    room = db.query(Room).filter(Room.room_code == room_code).first()
    host = db.query(Participant).filter(Participant.room_id == room.id, Participant.is_host.is_(True)).first()
    room.starts_at = base_time
    room.ends_at = base_time + timedelta(hours=1)
    host.joined_at = base_time + timedelta(minutes=10)
    db.commit()
    db.close()

    mark = test_client.post(
        f'/api/v1/rooms/{room_code}/solves/manual',
        json={'problem_slug': target_slug, 'solved': True},
        headers=_auth_headers(host_token),
    )
    assert mark.status_code == 400
    assert 'Strict verification failed' in mark.json()['detail']


def test_manual_solve_strict_mode_fails_closed_on_submission_api_error(client):
    test_client, SessionTest, monkeypatch = client
    target_slug = 'add-two-numbers'

    monkeypatch.setattr(
        'app.routers.rooms.choose_random_problems_by_source',
        lambda source, easy_count, medium_count, hard_count, excluded_slugs=None, topic_slugs=None: [
            _make_problem(target_slug, 'Medium', 1),
            _make_problem('3sum', 'Medium', 2),
            _make_problem('group-anagrams', 'Medium', 3),
        ],
    )

    def _raise_submission_error(username: str, limit: int = 100):
        raise LeetCodeServiceError('upstream down')

    monkeypatch.setattr('app.routers.rooms.get_recent_submissions', _raise_submission_error)

    created = _create_room(
        test_client,
        settings={
            'easy_count': 0,
            'medium_count': 3,
            'hard_count': 0,
            'duration_minutes': 60,
            'strict_check': True,
        },
    )
    room_code = created['room']['room_code']
    host_token = created['participant_token']
    _start_room(test_client, SessionTest, room_code, host_token)

    mark = test_client.post(
        f'/api/v1/rooms/{room_code}/solves/manual',
        json={'problem_slug': target_slug, 'solved': True},
        headers=_auth_headers(host_token),
    )
    assert mark.status_code == 503
    assert 'Strict verification unavailable' in mark.json()['detail']


def test_manual_solve_non_strict_mode_unchanged(client):
    test_client, SessionTest, monkeypatch = client
    target_slug = 'add-two-numbers'

    monkeypatch.setattr(
        'app.routers.rooms.choose_random_problems_by_source',
        lambda source, easy_count, medium_count, hard_count, excluded_slugs=None, topic_slugs=None: [
            _make_problem(target_slug, 'Medium', 1),
            _make_problem('3sum', 'Medium', 2),
            _make_problem('group-anagrams', 'Medium', 3),
        ],
    )

    def _raise_submission_error(username: str, limit: int = 100):
        raise LeetCodeServiceError('should not be called in non-strict mode')

    monkeypatch.setattr('app.routers.rooms.get_recent_submissions', _raise_submission_error)

    created = _create_room(
        test_client,
        settings={
            'easy_count': 0,
            'medium_count': 3,
            'hard_count': 0,
            'duration_minutes': 60,
            'strict_check': False,
        },
    )
    room_code = created['room']['room_code']
    host_token = created['participant_token']
    _start_room(test_client, SessionTest, room_code, host_token)

    mark = test_client.post(
        f'/api/v1/rooms/{room_code}/solves/manual',
        json={'problem_slug': target_slug, 'solved': True},
        headers=_auth_headers(host_token),
    )
    assert mark.status_code == 200
