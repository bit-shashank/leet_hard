import random
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set

import httpx

from app.config import get_settings
from app.models import ProblemSource
from app.services.problem_sheets import get_sheet_slugs

_POOL_CACHE: dict[str, Any] = {
    'expires_at': None,
    'problems_by_difficulty': {},
}
_TOPIC_CACHE: dict[str, Any] = {
    'expires_at': None,
    'topics': [],
}
_TAG_PROBLEM_CACHE: dict[str, Any] = {
    'expires_at': None,
    'problem_slugs_by_tag': {},
}


class LeetCodeServiceError(RuntimeError):
    pass


class ProblemSelectionError(LeetCodeServiceError):
    pass


def _normalize_slug(slug: str) -> str:
    return slug.strip().strip('/').lower()


def normalize_topic_slug(value: str) -> str:
    cleaned = value.strip().lower()
    cleaned = re.sub(r'[^a-z0-9]+', '-', cleaned).strip('-')
    return cleaned


def _extract_topic_tags(problem: Dict[str, Any]) -> List[Dict[str, str]]:
    raw = problem.get('topicTags') or problem.get('topic_tags') or problem.get('topics')
    if not raw:
        return []
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        return []

    tags: list[Dict[str, str]] = []
    for entry in raw:
        slug = None
        name = None
        if isinstance(entry, dict):
            slug = entry.get('slug') or entry.get('name') or entry.get('tag_slug')
            name = entry.get('name') or entry.get('slug') or entry.get('tag_name')
        elif isinstance(entry, str):
            slug = entry
            name = entry
        if not slug:
            continue
        normalized_slug = normalize_topic_slug(str(slug))
        if not normalized_slug:
            continue
        display_name = str(name or slug).strip()
        if not display_name:
            display_name = normalized_slug.replace('-', ' ').title()
        tags.append({'slug': normalized_slug, 'name': display_name})

    return tags


def _problem_matches_topics(problem: Dict[str, Any], topic_slugs: Set[str]) -> bool:
    if not topic_slugs:
        return True
    tags = _extract_topic_tags(problem)
    if not tags:
        return False
    return any(tag['slug'] in topic_slugs for tag in tags)


def _fetch_topic_catalog_from_api() -> List[Dict[str, Any]]:
    with _client() as client:
        response = client.get('/tags')
        if response.status_code >= 400:
            raise LeetCodeServiceError(
                f'LeetCode API topics request failed: {response.status_code}'
            )
        payload = response.json()

    if not isinstance(payload, list):
        raise LeetCodeServiceError('Unexpected topics payload from LeetCode API')

    topics: list[Dict[str, Any]] = []
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        slug = entry.get('slug') or entry.get('tag_slug') or entry.get('name')
        name = entry.get('name') or entry.get('tag_name') or entry.get('slug')
        count = entry.get('problem_count') or entry.get('count') or entry.get('problems')
        normalized_slug = normalize_topic_slug(str(slug)) if slug else ''
        if not normalized_slug:
            continue
        display_name = str(name or normalized_slug).strip() or normalized_slug.replace('-', ' ').title()
        try:
            count_value = int(count)
        except (TypeError, ValueError):
            count_value = 0
        topics.append({'slug': normalized_slug, 'name': display_name, 'count': count_value})

    topics.sort(key=lambda item: (-item['count'], item['name'].lower()))
    return topics


def _fetch_problem_slugs_for_tag(tag_slug: str) -> Set[str]:
    normalized = normalize_topic_slug(tag_slug)
    if not normalized:
        return set()

    limit = 200
    skip = 0
    total = None
    collected: set[str] = set()

    with _client() as client:
        while True:
            response = client.get(f'/problems/tag/{normalized}', params={'limit': limit, 'skip': skip})
            if response.status_code >= 400:
                raise LeetCodeServiceError(
                    f'LeetCode API tag "{normalized}" request failed: {response.status_code}'
                )
            payload = response.json()
            if not isinstance(payload, dict):
                raise LeetCodeServiceError('Unexpected tag problem payload from LeetCode API')

            problems = payload.get('problems', [])
            if total is None:
                try:
                    total = int(payload.get('total', 0))
                except (TypeError, ValueError):
                    total = None

            if not problems:
                break

            for problem in problems:
                if not isinstance(problem, dict):
                    continue
                if problem.get('paid_only', False):
                    continue
                slug = problem.get('title_slug') or problem.get('titleSlug')
                if not slug:
                    continue
                collected.add(_normalize_slug(str(slug)))

            skip += limit
            if total is not None and skip >= total:
                break

    return collected


def _get_problem_slugs_for_topics(topic_slugs: Set[str]) -> Set[str]:
    if not topic_slugs:
        return set()

    now = datetime.now(timezone.utc)
    expires_at = _TAG_PROBLEM_CACHE.get('expires_at')
    cached: dict[str, Set[str]] = _TAG_PROBLEM_CACHE.get('problem_slugs_by_tag', {})
    if not isinstance(cached, dict):
        cached = {}
    if not expires_at or expires_at <= now:
        cached = {}

    combined: set[str] = set()
    for raw_slug in topic_slugs:
        normalized = normalize_topic_slug(raw_slug)
        if not normalized:
            continue
        if normalized in cached:
            combined.update(cached[normalized])
            continue
        slugs = _fetch_problem_slugs_for_tag(normalized)
        cached[normalized] = slugs
        combined.update(slugs)

    _TAG_PROBLEM_CACHE['problem_slugs_by_tag'] = cached
    _TAG_PROBLEM_CACHE['expires_at'] = now + timedelta(hours=1)
    return combined


def get_topic_catalog() -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    expires_at = _TOPIC_CACHE.get('expires_at')
    cached = _TOPIC_CACHE.get('topics', [])
    if expires_at and expires_at > now and cached:
        return cached

    try:
        topics = _fetch_topic_catalog_from_api()
    except LeetCodeServiceError:
        if cached:
            return cached
        raise

    _TOPIC_CACHE['topics'] = topics
    _TOPIC_CACHE['expires_at'] = now + timedelta(hours=1)
    return topics


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
    excluded_slugs: Optional[Set[str]] = None,
    topic_slugs: Optional[Set[str]] = None,
) -> List[Dict[str, Any]]:
    selected: List[Dict[str, Any]] = []
    excluded = {_normalize_slug(slug) for slug in (excluded_slugs or set()) if slug}
    topic_set = {normalize_topic_slug(slug) for slug in (topic_slugs or set()) if slug}
    topic_problem_slugs = _get_problem_slugs_for_topics(topic_set) if topic_set else set()

    difficulty_plan = [
        ('Easy', easy_count),
        ('Medium', medium_count),
        ('Hard', hard_count),
    ]

    for difficulty, count in difficulty_plan:
        if count <= 0:
            continue
        problems = get_problem_pool(difficulty)
        if topic_set:
            problems = [
                problem
                for problem in problems
                if _normalize_slug(problem.get('title_slug') or problem.get('titleSlug') or '')
                in topic_problem_slugs
            ]
            if not problems:
                raise ProblemSelectionError(
                    f'No {difficulty} problems match topics: {", ".join(sorted(topic_set))}'
                )
        if excluded:
            problems = [
                problem
                for problem in problems
                if _normalize_slug(problem.get('title_slug') or problem.get('titleSlug') or '')
                not in excluded
            ]
        if count > len(problems):
            if topic_set:
                raise ProblemSelectionError(
                    f'Requested {count} {difficulty} problems exceeds available '
                    f'topic-filtered pool for: {", ".join(sorted(topic_set))}'
                )
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
    excluded_slugs: Optional[Set[str]] = None,
    topic_slugs: Optional[Set[str]] = None,
) -> List[Dict[str, Any]]:
    excluded = {_normalize_slug(slug) for slug in (excluded_slugs or set()) if slug}
    topic_set = {normalize_topic_slug(slug) for slug in (topic_slugs or set()) if slug}
    topic_problem_slugs = _get_problem_slugs_for_topics(topic_set) if topic_set else set()

    if source == ProblemSource.RANDOM:
        return choose_random_problems_by_difficulty(
            easy_count,
            medium_count,
            hard_count,
            excluded_slugs=excluded,
            topic_slugs=topic_set,
        )

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
            if normalized_slug in excluded:
                continue
            if topic_set and normalized_slug not in topic_problem_slugs:
                continue

            all_candidates[normalized_slug] = problem

    if len(all_candidates) < total_requested:
        if topic_set:
            raise ProblemSelectionError(
                f'Selected topics "{", ".join(sorted(topic_set))}" have only '
                f'{len(all_candidates)} available problems for source "{source.value}"'
            )
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
    return choose_random_problems_by_difficulty(0, count, 0, excluded_slugs=None)


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
    payload = get_user_profile(username)

    profile = payload.get('profile')
    if isinstance(profile, dict):
        avatar = profile.get('userAvatar')
        if isinstance(avatar, str) and avatar.strip():
            return avatar.strip()

    avatar = payload.get('userAvatar')
    if isinstance(avatar, str) and avatar.strip():
        return avatar.strip()

    return None


def get_user_profile(username: str) -> Dict[str, Any]:
    with _client() as client:
        response = client.get(f'/user/{username}')
        if response.status_code >= 400:
            raise LeetCodeServiceError(
                f'User profile request failed for {username}: {response.status_code}'
            )
        payload = response.json()

    if not isinstance(payload, dict):
        raise LeetCodeServiceError('Unexpected user profile payload shape from LeetCode API')

    return payload
