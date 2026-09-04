import os
import time
import secrets
from urllib.parse import urlencode

import httpx

from db import list_connections, get_connection, set_connection


REDIRECT_BASE = os.environ.get("OAUTH_REDIRECT_BASE", "http://localhost:8000")
MOCK_BASE = f"{REDIRECT_BASE}/mock-oauth"

# Real endpoints per OAuth platform. VERIFY each when wiring its real adapter
# (Phase 8+). Until a platform has a CLIENT_ID in env, its flow runs on the mock.
_REAL = {
    "threads": {
        "authorize_url": "https://threads.net/oauth/authorize",
        "token_url": "https://graph.threads.net/oauth/access_token",
        "scopes": "threads_basic,threads_content_publish,threads_manage_insights",
    },
    "linkedin": {
        "authorize_url": "https://www.linkedin.com/oauth/v2/authorization",
        "token_url": "https://www.linkedin.com/oauth/v2/accessToken",
        "scopes": "openid profile w_member_social",
    },
     "instagram": {
        "authorize_url": "https://www.instagram.com/oauth/authorize",
        "token_url": "https://api.instagram.com/oauth/access_token",
        "scopes": "instagram_business_basic,instagram_business_content_publish,"
                  "instagram_business_manage_insights",
    },
    "facebook": {
        "authorize_url": f"https://www.facebook.com/{os.environ.get('FACEBOOK_API_VERSION', 'v25.0')}/dialog/oauth",
        "token_url": f"https://graph.facebook.com/{os.environ.get('FACEBOOK_API_VERSION', 'v25.0')}/oauth/access_token",
        "scopes": "pages_show_list,pages_manage_posts,pages_read_engagement,"
                  "pages_manage_engagement,pages_read_user_engagement,publish_video",
    },
    "youtube": {
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scopes": "https://www.googleapis.com/auth/youtube.upload "
                  "https://www.googleapis.com/auth/youtube.readonly",
    },
}

OAUTH_PLATFORMS = set(_REAL.keys())


def is_oauth(platform: str) -> bool:
    return platform in OAUTH_PLATFORMS


def _redirect_uri(platform: str) -> str:
    return f"{REDIRECT_BASE}/accounts/{platform}/oauth/callback"


def _config(platform: str) -> dict:
    prefix = platform.upper()
    client_id = os.environ.get(f"{prefix}_CLIENT_ID")
    client_secret = os.environ.get(f"{prefix}_CLIENT_SECRET")
    if client_id and client_secret:                       # real provider
        real = _REAL[platform]
        return {
            "client_id": client_id, "client_secret": client_secret,
            "authorize_url": real["authorize_url"], "token_url": real["token_url"],
            "scopes": real["scopes"], "redirect_uri": _redirect_uri(platform),
        }
    return {                                               # mock fallback
        "client_id": f"mock-{platform}-client", "client_secret": "mock-secret",
        "authorize_url": f"{MOCK_BASE}/authorize", "token_url": f"{MOCK_BASE}/token",
        "scopes": _REAL[platform]["scopes"], "redirect_uri": _redirect_uri(platform),
    }


# --- CSRF state store (in-memory, short-lived) ---
_states: dict[str, dict] = {}


def new_state(platform: str) -> str:
    state = secrets.token_urlsafe(24)
    _states[state] = {"platform": platform, "ts": time.time()}
    return state


def consume_state(state: str) -> str | None:
    entry = _states.pop(state, None)
    if not entry or time.time() - entry["ts"] > 600:      # 10-min expiry
        return None
    return entry["platform"]


def build_authorize_url(platform: str, state: str) -> str:
    cfg = _config(platform)
    params = {
        "client_id": cfg["client_id"], "redirect_uri": cfg["redirect_uri"],
        "scope": cfg["scopes"], "response_type": "code", "state": state,
    }
    config_id = os.environ.get("FACEBOOK_CONFIG_ID")
    if platform == "facebook" and config_id:
        # Facebook Login for Business bundles permissions into a saved
        # configuration; config_id replaces scope and the two can't coexist.
        params.pop("scope", None)
        params["config_id"] = config_id
        params["override_default_response_type"] = "true"
    if platform == "youtube":
        # Google only issues a refresh token on first consent with these set.
        params["access_type"] = "offline"
        params["prompt"] = "consent"
    return f"{cfg['authorize_url']}?{urlencode(params)}"

def _store_tokens(platform: str, tok: dict) -> str:
    expires_in = tok.get("expires_in")
    handle = tok.get("handle") or tok.get("username") or f"{platform} account"
    data = {
        "access_token": tok.get("access_token"),
        "refresh_token": tok.get("refresh_token"),
        "expires_at": int((time.time() + expires_in) * 1000) if expires_in else None,
        "scope": tok.get("scope"),
        "handle": handle,
    }
    return set_connection(platform, handle, data)         # returns connection id


IG_GRAPH = "https://graph.instagram.com"


async def _instagram_finish(client, cfg, tok: dict) -> dict:
    """IG returns a 1-hour token with no expires_in. Trade it for a 60-day one
    and resolve the username, so the connection doesn't die in an hour."""
    short = tok.get("access_token")
    if not short:
        raise Exception("Instagram returned no access token")

    r = await client.get(f"{IG_GRAPH}/access_token", params={
        "grant_type": "ig_exchange_token",
        "client_secret": cfg["client_secret"],
        "access_token": short,
    })
    r.raise_for_status()
    long_tok = r.json()

    handle = f"instagram account"
    try:
        me = await client.get(f"{IG_GRAPH}/me", params={
            "fields": "user_id,username",
            "access_token": long_tok["access_token"],
        })
        me.raise_for_status()
        handle = "@" + me.json().get("username", "instagram")
    except Exception:
        pass                                  # non-fatal; handle stays generic

    return {**long_tok, "handle": handle}

FB_VERSION = os.environ.get("FACEBOOK_API_VERSION", "v25.0")
FB_GRAPH = f"https://graph.facebook.com/{FB_VERSION}"


async def _facebook_finish(client, cfg, tok: dict) -> str:
    """FB gives a short user token. Trade it for a long-lived one, then fan out
    one connection per Page — Page tokens derived this way never expire."""
    short = tok.get("access_token")
    if not short:
        raise Exception("Facebook returned no access token")

    r = await client.get(f"{FB_GRAPH}/oauth/access_token", params={
        "grant_type": "fb_exchange_token",
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "fb_exchange_token": short,
    })
    r.raise_for_status()
    long_user = r.json()["access_token"]

    r = await client.get(f"{FB_GRAPH}/me/accounts", params={
        "fields": "id,name,access_token,tasks",
        "access_token": long_user,
    })
    r.raise_for_status()
    pages = r.json().get("data", [])
    if not pages:
        raise Exception("No Facebook Pages found — you must be an admin of at least one Page")
    first: str | None = None
    for p in pages:
        handle = (p.get("name") or p["id"]).replace(":", "-")   # ':' breaks conn ids
        cid = set_connection("facebook", handle, {
            "access_token": p["access_token"],
            "page_id": p["id"],
            "handle": handle,
            "refresh_token": None,
            "expires_at": None,                                  # page tokens don't expire
            "scope": cfg["scopes"],
        })
        first = first or cid

    if first is None:
        raise Exception("Facebook returned Pages but none could be stored")
    return first

async def exchange_code(platform: str, code: str) -> str:
    cfg = _config(platform)
    async with httpx.AsyncClient(timeout=30) as client:

        if platform == "facebook" and has_real_oauth("facebook"):
            r = await client.get(cfg["token_url"], params={
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "redirect_uri": cfg["redirect_uri"],
                "code": code,
            })
            r.raise_for_status()
            return await _facebook_finish(client, cfg, r.json())

        r = await client.post(cfg["token_url"], data={
            "grant_type": "authorization_code", "code": code,
            "client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
            "redirect_uri": cfg["redirect_uri"],
        })
        r.raise_for_status()
        tok = r.json()
        if platform == "instagram" and has_real_oauth("instagram"):
            tok = await _instagram_finish(client, cfg, tok)
        return _store_tokens(platform, tok)


async def refresh_if_needed(conn_id: str) -> dict | None:
    conn = get_connection(conn_id)
    if not conn:
        return None
    creds = conn["data"]
    exp = creds.get("expires_at")
    if not exp or exp - int(time.time() * 1000) > 60_000:
        return conn
    cfg = _config(conn["platform"])

    if conn["platform"] == "instagram":
        # IG refreshes using the access token itself — no refresh_token exists.
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{IG_GRAPH}/refresh_access_token", params={
                "grant_type": "ig_refresh_token",
                "access_token": creds.get("access_token"),
            })
            r.raise_for_status()
            set_connection("instagram", creds["handle"],
                           {**creds, **_token_fields(r.json())})
        return get_connection(conn_id)

    refresh = creds.get("refresh_token")
    if not refresh:
        return conn
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(cfg["token_url"], data={
            "grant_type": "refresh_token", "refresh_token": refresh,
            "client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
        })
        r.raise_for_status()
        set_connection(conn["platform"], creds["handle"], {**creds, **_token_fields(r.json())})
    return get_connection(conn_id)


def _token_fields(tok: dict) -> dict:
    expires_in = tok.get("expires_in")
    fields = {
        "access_token": tok.get("access_token"),
        "expires_at": int((time.time() + expires_in) * 1000) if expires_in else None,
    }
    # Providers omit refresh_token on refresh responses — never overwrite a good one.
    if tok.get("refresh_token"):
        fields["refresh_token"] = tok["refresh_token"]
    return fields


async def valid_access_token(conn_id: str) -> str | None:
    conn = await refresh_if_needed(conn_id)
    return conn["data"].get("access_token") if conn else None


def has_real_oauth(platform: str) -> bool:
    """True once real CLIENT_ID/SECRET are configured for this platform."""
    prefix = platform.upper()
    return bool(os.environ.get(f"{prefix}_CLIENT_ID") and os.environ.get(f"{prefix}_CLIENT_SECRET"))