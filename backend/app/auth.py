import hashlib
import secrets
import string
from typing import Optional

from fastapi import HTTPException, status

from app.config import get_settings


def normalize_nickname(value: str) -> str:
    return value.strip()


def normalize_leetcode_username(value: str) -> str:
    return value.strip()


def hash_passcode(passcode: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        'sha256',
        passcode.encode('utf-8'),
        salt.encode('utf-8'),
        200_000,
    ).hex()
    return f'{salt}${digest}'


def verify_passcode(passcode: str, hashed: Optional[str]) -> bool:
    if hashed is None:
        return True
    if not passcode:
        return False
    try:
        salt, expected = hashed.split('$', 1)
    except ValueError:
        return False

    actual = hashlib.pbkdf2_hmac(
        'sha256',
        passcode.encode('utf-8'),
        salt.encode('utf-8'),
        200_000,
    ).hex()
    return secrets.compare_digest(actual, expected)


def generate_participant_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    pepper = get_settings().app_token_secret
    return hashlib.sha256(f'{pepper}:{token}'.encode('utf-8')).hexdigest()


def generate_room_code(length: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def parse_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Missing authorization token')

    parts = authorization.split(' ', 1)
    if len(parts) != 2 or parts[0].lower() != 'bearer' or not parts[1].strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid authorization token')

    return parts[1].strip()
