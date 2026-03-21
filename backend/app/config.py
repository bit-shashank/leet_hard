from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / '.env'


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding='utf-8', extra='ignore')

    app_name: str = 'LeetCode Room Race API'
    app_env: str = 'dev'

    database_url: str = 'sqlite:///./leetcode_room_race.db'
    leetcode_api_base_url: str = 'https://leetcode-api-pied.vercel.app'
    app_token_secret: str = 'change-me-in-production'

    cors_origins: str = 'http://localhost:3000'
    frontend_base_url: str = 'http://localhost:3000'

    sync_interval_seconds: int = 15
    avatar_sync_ttl_seconds: int = 21600
    max_participants_per_room: int = 50

    @property
    def cors_origins_list(self) -> List[str]:
        origins = [origin.strip() for origin in self.cors_origins.split(',') if origin.strip()]
        return origins or ['*']


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
