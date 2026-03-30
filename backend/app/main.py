from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select
from sqlalchemy.exc import OperationalError

from app.config import get_settings
from app.db import SessionLocal, engine, normalized_database_url
from app.models import Base, User, UserRole
from app.routers.admin import router as admin_router
from app.routers.me import router as me_router
from app.routers.rooms import router as rooms_router

logger = logging.getLogger(__name__)


def _bootstrap_admin_users() -> None:
    bootstrap_user_ids = settings.admin_bootstrap_user_ids_set
    bootstrap_emails = settings.admin_bootstrap_emails_set
    if not bootstrap_user_ids and not bootstrap_emails:
        return

    conditions = []
    if bootstrap_user_ids:
        conditions.append(User.id.in_(bootstrap_user_ids))
    if bootstrap_emails:
        conditions.append(func.lower(User.email).in_(bootstrap_emails))
    if not conditions:
        return

    try:
        with SessionLocal() as db:
            matching_users = db.scalars(select(User).where(or_(*conditions))).all()
            promoted_count = 0
            for user in matching_users:
                if user.role == UserRole.ADMIN:
                    continue
                user.role = UserRole.ADMIN
                promoted_count += 1
            if promoted_count:
                db.commit()
                logger.info('Promoted %s bootstrap admin user(s)', promoted_count)
    except Exception:
        logger.exception('Failed to apply bootstrap admin promotion')


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Keep SQLite local/dev ergonomics while production Postgres uses Alembic migrations.
    if normalized_database_url.startswith('sqlite'):
        Base.metadata.create_all(bind=engine)
    _bootstrap_admin_users()
    yield


settings = get_settings()
app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=settings.cors_origin_regex_pattern,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.get('/health')
def health_check():
    return {'ok': True}


@app.exception_handler(OperationalError)
async def handle_db_operational_error(_: Request, __: OperationalError):
    return JSONResponse(
        status_code=503,
        content={'detail': 'Database temporarily unavailable. Please retry in a moment.'},
    )


app.include_router(rooms_router, prefix='/api/v1')
app.include_router(me_router, prefix='/api/v1')
app.include_router(admin_router, prefix='/api/v1')
