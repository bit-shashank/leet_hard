import json
from pathlib import Path

from app.models import ProblemSource

_DATA_PATH = Path(__file__).resolve().parent.parent / 'data' / 'problem_sheets.json'

_EXPECTED_SHEETS = {
    ProblemSource.NEETCODE_150.value,
    ProblemSource.NEETCODE_250.value,
    ProblemSource.BLIND_75.value,
    ProblemSource.STRIVER_A2Z_SHEET.value,
    ProblemSource.STRIVER_SDE_SHEET.value,
}


def _normalize_slug(raw_slug: str) -> str:
    return raw_slug.strip().strip('/').lower()


def _load_sheet_catalog() -> dict[str, tuple[str, ...]]:
    with _DATA_PATH.open('r', encoding='utf-8') as f:
        payload = json.load(f)

    if not isinstance(payload, dict):
        raise RuntimeError('problem_sheets.json must be an object mapping sheet name to slug arrays')

    missing = _EXPECTED_SHEETS - set(payload.keys())
    if missing:
        raise RuntimeError(f'Missing sheet definitions: {", ".join(sorted(missing))}')

    catalog: dict[str, tuple[str, ...]] = {}
    for sheet_name in _EXPECTED_SHEETS:
        raw_slugs = payload.get(sheet_name, [])
        if not isinstance(raw_slugs, list) or not raw_slugs:
            raise RuntimeError(f'Sheet {sheet_name} must contain at least one slug')

        normalized = {_normalize_slug(slug) for slug in raw_slugs if isinstance(slug, str)}
        normalized.discard('')
        if not normalized:
            raise RuntimeError(f'Sheet {sheet_name} has no valid slugs')

        catalog[sheet_name] = tuple(sorted(normalized))

    return catalog


_SHEET_CATALOG = _load_sheet_catalog()


def get_sheet_slugs(source: ProblemSource) -> set[str]:
    if source == ProblemSource.RANDOM:
        raise ValueError('Random source has no fixed sheet slug list')

    slugs = _SHEET_CATALOG.get(source.value)
    if slugs is None:
        raise ValueError(f'Unsupported sheet source: {source.value}')
    return set(slugs)
