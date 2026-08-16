import asyncio
import time
import calendar
import uuid
import os
import re

from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

from fastapi import FastAPI, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, JSONResponse
from oauth import is_oauth, new_state, consume_state, build_authorize_url, exchange_code
from fastapi.middleware.cors import CORSMiddleware

from models import Post, PostPatch
from config import bluesky_credentials
from adapters.registry import (
    get_adapter, invalidate, is_supported, make_real_adapter, PLATFORM_IDS,
)
from db import (
    init_db, list_posts, upsert_post, patch_post, get_post, delete_post,
    list_connections, get_connection, set_connection, delete_connection, resolve_target,
    MEDIA_DIR, add_media, get_media, list_categories, add_category, delete_category, list_media, delete_media, add_snapshot, snapshots_since,
    add_follower_snapshot, follower_snapshots_since, create_link, get_link, add_click, click_counts, create_user, get_user_by_email, get_user, count_users,
    create_session, get_session, delete_session,list_users, delete_user, update_user_role, count_admins,
    add_notification, list_notifications, unread_count, mark_all_read, upsert_post, prune_sessions, read_media
)
from notify import send_email
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from authn import auth_enabled, hash_password, verify_password, new_token


POLL_SECONDS = 3
METRICS_REFRESH_SECONDS = 300
CATEGORY_COLORS = ["#5B8CFF", "#34D399", "#FBBF24", "#A78BFA", "#F472B6", "#22D3EE", "#FB7185", "#94A3B8"]


PUBLIC_BASE = os.environ.get("PUBLIC_BASE_URL", "http://localhost:8000")
_URL_RE = re.compile(r'https?://\S+')


def _append_utm(url, source, campaign):
    from urllib.parse import urlparse, parse_qsl, urlencode
    p = urlparse(url)
    q = dict(parse_qsl(p.query))
    q.setdefault("utm_source", source)
    q.setdefault("utm_medium", "social")
    q.setdefault("utm_campaign", campaign or "cadence")
    return p._replace(query=urlencode(q)).geturl()


def _process_links(text, platform, post, mode, campaign):
    def repl(match):
        url, trail = match.group(0), ""
        while url and url[-1] in ".,!?)":
            trail = url[-1] + trail; url = url[:-1]
        dest = _append_utm(url, platform, campaign)
        if mode == "utm":
            return dest + trail
        code = create_link(dest, post["id"], platform)       # 'tracked'
        return f"{PUBLIC_BASE}/l/{code}" + trail
    return _URL_RE.sub(repl, text)


def _apply_links(post, platform):
    mode = post.get("link_mode", "off")
    if mode == "off":
        return post
    campaign = post.get("utm_campaign") or "cadence"
    proc = lambda t: _process_links(t, platform, post, mode, campaign)
    return {
        **post,
        "text": proc(post.get("text", "")),
        "thread": [proc(s) for s in (post.get("thread") or [])],
        "first_comment": proc(post.get("first_comment") or ""),
    }

def _popup_close_html(error: str | None) -> str:
    payload = "cadence-oauth-error" if error else "cadence-oauth-done"
    msg = error or "Connected. You can close this window."
    return f"""<!doctype html><meta charset="utf-8">
<body style="font-family:system-ui;background:#0A1220;color:#F5F7FA;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><p>{msg}</p></div>
<script>try{{window.opener&&window.opener.postMessage("{payload}","*")}}catch(e){{}}
setTimeout(function(){{window.close()}},800)</script>"""

def _parse_iso(s: str) -> datetime:
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt

def _add_months(dt: datetime, months: int) -> datetime:
    m = dt.month - 1 + months
    year = dt.year + m // 12
    month = m % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])   # clamp e.g. Jan 31 -> Feb 28
    return dt.replace(year=year, month=month, day=day)


def _next_occurrence(iso: str, repeat: str, now: datetime) -> datetime | None:
    dt = _parse_iso(iso)
    if repeat == "daily":
        step = lambda d: d + timedelta(days=1)
    elif repeat == "weekly":
        step = lambda d: d + timedelta(days=7)
    elif repeat == "monthly":
        step = lambda d: _add_months(d, 1)
    else:
        return None
    nxt = step(dt)
    while nxt <= now:            # collapse missed windows: exactly one make-up, next in future
        nxt = step(nxt)
    return nxt

def _queue_next_occurrence(post: dict):
    """A repeating post spawns its successor; the published one stays as history."""
    repeat = post.get("repeat", "none")
    if repeat == "none":
        return
    nxt = _next_occurrence(post["scheduledAt"], repeat, datetime.now(timezone.utc))
    if nxt is None:
        return
    data = {k: v for k, v in post.items() if k not in ("results", "metrics")}
    data["id"] = f"post_{uuid.uuid4().hex[:12]}"
    data["scheduledAt"] = nxt.isoformat().replace("+00:00", "Z")
    data["status"] = "scheduled"
    data["createdAt"] = int(time.time() * 1000)
    upsert_post(Post(**data))
    print(f"[repeat] queued next {repeat} occurrence at {data['scheduledAt']}")

async def _publish(post: dict):
    from oauth import refresh_if_needed
    prior = post.get("results") or {}
    patch_post(post["id"], {"status": "publishing"})

    results = {t: r for t, r in prior.items() if r.get("ok") and t != "_review"}   # keep wins
    for target in post["platforms"]:
        if results.get(target, {}).get("ok"):
            continue                                   # already posted — don't repeat it
        conn = resolve_target(target)
        if conn is None:
            results[target] = {"ok": False, "error": "account not connected"}
            continue
        if is_oauth(conn["platform"]):
            await refresh_if_needed(conn["id"])
        variant = (post.get("variants") or {}).get(conn["platform"])
        staged = {**post, "text": variant} if variant else post
        effective = _apply_links(staged, conn["platform"])
        missing = [m for m in (post.get("media") or []) if read_media(m) is None]
        if missing:
            results[target] = {"ok": False, "error": f"media file missing on disk: {', '.join(missing)}"}
            continue
        try:
            results[target] = await get_adapter(target).publish(effective)
        except Exception as e:
            detail = str(e) or getattr(e, "content", None) or getattr(e, "response", None)
            msg = f"{type(e).__name__}: {detail}" if detail else type(e).__name__
            results[target] = {"ok": False, "error": str(msg)[:300]}
            import traceback; traceback.print_exc()
    all_ok = all(results.get(t, {}).get("ok") for t in post["platforms"])
    patch_post(post["id"], {"status": "published" if all_ok else "failed", "results": results})

    snippet = (post["text"][:60] + "…") if len(post["text"]) > 60 else post["text"]
    if all_ok:
        add_notification("published", "Post published", snippet, post["id"])
    else:
        errs = "; ".join(f"{t}: {r.get('error')}" for t, r in results.items() if t != "_review" and not r.get("ok"))
        add_notification("failed", "Post failed", f"{snippet} — {errs}", post["id"])
        send_email("A scheduled post failed", f"{post['text']}\n\n{errs}")
        _queue_next_occurrence(post)

async def _publish_due():
    now = datetime.now(timezone.utc)
    for post in list_posts():
        if post["status"] == "scheduled" and _parse_iso(post["scheduledAt"]) <= now:
            await _publish(post)

async def _refresh_all_metrics(since_days: int = 14):
    cutoff = datetime.now(timezone.utc) - timedelta(days=since_days)
    for post in list_posts():
        if post["status"] != "published":
            continue
        if _parse_iso(post["scheduledAt"]) < cutoff:
            continue          # engagement on old posts has settled; skip to bound API calls
        metrics = {}
        for platform_id, result in post["results"].items():
            if result.get("ok") and result.get("ref"):
                try:
                    m = await get_adapter(platform_id).fetch_metrics(result["ref"])
                    metrics[platform_id] = m
                    add_snapshot(post["id"], platform_id, m, int(datetime.now(timezone.utc).timestamp() * 1000))
                except Exception as e:
                    print(f"[metrics] {post['id']} {platform_id}: {e}")
        if metrics:
            patch_post(post["id"], {"metrics": metrics})

async def _sample_followers():
    now = int(datetime.now(timezone.utc).timestamp() * 1000)
    for conn in list_connections():
        try:
            n = await get_adapter(conn["id"]).fetch_followers()
            if n is not None:
                add_follower_snapshot(conn["id"], n, now)
        except Exception as e:
            print(f"[followers] {conn['id']}: {e}")

async def _worker():
    last_metrics = 0.0
    while True:
        try:
            await _publish_due()
        except Exception as e:
            print(f"[worker] error: {e}")

        now = time.monotonic()
        if now - last_metrics >= METRICS_REFRESH_SECONDS:
            last_metrics = now                      # 0.0 start => also runs once right after boot
            try:
                await _refresh_all_metrics()
                await _sample_followers()
            except Exception as e:
                print(f"[worker] metrics error: {e}")

        await asyncio.sleep(POLL_SECONDS)
        

def _seed_from_env():
    # One-time: import .env Bluesky creds into the DB if nothing's stored yet.
    if not list_connections("bluesky"):
        creds = bluesky_credentials()
        if creds:
            set_connection("bluesky", creds[0], {"handle": creds[0], "app_password": creds[1]})
            print(f"[seed] imported Bluesky creds from .env for {creds[0]}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _seed_from_env()
    n = prune_sessions()
    if n:
        print(f"[auth] pruned {n} expired sessions")    
    from crypto import is_enabled
    if is_enabled():
        from db import list_connections, set_connection
        for conn in list_connections():                 # decrypts (or reads plaintext)…
            set_connection(conn["platform"], conn["handle"], conn["data"])   # …re-writes encrypted
        print("[crypto] credentials encrypted at rest")
    task = asyncio.create_task(_worker())
    yield
    task.cancel()


app = FastAPI(title="Cadence API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
        allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173,tauri://localhost,http://tauri.localhost").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSION_TTL_MS = 30 * 86400 * 1000
_API_PREFIXES = ("/posts", "/media", "/accounts", "/categories", "/metrics", "/links", "/auth", "/users", "/notifications", "/inbox")
_OPEN = {"/auth/status", "/auth/login", "/auth/register"}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _needs_auth(method: str, path: str) -> bool:
    if method == "OPTIONS":
        return False                              # CORS preflight carries no auth header
    if not auth_enabled():
        return False
    if not path.startswith(_API_PREFIXES):        # SPA, /health, /l/… → open
        return False
    if path in _OPEN:
        return False
    if method == "GET" and path.startswith("/media/") and path != "/media":
        return False                              # serving files (img tags can't send headers)
    if "/oauth/" in path:
        return False                              # browser OAuth redirects
    return True


def _user_from(request):
    h = request.headers.get("Authorization", "")
    if not h.startswith("Bearer "):
        return None
    sess = get_session(h[7:])
    if not sess or sess["expires_at"] < _now_ms():
        return None
    return get_user(sess["user_id"])

def _require_admin(request):
    if not auth_enabled():
        return                                    # single-user local: full access
    user = getattr(request.state, "user", None)
    if not user or user["role"] != "admin":
        raise HTTPException(403, "Admin access required")

def _is_member(request) -> bool:
    if not auth_enabled():
        return False
    user = getattr(request.state, "user", None)
    return bool(user and user["role"] == "member")

@app.middleware("http")
async def auth_gate(request, call_next):
    if _needs_auth(request.method, request.url.path):
        user = _user_from(request)
        if not user:
            return JSONResponse({"detail": "authentication required"}, status_code=401)
        request.state.user = user
    return await call_next(request)





# ---- posts ----
@app.get("/posts")
def get_posts() -> list[dict]:
    return list_posts()


@app.post("/posts")
def create_post(post: Post, request: Request) -> dict:
    if _is_member(request) and post.status == "scheduled":
        post.status = "pending"
        snippet = (post.text[:60] + "…") if len(post.text) > 60 else post.text
        add_notification("pending", "Post awaiting review", snippet, post.id, audience="admin")
    return upsert_post(post)

@app.get("/metrics/followers")
def followers_history(days: int = 30) -> dict:
    since = int((datetime.now(timezone.utc).timestamp() - days * 86400) * 1000)
    snaps = follower_snapshots_since(since)
    conns = {c["id"]: c["handle"] for c in list_connections()}
    return {"handles": conns, "snapshots": snaps}

@app.patch("/posts/{post_id}")
def update_post(post_id: str, patch: PostPatch, request: Request) -> dict:
    changes = patch.model_dump(exclude_unset=True)
    if _is_member(request) and changes.get("status") == "scheduled":
        changes["status"] = "pending"
    existing = get_post(post_id)
    if existing is None:
        raise HTTPException(404, "Post not found")
    # Don't let content be edited once it's on its way out.
    if {"text", "platforms", "scheduledAt"} & changes.keys() \
            and existing["status"] in ("publishing", "published"):
        raise HTTPException(409, "Can't edit a post that's already publishing or published")
    updated = patch_post(post_id, changes)
    if updated is None:
        raise HTTPException(404, "Post not found")
    return updated


@app.delete("/posts/{post_id}")
def remove_post(post_id: str) -> dict:
    if get_post(post_id) is None:
        raise HTTPException(404, "Post not found")
    delete_post(post_id)
    return {"ok": True, "id": post_id}

# ---- metrics ----
@app.post("/metrics/refresh")
async def refresh_metrics() -> list[dict]:
    await _refresh_all_metrics()
    return list_posts()


# ---- media ----
@app.post("/media")
async def upload_media(file: UploadFile = File(...)) -> dict:
    media_id = f"media_{uuid.uuid4().hex}"
    data = await file.read()
    (MEDIA_DIR / media_id).write_bytes(data)
    add_media(media_id, file.content_type or "application/octet-stream",
              file.filename or media_id, len(data))
    return {"id": media_id, "url": f"/media/{media_id}", "content_type": file.content_type}


@app.get("/media/{media_id}")
def serve_media(media_id: str):
    meta = get_media(media_id)
    path = MEDIA_DIR / media_id
    if meta is None or not path.exists():
        raise HTTPException(404, "Media not found")
    return FileResponse(
        path,
        media_type=meta["content_type"],
        headers={"Content-Disposition": f'inline; filename="{meta["filename"]}"'}
    )



@app.get("/posts/pending")
def posts_pending(request: Request) -> list[dict]:
    _require_admin(request)
    return [p for p in list_posts() if p["status"] == "pending"]

@app.get("/posts/{post_id}")
def get_one_post(post_id: str) -> dict:
    post = get_post(post_id)
    if post is None:
        raise HTTPException(404, "Post not found")
    return post

@app.post("/posts/{post_id}/approve")
def post_approve(post_id: str, request: Request) -> dict:
    _require_admin(request)
    post = get_post(post_id)
    if not post:
        raise HTTPException(404, "Post not found")
    if post["status"] != "pending":
        raise HTTPException(409, "Post is not pending review")
    updated = patch_post(post_id, {"status": "scheduled"})
    if updated is None:
        raise HTTPException(404, "Post not found")
    return updated

@app.post("/posts/{post_id}/retry")
def post_retry(post_id: str) -> dict:
    post = get_post(post_id)
    if not post:
        raise HTTPException(404, "Post not found")
    if post["status"] != "failed":
        raise HTTPException(409, "Only failed posts can be retried")
    updated = patch_post(post_id, {"status": "scheduled"})   # worker re-runs, skipping prior wins
    if updated is None:
        raise HTTPException(404, "Post not found")
    return updated

@app.post("/posts/{post_id}/reject")
def post_reject(post_id: str, body: dict, request: Request) -> dict:
    _require_admin(request)
    post = get_post(post_id)
    if not post:
        raise HTTPException(404, "Post not found")
    reason = (body.get("reason") or "").strip()
    updated = patch_post(post_id, {"status": "rejected", "results": {"_review": {"ok": False, "error": reason or "Rejected"}}})
    if updated is None:
        raise HTTPException(404, "Post not found")
    return updated

# ---- accounts ----
REQUIRED_FIELDS = {
    "bluesky":  ["handle", "app_password"],
    "mastodon": ["instance_url", "access_token"],
}


@app.get("/accounts")
def get_accounts() -> list[dict]:
    out = []
    for pid in PLATFORM_IDS:
        conns = list_connections(pid)
        out.append({
            "id": pid,
            "oauth": is_oauth(pid),
            "supported": is_supported(pid) or is_oauth(pid),
            "connections": [{"id": c["id"], "handle": c["handle"]} for c in conns],
        })
    return out


@app.post("/accounts/{platform}")
async def connect_account(platform: str, creds: dict, request: Request) -> dict:
    _require_admin(request)
    if platform not in PLATFORM_IDS:
        raise HTTPException(404, "Unknown platform")
    if not is_supported(platform):
        raise HTTPException(400, f"{platform} isn't supported for token connect")
    data = {}
    for field in REQUIRED_FIELDS.get(platform, []):
        val = (creds.get(field) or "").strip()
        if not val:
            raise HTTPException(422, f"{field} is required")
        data[field] = val
    try:
        resolved = await make_real_adapter(platform, data).verify()
    except Exception as e:
        detail = str(e) or getattr(getattr(e, "response", None), "text", "") or repr(e)
        raise HTTPException(400, f"Could not connect: {detail}")
    handle = resolved or data.get("handle") or platform
    data["handle"] = handle
    cid = set_connection(platform, handle, data)
    invalidate(cid)
    return {"id": cid, "handle": handle}


@app.delete("/accounts/{platform}/{handle}")
def disconnect_account(platform: str, handle: str, request: Request) -> dict:
    _require_admin(request)
    from db import make_conn_id
    cid = make_conn_id(platform, handle)
    delete_connection(cid)
    invalidate(cid)
    return {"ok": True, "id": cid}


@app.get("/accounts/{platform}/oauth/start")
def oauth_start(platform: str):
    if not is_oauth(platform):
        raise HTTPException(400, f"{platform} does not use OAuth")
    return RedirectResponse(build_authorize_url(platform, new_state(platform)))


@app.get("/accounts/{platform}/oauth/callback", response_class=HTMLResponse)
async def oauth_callback(platform: str, code: str = "", state: str = "", error: str = ""):
    if error:
        return _popup_close_html(f"Cancelled: {error}")
    if consume_state(state) != platform:
        return _popup_close_html("Invalid or expired state")
    try:
        cid = await exchange_code(platform, code)
    except Exception as e:
        return _popup_close_html(f"Token exchange failed: {e}")
    invalidate(cid)
    return _popup_close_html(None)


# ---- mock OAuth provider (stands in for a real platform until you register an app) ----
@app.get("/mock-oauth/authorize", response_class=HTMLResponse)
def mock_authorize(redirect_uri: str = "", state: str = "", scope: str = ""):
    from urllib.parse import urlencode
    approve = f"{redirect_uri}?{urlencode({'code': 'mock-auth-code', 'state': state})}"
    deny = f"{redirect_uri}?{urlencode({'error': 'access_denied', 'state': state})}"
    return f"""<!doctype html><meta charset="utf-8">
<body style="font-family:system-ui;background:#0A1220;color:#F5F7FA;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:360px">
  <h2 style="font-weight:600;margin:0 0 8px">Mock provider</h2>
  <p style="color:#9BA7B6">Authorize <b>Cadence</b> to post on your behalf?<br>
  <span style="font-family:monospace;font-size:12px">scope: {scope}</span></p>
  <div style="display:flex;gap:8px;justify-content:center;margin-top:18px">
    <a href="{approve}" style="background:#FF5C38;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">Authorize</a>
    <a href="{deny}" style="border:1px solid #22334A;color:#9BA7B6;padding:10px 18px;border-radius:10px;text-decoration:none">Cancel</a>
  </div>
</div>"""


@app.post("/mock-oauth/token")
def mock_token() -> dict:
    return {
        "access_token": f"mock-access-{uuid.uuid4().hex}",
        "refresh_token": f"mock-refresh-{uuid.uuid4().hex}",
        "expires_in": 3600, "token_type": "bearer",
        "scope": "mock", "username": "@you (mock)",
    }

@app.get("/media/{media_id}/meta")
def media_meta(media_id: str) -> dict:
    meta = get_media(media_id)
    if meta is None:
        raise HTTPException(404, "Media not found")
    return {"id": media_id, "content_type": meta["content_type"], "alt": meta.get("alt", "")}


@app.patch("/media/{media_id}")
def media_set_alt(media_id: str, body: dict) -> dict:
    from db import get_media, set_media_alt
    if get_media(media_id) is None:
        raise HTTPException(404, "Media not found")
    set_media_alt(media_id, (body.get("alt") or "").strip())
    return {"ok": True}

@app.get("/categories")
def get_categories() -> list[dict]:
    return list_categories()


@app.post("/categories")
def create_category(body: dict) -> dict:
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "name is required")
    color = body.get("color") or CATEGORY_COLORS[0]
    cat_id = f"cat_{uuid.uuid4().hex[:8]}"
    add_category(cat_id, name, color)
    return {"id": cat_id, "name": name, "color": color}


@app.delete("/categories/{cat_id}")
def remove_category(cat_id: str) -> dict:
    delete_category(cat_id)
    return {"ok": True, "id": cat_id}

@app.get("/media")
def media_list() -> list[dict]:
    return list_media()


@app.delete("/media/{media_id}")
def media_delete(media_id: str) -> dict:
    delete_media(media_id)
    return {"ok": True, "id": media_id}

@app.get("/metrics/history")
def metrics_history(days: int = 30) -> list[dict]:
    since = int((datetime.now(timezone.utc).timestamp() - days * 86400) * 1000)
    return snapshots_since(since)

@app.get("/l/{code}")
def redirect_link(code: str):
    link = get_link(code)
    if not link:
        raise HTTPException(404, "Link not found")
    add_click(code)
    return RedirectResponse(link["url"], status_code=302)


@app.get("/links/stats")
def link_stats() -> list[dict]:
    return click_counts()

@app.get("/health")
def health() -> dict:
    return {"status": "ok"}

@app.get("/auth/status")
def auth_status() -> dict:
    return {"enabled": auth_enabled(), "has_users": count_users() > 0}


@app.post("/auth/register")
def auth_register(body: dict) -> dict:
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if "@" not in email or len(password) < 8:
        raise HTTPException(422, "Valid email and 8+ char password required")
    if count_users() > 0:                          # bootstrap only; admin-added users come later
        raise HTTPException(403, "Registration is closed — ask an admin to add you")
    salt, pw = hash_password(password)
    uid = create_user(email, salt, pw, "admin")
    return {"id": uid, "email": email, "role": "admin"}


@app.post("/auth/login")
def auth_login(body: dict) -> dict:
    user = get_user_by_email((body.get("email") or "").strip())
    if not user or not verify_password(body.get("password") or "", user["salt"], user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    token = new_token()
    create_session(token, user["id"], _now_ms() + SESSION_TTL_MS)
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "role": user["role"]}}


@app.post("/auth/logout")
def auth_logout(request: Request) -> dict:
    h = request.headers.get("Authorization", "")
    if h.startswith("Bearer "):
        delete_session(h[7:])
    return {"ok": True}


@app.get("/auth/me")
def auth_me(request: Request) -> dict:
    u = request.state.user
    return {"id": u["id"], "email": u["email"], "role": u["role"]}

@app.get("/users")
def users_list(request: Request) -> list[dict]:
    _require_admin(request)
    return list_users()


@app.post("/users")
def users_create(body: dict, request: Request) -> dict:
    _require_admin(request)
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    role = "admin" if body.get("role") == "admin" else "member"
    if "@" not in email or len(password) < 8:
        raise HTTPException(422, "Valid email and 8+ char password required")
    if get_user_by_email(email):
        raise HTTPException(409, "A user with that email already exists")
    salt, pw = hash_password(password)
    uid = create_user(email, salt, pw, role)
    return {"id": uid, "email": email, "role": role}


@app.patch("/users/{uid}")
def users_update(uid: str, body: dict, request: Request) -> dict:
    _require_admin(request)
    user = get_user(uid)
    if not user:
        raise HTTPException(404, "User not found")
    role = body.get("role")
    if role not in ("admin", "member"):
        raise HTTPException(422, "role must be admin or member")
    if user["role"] == "admin" and role == "member" and count_admins() <= 1:
        raise HTTPException(400, "Can't demote the last admin")
    update_user_role(uid, role)
    return {"id": uid, "role": role}


@app.delete("/users/{uid}")
def users_delete(uid: str, request: Request) -> dict:
    _require_admin(request)
    user = get_user(uid)
    if not user:
        raise HTTPException(404, "User not found")
    if user["role"] == "admin" and count_admins() <= 1:
        raise HTTPException(400, "Can't remove the last admin")
    delete_user(uid)
    return {"ok": True, "id": uid}

def _is_admin_req(request) -> bool:
    if not auth_enabled():
        return True
    u = getattr(request.state, "user", None)
    return bool(u and u["role"] == "admin")


@app.get("/notifications")
def notifications_list(request: Request) -> dict:
    admin = _is_admin_req(request)
    return {"items": list_notifications(admin), "unread": unread_count(admin)}


@app.post("/notifications/read")
def notifications_read(request: Request) -> dict:
    mark_all_read(_is_admin_req(request))
    return {"ok": True}

@app.get("/inbox")
async def inbox() -> list[dict]:
    out = []
    for conn in list_connections():
        try:
            items = await get_adapter(conn["id"]).fetch_inbox()
            for it in items:
                it["conn_id"] = conn["id"]; it["platform"] = conn["platform"]; it["account"] = conn["handle"]
            out.extend(items)
        except Exception as e:
            print(f"[inbox] {conn['id']}: {e}")
    out.sort(key=lambda x: x.get("created_at", 0), reverse=True)
    return out


@app.post("/inbox/reply")
async def inbox_reply(body: dict) -> dict:
    conn_id = body.get("conn_id"); text = (body.get("text") or "").strip()
    if not conn_id or not text:
        raise HTTPException(422, "conn_id and text required")
    res = await get_adapter(conn_id).reply(body.get("reply_ctx") or {}, text)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error") or "reply failed")
    return {"ok": True}

# Serve the built SPA (production single-origin). MUST be after all API routes.
_DIST = Path(os.environ.get("FRONTEND_DIST", str(Path(__file__).parent.parent / "dist")))
if _DIST.exists():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="spa")

