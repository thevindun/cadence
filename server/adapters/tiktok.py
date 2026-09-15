import asyncio
import os
import httpx

from .base import Adapter

API = "https://open.tiktokapis.com/v2"
MAX_UPLOAD_BYTES = 64 * 1024 * 1024        # single-chunk ceiling per TikTok's spec
MAX_TITLE = 2200
POLL_TIMEOUT_S = 300
POLL_INTERVAL_S = 5

# "inbox" → video lands in the creator's TikTok drafts (works pre-audit).
# "direct" → publishes immediately, but stays private until your client is audited.
MODE = os.environ.get("TIKTOK_MODE", "inbox").lower()


def _err(e: Exception) -> str:
    if isinstance(e, httpx.HTTPStatusError):
        try:
            err = e.response.json().get("error", {})
            msg = err.get("message") or err.get("code")
            if msg:
                return msg
        except Exception:
            pass
        return e.response.text or str(e)
    return str(e)


class TikTokAdapter(Adapter):
    def __init__(self, conn_id: str):
        super().__init__("tiktok")
        self._conn_id = conn_id

    async def _token(self) -> str:
        from oauth import valid_access_token
        tok = await valid_access_token(self._conn_id)
        if not tok:
            raise Exception("TikTok account not connected")
        return tok

    def _headers(self, token: str) -> dict:
        return {"Authorization": f"Bearer {token}",
                "Content-Type": "application/json; charset=UTF-8"}

    def _video(self, media_ids: list):
        from db import MEDIA_DIR, get_media
        for mid in media_ids:
            meta = get_media(mid)
            if meta and (meta.get("content_type") or "").startswith("video/"):
                path = MEDIA_DIR / mid
                if not path.exists():
                    raise Exception(f"video file missing on disk: {mid}")
                return path, meta["content_type"]
        return None, None

    async def _wait_published(self, http, token, publish_id: str) -> str | None:
        """Poll until TikTok finishes processing; return the public post id if any."""
        waited = 0
        while waited < POLL_TIMEOUT_S:
            r = await http.post(f"{API}/post/publish/status/fetch/",
                                headers=self._headers(token),
                                json={"publish_id": publish_id})
            r.raise_for_status()
            data = r.json().get("data") or {}
            status = data.get("status")
            if status in ("PUBLISH_COMPLETE", "SEND_TO_USER_INBOX"):
                ids = data.get("publicaly_available_post_id") or []   # TikTok's spelling
                return str(ids[0]) if ids else None
            if status == "FAILED":
                raise Exception(data.get("fail_reason") or "TikTok processing failed")
            await asyncio.sleep(POLL_INTERVAL_S)
            waited += POLL_INTERVAL_S
        raise Exception("TikTok did not finish processing in time")

    async def publish(self, post: dict) -> dict:
        try:
            token = await self._token()
            title = (post.get("text") or "")[:MAX_TITLE]
            path, ctype = self._video(post.get("media") or [])

            if path is None or ctype is None:
                return {"ok": False, "error": "TikTok requires a video file"}

            size = path.stat().st_size
            if size > MAX_UPLOAD_BYTES:
                return {"ok": False,
                        "error": f"TikTok video must be under {MAX_UPLOAD_BYTES // (1024*1024)}MB"}

            source_info = {
                "source": "FILE_UPLOAD",
                "video_size": size,
                "chunk_size": size,          # single chunk
                "total_chunk_count": 1,
            }

            if MODE == "direct":
                endpoint = f"{API}/post/publish/video/init/"
                body = {
                    "post_info": {
                        "title": title,
                        "privacy_level": os.environ.get("TIKTOK_PRIVACY", "SELF_ONLY"),
                        "disable_comment": False,
                        "disable_duet": False,
                        "disable_stitch": False,
                    },
                    "source_info": source_info,
                }
            else:
                endpoint = f"{API}/post/publish/inbox/video/init/"
                body = {"source_info": source_info}

            async with httpx.AsyncClient(timeout=600) as http:
                init = await http.post(endpoint, headers=self._headers(token), json=body)
                init.raise_for_status()
                payload = init.json()
                if (payload.get("error") or {}).get("code") not in (None, "ok"):
                    raise Exception(payload["error"].get("message") or "init failed")

                data = payload.get("data") or {}
                publish_id = data.get("publish_id")
                upload_url = data.get("upload_url")
                if not publish_id or not upload_url:
                    raise Exception("TikTok did not return an upload URL")

                up = await http.put(
                    upload_url,
                    headers={
                        "Content-Type": ctype,
                        "Content-Length": str(size),
                        "Content-Range": f"bytes 0-{size - 1}/{size}",
                    },
                    content=path.read_bytes(),
                )
                up.raise_for_status()

                post_id = await self._wait_published(http, token, publish_id)
                return {"ok": True, "ref": post_id or publish_id}

        except Exception as e:
            return {"ok": False, "error": _err(e)}

    async def fetch_metrics(self, ref: str) -> dict:
        # Inbox-mode posts aren't public yet, and publish_id isn't queryable.
        if ref.startswith("v_pub_"):
            return {"likes": 0, "reposts": 0, "replies": 0}
        token = await self._token()
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.post(
                f"{API}/video/query/",
                params={"fields": "id,like_count,comment_count,share_count"},
                headers=self._headers(token),
                json={"filters": {"video_ids": [ref]}},
            )
            r.raise_for_status()
            videos = (r.json().get("data") or {}).get("videos") or []
            v = videos[0] if videos else {}
            return {
                "likes":   v.get("like_count", 0),
                "replies": v.get("comment_count", 0),
                "reposts": v.get("share_count", 0),
            }

    async def fetch_followers(self) -> int:
        token = await self._token()
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(f"{API}/user/info/",
                               params={"fields": "follower_count"},
                               headers={"Authorization": f"Bearer {token}"})
            r.raise_for_status()
            return ((r.json().get("data") or {}).get("user") or {}).get("follower_count", 0)

    async def verify(self) -> str | None:
        token = await self._token()
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(f"{API}/user/info/",
                               params={"fields": "open_id,display_name"},
                               headers={"Authorization": f"Bearer {token}"})
            r.raise_for_status()
            user = (r.json().get("data") or {}).get("user") or {}
            name = user.get("display_name")
            return "@" + name if name else "tiktok account"