from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import auth
from app.config import get_settings
from app.db import get_db
from app.models import User, UserRole

_JWKS_CACHE: dict[str, Any] = {
    'keys': None,
    'expires_at': None,
}
ROLE_SCOPE_MAP: dict[UserRole, frozenset[str]] = {
    UserRole.USER: frozenset(),
    UserRole.ADMIN: frozenset({'admin:portal'}),
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _resolve_jwks_url() -> str:
    settings = get_settings()
    if settings.supabase_jwks_url.strip():
        return settings.supabase_jwks_url.strip()
    if settings.supabase_url.strip():
        return settings.supabase_url.strip().rstrip('/') + '/auth/v1/.well-known/jwks.json'
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail='Supabase auth is not configured on backend',
    )


def _resolve_issuer() -> str:
    settings = get_settings()
    if settings.supabase_jwt_issuer.strip():
        return settings.supabase_jwt_issuer.strip()
    if settings.supabase_url.strip():
        return settings.supabase_url.strip().rstrip('/') + '/auth/v1'
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail='Supabase auth issuer is not configured on backend',
    )


def _get_jwks() -> dict[str, Any]:
    now = _utcnow()
    cached_keys = _JWKS_CACHE.get('keys')
    expires_at = _JWKS_CACHE.get('expires_at')
    if cached_keys and expires_at and expires_at > now:
        return cached_keys

    jwks_url = _resolve_jwks_url()
    try:
        response = httpx.get(jwks_url, timeout=10.0)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'Failed to fetch auth keys: {exc}',
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='Failed to fetch auth keys',
        )

    payload = response.json()
    if not isinstance(payload, dict) or not isinstance(payload.get('keys'), list):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='Invalid auth key response',
        )

    _JWKS_CACHE['keys'] = payload
    _JWKS_CACHE['expires_at'] = now + timedelta(minutes=10)
    return payload


def _decode_token(token: str) -> dict[str, Any]:
    settings = get_settings()

    try:
        header = jwt.get_unverified_header(token)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid auth token')

    kid = header.get('kid')
    keys_payload = _get_jwks()
    keys = keys_payload.get('keys', [])
    matching_key = None
    for key in keys:
        if key.get('kid') == kid:
            matching_key = key
            break
    if matching_key is None and keys:
        matching_key = keys[0]

    if matching_key is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid auth token key')

    try:
        return jwt.decode(
            token,
            matching_key,
            algorithms=['ES256', 'RS256'],
            audience=settings.supabase_jwt_audience,
            issuer=_resolve_issuer(),
        )
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid or expired auth token')


def _is_bootstrap_admin(user_id: str, email: Optional[str]) -> bool:
    settings = get_settings()
    if user_id in settings.admin_bootstrap_user_ids_set:
        return True
    if email and email.strip().lower() in settings.admin_bootstrap_emails_set:
        return True
    return False


def get_current_user(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
) -> User:
    token = auth.parse_bearer_token(authorization)
    claims = _decode_token(token)

    user_id = claims.get('sub')
    if not isinstance(user_id, str) or not user_id.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid auth token subject')

    email = claims.get('email')
    user_metadata = claims.get('user_metadata') if isinstance(claims.get('user_metadata'), dict) else {}
    display_name = user_metadata.get('full_name') or user_metadata.get('name') or claims.get('name')
    avatar_url = user_metadata.get('avatar_url') or claims.get('picture')

    user = db.scalar(select(User).where(User.id == user_id))
    normalized_email = (str(email).strip() if email else None)
    should_bootstrap_admin = _is_bootstrap_admin(user_id, normalized_email)

    if user is None:
        user = User(
            id=user_id,
            email=normalized_email,
            display_name=(str(display_name).strip() if display_name else None),
            avatar_url=(str(avatar_url).strip() if avatar_url else None),
            role=UserRole.ADMIN if should_bootstrap_admin else UserRole.USER,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    dirty = False
    if normalized_email and user.email != normalized_email:
        user.email = normalized_email
        dirty = True
    if display_name and not user.display_name:
        user.display_name = str(display_name).strip()
        dirty = True
    if avatar_url and not user.avatar_url:
        user.avatar_url = str(avatar_url).strip()
        dirty = True
    if dirty:
        db.commit()
        db.refresh(user)

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    scopes = ROLE_SCOPE_MAP.get(current_user.role, frozenset())
    if 'admin:portal' not in scopes:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Admin access required')
    return current_user
