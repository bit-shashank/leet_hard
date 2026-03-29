import json
import os
from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


def _resolve_env_file() -> Path:
    app_env = os.environ.get('APP_ENV', '').strip().lower()
    if app_env in {'prod', 'production'}:
        return BASE_DIR / '.env'

    local_path = BASE_DIR / '.env.local'
    if local_path.exists():
        return local_path
    return BASE_DIR / '.env'


ENV_FILE = _resolve_env_file()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding='utf-8', extra='ignore')

    app_name: str = 'LeetRace API'
    app_env: str = 'dev'

    database_url: str = 'sqlite:///./leetcode_room_race.db'
    leetcode_api_base_url: str = 'https://leetcode-api-pied.vercel.app'
    app_token_secret: str = 'change-me-in-production'

    cors_origins: str = 'http://localhost:3000'
    frontend_base_url: str = 'http://localhost:3000'
    supabase_url: str = ''
    supabase_jwks_url: str = ''
    supabase_jwt_audience: str = 'authenticated'
    supabase_jwt_issuer: str = ''
    leetcode_verification_mode: str = 'soft'

    sync_interval_seconds: int = 15
    auto_solve_sync_enabled: bool = False
    avatar_sync_ttl_seconds: int = 21600
    max_participants_per_room: int = 50

    @staticmethod
    def _normalize_origin(origin: str) -> str:
        cleaned = origin.strip().strip('"').strip("'")
        if cleaned.endswith('/'):
            cleaned = cleaned[:-1]
        return cleaned

    @property
    def cors_origins_list(self) -> List[str]:
        raw = self.cors_origins.strip()
        origins: List[str] = []

        # Support JSON array style env values too:
        # CORS_ORIGINS=["https://a.vercel.app","http://localhost:3000"]
        if raw.startswith('['):
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, list):
                origins = [
                    self._normalize_origin(str(origin))
                    for origin in parsed
                    if str(origin).strip()
                ]

        if not origins:
            origins = [
                self._normalize_origin(origin)
                for origin in raw.split(',')
                if origin.strip()
            ]

        frontend_origin = self._normalize_origin(self.frontend_base_url) if self.frontend_base_url else ''
        if frontend_origin and frontend_origin not in origins and origins != ['*']:
            origins.append(frontend_origin)

        return origins or ['*']


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
