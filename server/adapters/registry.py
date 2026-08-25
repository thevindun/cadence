from .mock import MockAdapter
from .bluesky import BlueskyAdapter
from .mastodon import MastodonAdapter
from .threads import ThreadsAdapter
from db import get_connection, resolve_target
from oauth import is_oauth, has_real_oauth
from .linkedin import LinkedInAdapter
from logging_conf import log

PLATFORM_IDS = ["bluesky", "mastodon", "threads", "instagram", "x", "linkedin"]


def _build_bluesky(c):  return BlueskyAdapter(c["handle"], c["app_password"])
def _build_mastodon(c): return MastodonAdapter(c["instance_url"], c["access_token"])

# Token-connect adapters (built from stored creds).
_BUILDERS = {
    "bluesky": _build_bluesky,
    "mastodon": _build_mastodon,
}

# OAuth adapters (built from a connection id; fetch fresh tokens per publish).
_OAUTH_BUILDERS = {
    "threads": lambda conn_id: ThreadsAdapter(conn_id),
    "linkedin": lambda conn_id: LinkedInAdapter(conn_id),
}

_cache = {}   # connection id -> adapter


def _make_adapter(conn):
    platform = conn["platform"]
    if is_oauth(platform):
        builder = _OAUTH_BUILDERS.get(platform)
        if builder and has_real_oauth(platform):      # real app configured
            return builder(conn["id"])
        return MockAdapter(platform)                   # mock-connected until then
    builder = _BUILDERS.get(platform)
    if builder and conn["data"]:
        try:
            return builder(conn["data"])
        except Exception as e:
            log.warning(f"[registry] failed to build real {platform}: {e}")
    return MockAdapter(platform)


def get_adapter(target: str):
    conn = resolve_target(target)
    if conn is None:
        raise ValueError(f'No connection for "{target}"')
    cid = conn["id"]
    if cid not in _cache:
        _cache[cid] = _make_adapter(conn)
    return _cache[cid]


def make_real_adapter(platform, creds):
    builder = _BUILDERS.get(platform)
    if not builder:
        raise ValueError(f"{platform} has no token adapter")
    return builder(creds)


def invalidate(conn_id=None):
    if conn_id is None:
        _cache.clear()
    else:
        _cache.pop(conn_id, None)


def is_supported(platform):
    return platform in _BUILDERS