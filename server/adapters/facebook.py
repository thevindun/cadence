import json
import os
import httpx

from .base import Adapter

API_VERSION = os.environ.get("FACEBOOK_API_VERSION", "v25.0")
BASE = f"https://graph.facebook.com/{API_VERSION}"
MAX_PHOTOS = 10


def _public_base() -> str:
    base = (os.environ.get("PUBLIC_BASE_URL") or "").rstrip("/")
    if not base or base.startswith("http://localhost"):
        raise Exception("Facebook media requires PUBLIC_BASE_URL to be a public https host")
    return base


def _err(e: Exception) -> str:
    if isinstance(e, httpx.HTTPStatusError):
        try:
            msg = e.response.json().get("error", {}).get("message")
            if msg:
                return msg
        except Exception:
            pass
        return e.response.text or str(e)
    return str(e)


class FacebookAdapter(Adapter):
    def __init__(self, conn_id: str):
        super().__init__("facebook")
        self._conn_id = conn_id

    def _creds(self) -> tuple[str, str]:
        """Page tokens from a long-lived user token don't expire — read them directly."""
        from db import get_connection
        conn = get_connection(self._conn_id)
        if not conn:
            raise Exception("Facebook Page not connected")
        data = conn["data"] or {}
        page_id = data.get("page_id")
        token = data.get("access_token")
        if not page_id or not token:
            raise Exception("Facebook connection missing page_id or token")
        return page_id, token

    def _media_info(self, media_id: str) -> dict:
        from db import get_media
        meta = get_media(media_id)
        if meta is None:
            raise Exception(f"media not found: {media_id}")
        ctype = meta.get("content_type") or ""
        return {
            "url": f"{_public_base()}/media/{media_id}",
            "is_video": ctype.startswith("video/"),
        }

    async def publish(self, post: dict) -> dict:
        try:
            page_id, token = self._creds()
            message = post.get("text") or ""
            media = post.get("media") or []

            infos = [self._media_info(m) for m in media]
            videos = [i for i in infos if i["is_video"]]
            photos = [i for i in infos if not i["is_video"]]

            if videos and photos:
                return {"ok": False,
                        "error": "Facebook can't combine photos and video in one post"}
            if len(videos) > 1:
                return {"ok": False, "error": "Facebook allows one video per post"}
            if len(photos) > MAX_PHOTOS:
                return {"ok": False,
                        "error": f"Facebook allows at most {MAX_PHOTOS} photos per post"}

            async with httpx.AsyncClient(timeout=180) as http:

                if videos:
                    r = await http.post(f"{BASE}/{page_id}/videos", params={
                        "file_url": videos[0]["url"],
                        "description": message,
                        "access_token": token,
                    })
                    r.raise_for_status()
                    return {"ok": True, "ref": r.json()["id"]}

                if not photos:
                    r = await http.post(f"{BASE}/{page_id}/feed", params={
                        "message": message, "access_token": token})
                    r.raise_for_status()
                    return {"ok": True, "ref": r.json()["id"]}

                if len(photos) == 1:
                    r = await http.post(f"{BASE}/{page_id}/photos", params={
                        "url": photos[0]["url"],
                        "caption": message,
                        "access_token": token,
                    })
                    r.raise_for_status()
                    body = r.json()
                    return {"ok": True, "ref": body.get("post_id") or body["id"]}

                # multi-photo: upload unpublished, then attach to one feed post
                fbids = []
                for info in photos:
                    r = await http.post(f"{BASE}/{page_id}/photos", params={
                        "url": info["url"], "published": "false",
                        "access_token": token,
                    })
                    r.raise_for_status()
                    fbids.append(r.json()["id"])

                params = {"message": message, "access_token": token}
                for i, fbid in enumerate(fbids):
                    params[f"attached_media[{i}]"] = json.dumps({"media_fbid": fbid})

                r = await http.post(f"{BASE}/{page_id}/feed", params=params)
                r.raise_for_status()
                return {"ok": True, "ref": r.json()["id"]}

        except Exception as e:
            return {"ok": False, "error": _err(e)}

    async def fetch_metrics(self, ref: str) -> dict:
        _, token = self._creds()
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(f"{BASE}/{ref}", params={
                "fields": "likes.summary(true),comments.summary(true),shares",
                "access_token": token,
            })
            r.raise_for_status()
            b = r.json()
            return {
                "likes":   b.get("likes", {}).get("summary", {}).get("total_count", 0),
                "replies": b.get("comments", {}).get("summary", {}).get("total_count", 0),
                "reposts": (b.get("shares") or {}).get("count", 0),
            }

    async def fetch_followers(self) -> int:
        page_id, token = self._creds()
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(f"{BASE}/{page_id}",
                               params={"fields": "followers_count", "access_token": token})
            r.raise_for_status()
            return r.json().get("followers_count", 0)

    async def verify(self) -> str | None:
        page_id, token = self._creds()
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(f"{BASE}/{page_id}",
                               params={"fields": "name", "access_token": token})
            r.raise_for_status()
            return r.json().get("name", "Facebook Page")
            