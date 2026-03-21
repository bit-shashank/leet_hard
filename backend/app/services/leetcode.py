import random
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import httpx

from app.config import get_settings
from app.models import ProblemSource
from app.services.problem_sheets import get_sheet_slugs

_POOL_CACHE: dict[str, Any] = {
    'expires_at': None,
    'problems_by_difficulty': {},
}


class LeetCodeServiceError(RuntimeError):
    pass


class ProblemSelectionError(LeetCodeServiceError):
    pass


def _normalize_slug(slug: str) -> str:
    return slug.strip().strip('/').lower()


def _client() -> httpx.Client:
    settings = get_settings()
    return httpx.Client(base_url=settings.leetcode_api_base_url, timeout=10.0)


def _refresh_problem_pool() -> List[Dict[str, Any]]:
    return _refresh_problem_pool_for_difficulty('Medium')


def _refresh_problem_pool_for_difficulty(difficulty: str) -> List[Dict[str, Any]]:
    problems: List[Dict[str, Any]] = []
    skip = 0
    limit = 500
    total = None

    with _client() as client:
        while True:
            response = client.get(
                '/problems/filter',
                params={
                    'difficulty': difficulty,
                    'paid_only': 'false',
                    'limit': limit,
                    'skip': skip,
                },
            )
            if response.status_code >= 400:
                raise LeetCodeServiceError(
                    f'LeetCode API {difficulty} problem pool request failed: {response.status_code}'
                )

            payload = response.json()
            page = payload.get('problems', [])
            if total is None:
                total = int(payload.get('total', 0))

            if not page:
                break

            filtered = [problem for problem in page if not problem.get('paid_only', False)]
            problems.extend(filtered)
            skip += limit

            if total is not None and skip >= total:
                break

    if not problems:
        raise LeetCodeServiceError(f'{difficulty} problem pool is empty from LeetCode API')

    return problems


def get_problem_pool(difficulty: str) -> List[Dict[str, Any]]:
    normalized_difficulty = difficulty.strip().title()
    now = datetime.now(timezone.utc)
    expires_at = _POOL_CACHE.get('expires_at')
    problems_by_difficulty: dict[str, List[Dict[str, Any]]] = _POOL_CACHE.get(
        'problems_by_difficulty', {}
    )

    if expires_at and expires_at > now and problems_by_difficulty.get(normalized_difficulty):
        return problems_by_difficulty[normalized_difficulty]

    problems = _refresh_problem_pool_for_difficulty(normalized_difficulty)
    problems_by_difficulty[normalized_difficulty] = problems
    _POOL_CACHE['problems_by_difficulty'] = problems_by_difficulty
    _POOL_CACHE['expires_at'] = now + timedelta(hours=1)
    return problems


def choose_random_problems_by_difficulty(
    easy_count: int,
    medium_count: int,
    hard_count: int,
) -> List[Dict[str, Any]]:
    selected: List[Dict[str, Any]] = []

    difficulty_plan = [
        ('Easy', easy_count),
        ('Medium', medium_count),
        ('Hard', hard_count),
    ]

    for difficulty, count in difficulty_plan:
        if count <= 0:
            continue
        problems = get_problem_pool(difficulty)
        if count > len(problems):
            raise ProblemSelectionError(
                f'Requested {count} {difficulty} problems exceeds available problem pool'
            )
        selected.extend(random.sample(problems, count))

    random.shuffle(selected)
    return selected


def choose_random_problems_by_source(
    source: ProblemSource,
    easy_count: int,
    medium_count: int,
    hard_count: int,
) -> List[Dict[str, Any]]:
    if source == ProblemSource.RANDOM:
        return choose_random_problems_by_difficulty(easy_count, medium_count, hard_count)

    total_requested = easy_count + medium_count + hard_count
    sheet_slugs = get_sheet_slugs(source)

    all_candidates: dict[str, Dict[str, Any]] = {}
    for difficulty in ('Easy', 'Medium', 'Hard'):
        for problem in get_problem_pool(difficulty):
            slug = problem.get('title_slug') or problem.get('titleSlug')
            if not slug:
                continue

            normalized_slug = _normalize_slug(slug)
            if normalized_slug not in sheet_slugs:
                continue

            all_candidates[normalized_slug] = problem

    if len(all_candidates) < total_requested:
        raise ProblemSelectionError(
            f'Selected source "{source.value}" has only {len(all_candidates)} '
            f'available non-paid problems, but {total_requested} are required'
        )

    by_difficulty: dict[str, list[Dict[str, Any]]] = {
        'Easy': [],
        'Medium': [],
        'Hard': [],
    }
    for problem in all_candidates.values():
        difficulty = (problem.get('difficulty') or 'Medium').title()
        if difficulty not in by_difficulty:
            difficulty = 'Medium'
        by_difficulty[difficulty].append(problem)

    selected: list[Dict[str, Any]] = []
    selected_slugs: set[str] = set()
    difficulty_plan = [('Easy', easy_count), ('Medium', medium_count), ('Hard', hard_count)]

    for difficulty, count in difficulty_plan:
        if count <= 0:
            continue
        available = [
            problem
            for problem in by_difficulty[difficulty]
            if _normalize_slug(problem.get('title_slug') or problem.get('titleSlug') or '')
            not in selected_slugs
        ]
        take_count = min(count, len(available))
        if take_count == 0:
            continue

        picks = random.sample(available, take_count)
        selected.extend(picks)
        for pick in picks:
            normalized = _normalize_slug(pick.get('title_slug') or pick.get('titleSlug') or '')
            if normalized:
                selected_slugs.add(normalized)

    remaining_count = total_requested - len(selected)
    if remaining_count > 0:
        fallback_candidates = [
            problem
            for problem in all_candidates.values()
            if _normalize_slug(problem.get('title_slug') or problem.get('titleSlug') or '')
            not in selected_slugs
        ]
        if len(fallback_candidates) < remaining_count:
            raise ProblemSelectionError(
                f'Selected source "{source.value}" cannot satisfy requested total '
                f'{total_requested} with current difficulty mix'
            )

        picks = random.sample(fallback_candidates, remaining_count)
        selected.extend(picks)

    random.shuffle(selected)
    return selected


def choose_random_medium_non_paid_problems(count: int) -> List[Dict[str, Any]]:
    return choose_random_problems_by_difficulty(0, count, 0)


def get_recent_submissions(username: str, limit: int = 100) -> List[Dict[str, Any]]:
    with _client() as client:
        response = client.get(f'/user/{username}/submissions', params={'limit': limit})
        if response.status_code >= 400:
            raise LeetCodeServiceError(
                f'Submissions request failed for {username}: {response.status_code}'
            )
        payload = response.json()

    if not isinstance(payload, list):
        raise LeetCodeServiceError('Unexpected submissions payload shape from LeetCode API')

    return payload


def get_user_avatar_url(username: str) -> str | None:
    with _client() as client:
        response = client.get(f'/user/{username}')
        if response.status_code >= 400:
            raise LeetCodeServiceError(
                f'User profile request failed for {username}: {response.status_code}'
            )
        payload = response.json()

    if not isinstance(payload, dict):
        raise LeetCodeServiceError('Unexpected user profile payload shape from LeetCode API')

    profile = payload.get('profile')
    if isinstance(profile, dict):
        avatar = profile.get('userAvatar')
        if isinstance(avatar, str) and avatar.strip():
            return avatar.strip()

    avatar = payload.get('userAvatar')
    if isinstance(avatar, str) and avatar.strip():
        return avatar.strip()

    return None
