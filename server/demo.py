import os

from fastapi import HTTPException
from demo import is_demo, block, MAX_MEDIA_BYTES, MAX_POSTS, MAX_DEMO_USERS

DEMO = os.environ.get("CADENCE_DEMO") == "1"

MAX_MEDIA_BYTES = 5 * 1024 * 1024        # 5 MB per upload on the demo
MAX_POSTS = 50                            # soft cap so the DB can't be filled

MAX_DEMO_USERS = 200

def is_demo() -> bool:
    return DEMO


def block(what: str = "This action"):
    """Refuse a mutating action that would touch a real platform or real credentials."""
    if DEMO:
        raise HTTPException(
            403,
            f"{what} is disabled on the public demo. "
            "Self-host Cadence to connect real accounts — see the README.",
        )