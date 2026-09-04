import os
import httpx

from .base import Adapter

API = "https://www.googleapis.com/youtube/v3"
UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos"
MAX_TITLE = 100
DEFAULT_PRIVACY = os.environ.get("YOUTUBE_PRIVACY", "public")


def _err(e: Exception) -> str:
    if isinstance(e, httpx.HTTPStatusError):
        try:
            err = e.response.json().get("error", {})
            msg = err.get("message")
            if msg:
                return msg
        except Exception:
            pass
        return e.response.text or str(e)
    return str(e)


def _split_title(text: str) -> tuple[str, str]:
    """YouTube needs a title. Use the first line; keep the whole text as description."""
    first = (text.strip().split("\n", 1)[0] or "Untitled").strip()
    first = first.replace("<", "").replace(">", "")     # YouTube rejects angle brackets
    return first[:MAX_TITLE], text


class YouTubeAdapter(Adapter):
    def __init__(self, conn_id: str):
        super().__init__("youtube")
        self._conn_id = conn_id

    async def _token(self) -> str:
        from oauth import valid_access_token
        tok = await valid_access_token(self._conn_id)
        if not tok:
            raise Exception("YouTube account not connected")
        return tok

    def _video_path(self, media_ids: list):
        from db import MEDIA_DIR, get_media
        for mid in media_ids:
            meta = get_media(mid)
            if meta and (meta.get("content_type") or "").startswith("video/"):
                path = MEDIA_DIR / mid
                if not path.exists():
                    raise Exception(f"video file missing on disk: {mid}")
                return path, meta["content_type"]
        return None, None

    async def publish(self, post: dict) -> dict:
        try:
            token = await self._token()
            text = post.get("text") or ""
            path, ctype = self._video_path(post.get("media") or [])

            if path is None:
                return {"ok": False, "error": "YouTube requires a video file"}

            title, description = _split_title(text)
            size = path.stat().st_size

            async with httpx.AsyncClient(timeout=600) as http:
                # 1. open a resumable session
                start = await http.post(
                    UPLOAD,
                    params={"uploadType": "resumable", "part": "snippet,status"},
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json; charset=UTF-8",
                        "X-Upload-Content-Length": str(size),
                        "X-Upload-Content-Type": ctype,
                    },
                    json={
                        "snippet": {"title": title, "description": description},
                        "status": {"privacyStatus": DEFAULT_PRIVACY,
                                   "selfDeclaredMadeForKids": False},
                    },
                )
                start.raise_for_status()
                session_uri = start.headers.get("Location")
                if not session_uri:
                    raise Exception("YouTube did not return an upload session URI")

                # 2. send the bytes
                data = path.read_bytes()
                up = await http.put(
                    session_uri,
                    headers={"Content-Type": ctype, "Content-Length": str(size)},
                    content=data,
                )
                up.raise_for_status()
                return {"ok": True, "ref": up.json()["id"]}

        except Exception as e:
            return {"ok": False, "error": _err(e)}

    async def fetch_metrics(self, ref: str) -> dict:
        token = await self._token()
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(f"{API}/videos",
                               params={"part": "statistics", "id": ref},
                               headers={"Authorization": f"Bearer {token}"})
            r.raise_for_status()
            items = r.json().get("items") or []
            s = items[0].get("statistics", {}) if items else {}
            return {
                "likes":   int(s.get("likeCount", 0)),
                "replies": int(s.get("commentCount", 0)),
                "reposts": 0,                       # YouTube has no share metric
            }

    async def fetch_followers(self) -> int:
        token = await self._token()
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(f"{API}/channels",
                               params={"part": "statistics", "mine": "true"},
                               headers={"Authorization": f"Bearer {token}"})
            r.raise_for_status()
            items = r.json().get("items") or []
            s = items[0].get("statistics", {}) if items else {}
            return int(s.get("subscriberCount", 0))

    async def verify(self) -> str | None:
        token = await self._token()
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(f"{API}/channels",
                               params={"part": "snippet", "mine": "true"},
                               headers={"Authorization": f"Bearer {token}"})
            r.raise_for_status()
            items = r.json().get("items") or []
            if not items:
                raise Exception("No YouTube channel on this Google account")
            return items[0]["snippet"]["title"]