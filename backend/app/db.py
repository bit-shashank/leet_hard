from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings

settings = get_settings()

def _normalize_database_url(database_url: str) -> str:
    url = database_url.strip()

    if url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql://', 1)

    if url.startswith('postgresql://'):
        url = url.replace('postgresql://', 'postgresql+psycopg://', 1)

    parsed = urlparse(url)
    hostname = parsed.hostname or ''

    # Supabase requires SSL, ensure it is present for production-safe defaults.
    if parsed.scheme.startswith('postgresql') and hostname.endswith('supabase.co'):
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        query.setdefault('sslmode', 'require')
        parsed = parsed._replace(query=urlencode(query))
        url = urlunparse(parsed)

    return url


normalized_database_url = _normalize_database_url(settings.database_url)
parsed_database_url = urlparse(normalized_database_url)
database_hostname = parsed_database_url.hostname or ''

connect_args = {}
engine_kwargs = {'future': True}

if normalized_database_url.startswith('sqlite'):
    connect_args = {'check_same_thread': False}
else:
    engine_kwargs.update(
        {
            'pool_pre_ping': True,
            'pool_recycle': settings.db_pool_recycle_seconds,
        }
    )
    # Supabase pooler already provides pooling. Using SQLAlchemy NullPool here avoids
    # holding extra idle client slots and helps prevent "max clients reached" failures.
    if (
        settings.db_use_null_pool_for_supabase_pooler
        and database_hostname.endswith('pooler.supabase.com')
    ):
        engine_kwargs['poolclass'] = NullPool
    else:
        engine_kwargs.update(
            {
                'pool_size': max(1, settings.db_pool_size),
                'max_overflow': max(0, settings.db_max_overflow),
                'pool_timeout': max(1, settings.db_pool_timeout_seconds),
            }
        )

engine = create_engine(normalized_database_url, connect_args=connect_args, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
