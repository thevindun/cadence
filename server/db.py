import json
import time
import sqlite3
import uuid
from pathlib import Path
from contextlib import contextmanager
import os

from models import Post
from crypto import encrypt, decrypt

DATA_DIR = Path(os.environ.get("DATA_DIR", str(Path(__file__).parent)))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "cadence.db"
MEDIA_DIR = DATA_DIR / "media"
MEDIA_DIR.mkdir(exist_ok=True)

_JSON_COLS = {"platforms", "results", "metrics", "media", "thread", "variants"}
_MUTABLE = {"text", "platforms", "scheduledAt", "status", "results", "metrics", "repeat", "media", "thread", "variants", "first_comment", "category", "link_mode", "utm_campaign"}

@contextmanager
def _conn():
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS posts (
                id          TEXT PRIMARY KEY,
                text        TEXT NOT NULL,
                platforms   TEXT NOT NULL,
                scheduledAt TEXT NOT NULL,
                status      TEXT NOT NULL,
                results     TEXT NOT NULL,
                metrics     TEXT NOT NULL DEFAULT '{}',
                repeat      TEXT NOT NULL DEFAULT 'none',
                media       TEXT NOT NULL DEFAULT '[]',
                thread      TEXT NOT NULL DEFAULT '[]',
                variants    TEXT NOT NULL DEFAULT '{}',
                first_comment TEXT NOT NULL DEFAULT '',
                category    TEXT,
                link_mode    TEXT NOT NULL DEFAULT 'off',
                utm_campaign TEXT NOT NULL DEFAULT '',
                createdAt   INTEGER NOT NULL
            )
        """)
        cols = {r["name"] for r in c.execute("PRAGMA table_info(posts)").fetchall()}
        if "metrics" not in cols:
            c.execute("ALTER TABLE posts ADD COLUMN metrics TEXT NOT NULL DEFAULT '{}'")
        if "repeat" not in cols:
            c.execute("ALTER TABLE posts ADD COLUMN repeat TEXT NOT NULL DEFAULT 'none'")
        if "media" not in cols:
            c.execute("ALTER TABLE posts ADD COLUMN media TEXT NOT NULL DEFAULT '[]'")
        if "thread" not in cols:
            c.execute("ALTER TABLE posts ADD COLUMN thread TEXT NOT NULL DEFAULT '[]'")
        if "variants" not in cols:
            c.execute("ALTER TABLE posts ADD COLUMN variants TEXT NOT NULL DEFAULT '{}'")
        if "first_comment" not in cols:
            c.execute("ALTER TABLE posts ADD COLUMN first_comment TEXT NOT NULL DEFAULT ''")
        if "category" not in cols:
            c.execute("ALTER TABLE posts ADD COLUMN category TEXT")
        if "link_mode" not in cols:
            c.execute("ALTER TABLE posts ADD COLUMN link_mode TEXT NOT NULL DEFAULT 'off'")
        if "utm_campaign" not in cols:
            c.execute("ALTER TABLE posts ADD COLUMN utm_campaign TEXT NOT NULL DEFAULT ''")
        c.execute("""
            CREATE TABLE IF NOT EXISTS connections (
                id           TEXT PRIMARY KEY,   -- e.g. "bluesky:you.bsky.social"
                platform     TEXT NOT NULL,
                handle       TEXT NOT NULL,
                data         TEXT NOT NULL,       -- JSON creds/tokens
                connected_at INTEGER NOT NULL
            )
        """)
        # Migrate any old single-account credentials into keyed connections.
        old = c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='credentials'"
        ).fetchone()
        if old:
            for r in c.execute("SELECT platform, data, connected_at FROM credentials").fetchall():
                data = json.loads(r["data"])
                handle = data.get("handle") or r["platform"]
                cid = f"{r['platform']}:{handle}"
                c.execute(
                    "INSERT OR IGNORE INTO connections (id, platform, handle, data, connected_at) VALUES (?, ?, ?, ?, ?)",
                    (cid, r["platform"], handle, r["data"], r["connected_at"]),
                )
            c.execute("DROP TABLE credentials")
        c.execute("""
            CREATE TABLE IF NOT EXISTS media (
                id           TEXT PRIMARY KEY,
                content_type TEXT NOT NULL,
                filename     TEXT NOT NULL,
                size         INTEGER NOT NULL,
                alt          TEXT NOT NULL DEFAULT '',
                created_at   INTEGER NOT NULL
            )
        """)
        mcols = {r["name"] for r in c.execute("PRAGMA table_info(media)").fetchall()}
        if "alt" not in mcols:
            c.execute("ALTER TABLE media ADD COLUMN alt TEXT NOT NULL DEFAULT ''")

        c.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                color      TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS metric_snapshots (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id  TEXT NOT NULL,
                target   TEXT NOT NULL,
                likes    INTEGER NOT NULL,
                reposts  INTEGER NOT NULL,
                replies  INTEGER NOT NULL,
                taken_at INTEGER NOT NULL
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_snap_time ON metric_snapshots (taken_at)")

        c.execute("""
            CREATE TABLE IF NOT EXISTS follower_snapshots (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                conn_id   TEXT NOT NULL,
                followers INTEGER NOT NULL,
                taken_at  INTEGER NOT NULL
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_follow_time ON follower_snapshots (taken_at)")
        c.execute("""
            CREATE TABLE IF NOT EXISTS links (
                code       TEXT PRIMARY KEY,
                url        TEXT NOT NULL,
                post_id    TEXT,
                platform   TEXT,
                created_at INTEGER NOT NULL
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS clicks (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                code       TEXT NOT NULL,
                clicked_at INTEGER NOT NULL
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id            TEXT PRIMARY KEY,
                email         TEXT UNIQUE NOT NULL,
                salt          TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role          TEXT NOT NULL DEFAULT 'member',
                created_at    INTEGER NOT NULL
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT PRIMARY KEY,
                user_id    TEXT NOT NULL,
                expires_at INTEGER NOT NULL
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                kind       TEXT NOT NULL,          -- published | failed | pending
                title      TEXT NOT NULL,
                body       TEXT NOT NULL,
                post_id    TEXT,
                audience   TEXT NOT NULL DEFAULT 'all',   -- all | admin
                read       INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_notif_time ON notifications (created_at DESC)")
        c.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                workspace_id TEXT PRIMARY KEY,
                data         TEXT NOT NULL DEFAULT '{}',
                updated_at   INTEGER NOT NULL
            )
        """)
        

def _row_to_post(row) -> dict:
    return {
        "id": row["id"],
        "text": row["text"],
        "platforms": json.loads(row["platforms"]),
        "scheduledAt": row["scheduledAt"],
        "status": row["status"],
        "results": json.loads(row["results"]),
        "metrics": json.loads(row["metrics"]),
        "repeat": row["repeat"],
        "media": json.loads(row["media"]),
        "createdAt": row["createdAt"],
        "thread": json.loads(row["thread"]),
        "variants": json.loads(row["variants"]),
        "first_comment": row["first_comment"],
        "category": row["category"],
        "link_mode": row["link_mode"],
        "utm_campaign": row["utm_campaign"],
    }


def list_posts() -> list[dict]:
    with _conn() as c:
        rows = c.execute("SELECT * FROM posts ORDER BY scheduledAt").fetchall()
    return [_row_to_post(r) for r in rows]


def get_post(post_id: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
    return _row_to_post(row) if row else None


def upsert_post(post: Post) -> dict:
    with _conn() as c:
        c.execute(
            """INSERT OR REPLACE INTO posts
               (id, text, platforms, scheduledAt, status, results, metrics, repeat, media, thread, variants, first_comment, category, link_mode, utm_campaign, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                post.id,
                post.text,
                json.dumps(post.platforms),
                post.scheduledAt,
                post.status,
                json.dumps({k: v.model_dump() for k, v in post.results.items()}),
                json.dumps({k: v.model_dump() for k, v in post.metrics.items()}),
                post.repeat,
                json.dumps(post.media),
                json.dumps(post.thread),
                json.dumps(post.variants),
                post.first_comment,
                post.category,
                post.link_mode,
                post.utm_campaign,
                post.createdAt,
            ),
        )
    return post.model_dump()


def patch_post(post_id: str, changes: dict) -> dict | None:
    existing = get_post(post_id)
    if existing is None:
        return None
    fields = {k: v for k, v in changes.items() if k in _MUTABLE}
    if not fields:
        return existing
    existing.update(fields)
    sets, values = [], []
    for k in fields:
        sets.append(f"{k} = ?")
        values.append(json.dumps(existing[k]) if k in _JSON_COLS else existing[k])
    values.append(post_id)
    with _conn() as c:
        c.execute(f"UPDATE posts SET {', '.join(sets)} WHERE id = ?", values)
    return existing


def delete_post(post_id: str):
    with _conn() as c:
        c.execute("DELETE FROM posts WHERE id = ?", (post_id,))


def make_conn_id(platform: str, handle: str) -> str:
    return f"{platform}:{handle}"


def list_connections(platform: str | None = None) -> list[dict]:
    q = "SELECT * FROM connections"
    args = ()
    if platform:
        q += " WHERE platform = ?"
        args = (platform,)
    with _conn() as c:
        rows = c.execute(q + " ORDER BY connected_at", args).fetchall()
    return [{**dict(r), "data": json.loads(decrypt(r["data"]))} for r in rows]

def get_connection(conn_id: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM connections WHERE id = ?", (conn_id,)).fetchone()
    return {**dict(row), "data": json.loads(decrypt(row["data"]))} if row else None

def set_connection(platform: str, handle: str, data: dict) -> str:
    cid = make_conn_id(platform, handle)
    blob = encrypt(json.dumps(data))
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO connections (id, platform, handle, data, connected_at) VALUES (?, ?, ?, ?, ?)",
            (cid, platform, handle, blob, int(time.time() * 1000)),
        )
    return cid


def delete_connection(conn_id: str):
    with _conn() as c:
        c.execute("DELETE FROM connections WHERE id = ?", (conn_id,))

def resolve_target(target: str) -> dict | None:
    """Accept a connection id OR a legacy bare platform id; return the connection."""
    if ":" in target:
        return get_connection(target)
    conns = list_connections(target)          # legacy: first connection of that platform
    return conns[0] if conns else None


def add_media(media_id: str, content_type: str, filename: str, size: int):
    with _conn() as c:
        c.execute(
            "INSERT INTO media (id, content_type, filename, size, created_at) VALUES (?, ?, ?, ?, ?)",
            (media_id, content_type, filename, size, int(time.time() * 1000)),
        )


def get_media(media_id: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone()
    return dict(row) if row else None


def load_media_bytes(media_id: str):
    """Return (bytes, content_type) for a stored media id, or None."""
    meta = get_media(media_id)
    path = MEDIA_DIR / media_id
    if meta is None or not path.exists():
        return None
    return path.read_bytes(), meta["content_type"]

def read_media(media_id: str):
    """Everything an adapter needs to post one media item."""
    meta = get_media(media_id)
    path = MEDIA_DIR / media_id
    if meta is None or not path.exists():
        return None
    ct = meta["content_type"] or ""
    return {
        "bytes": path.read_bytes(),
        "content_type": ct,
        "alt": meta.get("alt", ""),
        "is_video": ct.startswith("video/"),
    }


def set_media_alt(media_id: str, alt: str):
    with _conn() as c:
        c.execute("UPDATE media SET alt = ? WHERE id = ?", (alt, media_id))


def list_categories() -> list[dict]:
    with _conn() as c:
        rows = c.execute("SELECT * FROM categories ORDER BY created_at").fetchall()
    return [dict(r) for r in rows]


def add_category(cat_id: str, name: str, color: str):
    with _conn() as c:
        c.execute("INSERT OR REPLACE INTO categories (id, name, color, created_at) VALUES (?, ?, ?, ?)",
                  (cat_id, name, color, int(time.time() * 1000)))


def delete_category(cat_id: str):
    with _conn() as c:
        c.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
        c.execute("UPDATE posts SET category = NULL WHERE category = ?", (cat_id,))   # unlink

def list_media() -> list[dict]:
    with _conn() as c:
        rows = c.execute("SELECT id, content_type, filename, size, alt, created_at FROM media ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def delete_media(media_id: str):
    with _conn() as c:
        c.execute("DELETE FROM media WHERE id = ?", (media_id,))
    path = MEDIA_DIR / media_id
    if path.exists():
        path.unlink()

def add_snapshot(post_id, target, m, taken_at):
    with _conn() as c:
        c.execute(
            "INSERT INTO metric_snapshots (post_id, target, likes, reposts, replies, taken_at) VALUES (?, ?, ?, ?, ?, ?)",
            (post_id, target, m.get("likes", 0), m.get("reposts", 0), m.get("replies", 0), taken_at),
        )


def snapshots_since(since_ms: int) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT post_id, target, likes, reposts, replies, taken_at FROM metric_snapshots WHERE taken_at >= ? ORDER BY taken_at",
            (since_ms,),
        ).fetchall()
    return [dict(r) for r in rows]

def add_follower_snapshot(conn_id: str, followers: int, taken_at: int):
    with _conn() as c:
        c.execute("INSERT INTO follower_snapshots (conn_id, followers, taken_at) VALUES (?, ?, ?)",
                  (conn_id, followers, taken_at))


def follower_snapshots_since(since_ms: int) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT conn_id, followers, taken_at FROM follower_snapshots WHERE taken_at >= ? ORDER BY taken_at",
            (since_ms,),
        ).fetchall()
    return [dict(r) for r in rows]

def create_link(url: str, post_id: str, platform: str) -> str:
    code = uuid.uuid4().hex[:8]
    with _conn() as c:
        c.execute("INSERT INTO links (code, url, post_id, platform, created_at) VALUES (?, ?, ?, ?, ?)",
                  (code, url, post_id, platform, int(time.time() * 1000)))
    return code


def get_link(code: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM links WHERE code = ?", (code,)).fetchone()
    return dict(row) if row else None


def add_click(code: str):
    with _conn() as c:
        c.execute("INSERT INTO clicks (code, clicked_at) VALUES (?, ?)", (code, int(time.time() * 1000)))


def click_counts() -> list[dict]:
    with _conn() as c:
        rows = c.execute("""
            SELECT l.post_id, l.platform, l.url, COUNT(k.id) AS clicks
            FROM links l LEFT JOIN clicks k ON k.code = l.code
            GROUP BY l.code ORDER BY clicks DESC
        """).fetchall()
    return [dict(r) for r in rows]

def create_user(email: str, salt: str, password_hash: str, role: str) -> str:
    uid = f"user_{uuid.uuid4().hex[:12]}"
    with _conn() as c:
        c.execute("INSERT INTO users (id, email, salt, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                  (uid, email.lower(), salt, password_hash, role, int(time.time() * 1000)))
    return uid


def get_user_by_email(email: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM users WHERE email = ?", (email.lower(),)).fetchone()
    return dict(row) if row else None


def get_user(uid: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    return dict(row) if row else None


def count_users() -> int:
    with _conn() as c:
        return c.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]


def create_session(token: str, user_id: str, expires_at: int):
    with _conn() as c:
        c.execute("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
                  (token, user_id, expires_at))

def prune_sessions() -> int:
    with _conn() as c:
        cur = c.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time() * 1000),))
        return cur.rowcount

def get_session(token: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT user_id, expires_at FROM sessions WHERE token = ?", (token,)).fetchone()
    return dict(row) if row else None


def delete_session(token: str):
    with _conn() as c:
        c.execute("DELETE FROM sessions WHERE token = ?", (token,))


def list_users() -> list[dict]:
    with _conn() as c:
        rows = c.execute("SELECT id, email, role, created_at FROM users ORDER BY created_at").fetchall()
    return [dict(r) for r in rows]


def delete_user(uid: str):
    with _conn() as c:
        c.execute("DELETE FROM users WHERE id = ?", (uid,))
        c.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))


def update_user_role(uid: str, role: str):
    with _conn() as c:
        c.execute("UPDATE users SET role = ? WHERE id = ?", (role, uid))


def count_admins() -> int:
    with _conn() as c:
        return c.execute("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").fetchone()["n"]

def add_notification(kind, title, body, post_id=None, audience="all"):
    with _conn() as c:
        c.execute(
            "INSERT INTO notifications (kind, title, body, post_id, audience, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
            (kind, title, body, post_id, audience, int(time.time() * 1000)),
        )


def list_notifications(is_admin: bool, limit: int = 50) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM notifications WHERE audience = 'all' OR (audience = 'admin' AND ?) ORDER BY created_at DESC LIMIT ?",
            (1 if is_admin else 0, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def unread_count(is_admin: bool) -> int:
    with _conn() as c:
        return c.execute(
            "SELECT COUNT(*) AS n FROM notifications WHERE read = 0 AND (audience = 'all' OR (audience = 'admin' AND ?))",
            (1 if is_admin else 0,),
        ).fetchone()["n"]


def mark_all_read(is_admin: bool = True):
    with _conn() as c:
        c.execute(
            "UPDATE notifications SET read = 1 WHERE read = 0 AND (audience = 'all' OR (audience = 'admin' AND ?))",
            (1 if is_admin else 0,),
        )

def get_settings(ws: str) -> dict:
    with _conn() as c:
        row = c.execute("SELECT data FROM settings WHERE workspace_id = ?", (ws,)).fetchone()
    return json.loads(row["data"]) if row else {}


def set_settings(ws: str, data: dict) -> dict:
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO settings (workspace_id, data, updated_at) VALUES (?, ?, ?)",
            (ws, json.dumps(data), int(time.time() * 1000)),
        )
    return data