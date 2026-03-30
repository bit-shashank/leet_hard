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
    db_pool_size: int = 2
    db_max_overflow: int = 0
    db_pool_timeout_seconds: int = 30
    db_pool_recycle_seconds: int = 300
    db_use_null_pool_for_supabase_pooler: bool = True
    leetcode_api_base_url: str = 'https://leetcode-api-pied.vercel.app'
    app_token_secret: str = 'change-me-in-production'

    cors_origins: str = 'http://localhost:3000'
    cors_origin_regex: str = r'https://.*\.vercel\.app'
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
    admin_bootstrap_user_ids: str = ''
    admin_bootstrap_emails: str = ''

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

    @property
    def cors_origin_regex_pattern(self) -> str | None:
        pattern = self.cors_origin_regex.strip()
        return pattern or None

    @staticmethod
    def _parse_csv_or_json_list(raw: str) -> set[str]:
        cleaned = raw.strip()
        if not cleaned:
            return set()

        parsed_values: list[str] = []
        if cleaned.startswith('['):
            try:
                parsed = json.loads(cleaned)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, list):
                parsed_values = [str(item).strip() for item in parsed if str(item).strip()]

        if not parsed_values:
            parsed_values = [part.strip() for part in cleaned.split(',') if part.strip()]

        return set(parsed_values)

    @property
    def admin_bootstrap_user_ids_set(self) -> set[str]:
        return self._parse_csv_or_json_list(self.admin_bootstrap_user_ids)

    @property
    def admin_bootstrap_emails_set(self) -> set[str]:
        return {email.lower() for email in self._parse_csv_or_json_list(self.admin_bootstrap_emails)}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
