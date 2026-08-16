import os
import hashlib
import secrets

ITERATIONS = 200_000


def auth_enabled() -> bool:
    return os.environ.get("CADENCE_AUTH", "on").lower() in ("1", "on", "true", "yes")


def hash_password(password: str, salt: str | None = None):
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), ITERATIONS)
    return salt, dk.hex()


def verify_password(password: str, salt: str, expected: str) -> bool:
    _, computed = hash_password(password, salt)
    return secrets.compare_digest(computed, expected)


def new_token() -> str:
    return secrets.token_urlsafe(32)