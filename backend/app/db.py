from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

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

connect_args = {}
engine_kwargs = {'future': True}

if normalized_database_url.startswith('sqlite'):
    connect_args = {'check_same_thread': False}
else:
    engine_kwargs.update(
        {
            'pool_pre_ping': True,
            'pool_recycle': 300,
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
