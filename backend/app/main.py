from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from app.config import get_settings
from app.db import engine, normalized_database_url
from app.models import Base
from app.routers.me import router as me_router
from app.routers.rooms import router as rooms_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Keep SQLite local/dev ergonomics while production Postgres uses Alembic migrations.
    if normalized_database_url.startswith('sqlite'):
        Base.metadata.create_all(bind=engine)
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
