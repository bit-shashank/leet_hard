"""Compatibility package so `uvicorn app.main:app` works from repo root.

It extends the `app` package path to include `backend/app`.
"""

from pathlib import Path

_backend_app_dir = Path(__file__).resolve().parent.parent / 'backend' / 'app'
if _backend_app_dir.exists():
    __path__.append(str(_backend_app_dir))
