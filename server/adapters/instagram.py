import asyncio
import os
import httpx

from .base import Adapter

API_VERSION = os.environ.get("INSTAGRAM_API_VERSION", "v25.0")
BASE = f"https://graph.instagram.com/{API_VERSION}"
MAX_CAROUSEL = 10
MAX_CAPTION = 2200
POLL_TIMEOUT_S = 180
POLL_INTERVAL_S = 5


def _public_base() -> str:
    base = (os.environ.get("PUBLIC_BASE_URL") or "").rstrip("/")
    if not base or base.startswith("http://localhost"):
        raise Exception("Instagram media requires PUBLIC_BASE_URL to be a public https host")
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


class InstagramAdapter(Adapter):
    def __init__(self, conn_id: str):
        super().__init__("instagram")
        self._conn_id = conn_id
        self._user_id = None

    async def _token(self) -> str:
        from oauth import valid_access_token
        tok = await valid_access_token(self._conn_id)
        if not tok:
            raise Exception("Instagram account not connected")
        return tok

    async def _resolve_uid(self, http, token) -> str:
        if self._user_id:
            return self._user_id
        r = await http.get(f"{BASE}/me", params={"fields": "user_id,username",
                                                "access_token": token})
        r.raise_for_status()
        body = r.json()
        self._user_id = body.get("user_id") or body["id"]
        return self._user_id

    def _media_info(self, media_id: str) -> dict:
        from db import get_media
        meta = get_media(media_id)
        if meta is None:
            raise Exception(f"media not found: {media_id}")
        ctype = meta.get("content_type") or ""
        return {
            "url": f"{_public_base()}/media/{media_id}",
            "is_video": ctype.startswith("video/"),
            "alt": (meta.get("alt") or "").strip(),
        }

    async def _create_container(self, http, uid, token, params: dict) -> str:
        r = await http.post(f"{BASE}/{uid}/media",
                            params={**params, "access_token": token})
        r.raise_for_status()
        return r.json()["id"]

    async def _wait_ready(self, http, token, container_id: str):
        waited = 0
        while waited < POLL_TIMEOUT_S:
            r = await http.get(f"{BASE}/{container_id}",
                               params={"fields": "status_code,status",
                                       "access_token": token})
            r.raise_for_status()
            body = r.json()
            code = body.get("status_code")
            if code == "FINISHED":
                return
            if code in ("ERROR", "EXPIRED"):
                raise Exception(body.get("status") or f"container {code}")
            await asyncio.sleep(POLL_INTERVAL_S)
            waited += POLL_INTERVAL_S
        raise Exception("Instagram container did not finish processing in time")

    async def publish(self, post: dict) -> dict:
        try:
            token = await self._token()
            caption = post.get("text") or ""
            media = post.get("media") or []

            if not media:
                return {"ok": False,
                        "error": "Instagram requires at least one image or video"}
            if len(media) > MAX_CAROUSEL:
                return {"ok": False,
                        "error": f"Instagram allows at most {MAX_CAROUSEL} media items"}
            if len(caption) > MAX_CAPTION:
                return {"ok": False,
                        "error": f"Instagram caption limit is {MAX_CAPTION} characters"}

            async with httpx.AsyncClient(timeout=180) as http:
                uid = await self._resolve_uid(http, token)

                if len(media) == 1:
                    info = self._media_info(media[0])
                    if info["is_video"]:
                        params = {"media_type": "REELS", "video_url": info["url"],
                                  "caption": caption, "share_to_feed": "true"}
                    else:
                        params = {"image_url": info["url"], "caption": caption}
                        if info["alt"]:
                            params["alt_text"] = info["alt"]
                    creation_id = await self._create_container(http, uid, token, params)

                else:
                    children = []
                    for mid in media:
                        info = self._media_info(mid)
                        if info["is_video"]:
                            params = {"media_type": "VIDEO", "video_url": info["url"],
                                      "is_carousel_item": "true"}
                        else:
                            params = {"image_url": info["url"],
                                      "is_carousel_item": "true"}
                            if info["alt"]:
                                params["alt_text"] = info["alt"]
                        children.append(
                            await self._create_container(http, uid, token, params))

                    for cid in children:
                        await self._wait_ready(http, token, cid)

                    creation_id = await self._create_container(
                        http, uid, token,
                        {"media_type": "CAROUSEL", "children": ",".join(children),
                         "caption": caption})

                await self._wait_ready(http, token, creation_id)

                published = await http.post(
                    f"{BASE}/{uid}/media_publish",
                    params={"creation_id": creation_id, "access_token": token})
                published.raise_for_status()
                return {"ok": True, "ref": published.json()["id"]}

        except Exception as e:
            return {"ok": False, "error": _err(e)}

    async def fetch_metrics(self, ref: str) -> dict:
        token = await self._token()
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(f"{BASE}/{ref}/insights",
                               params={"metric": "likes,comments,shares,saved",
                                       "access_token": token})
            r.raise_for_status()
            vals = {}
            for item in r.json().get("data", []):
                v = item.get("total_value", {}).get("value")
                if v is None:
                    v = (item.get("values") or [{}])[0].get("value", 0)
                vals[item.get("name")] = v or 0
            return {
                "likes":   vals.get("likes", 0),
                "reposts": vals.get("shares", 0) + vals.get("saved", 0),
                "replies": vals.get("comments", 0),
            }

    async def fetch_followers(self) -> int:
        token = await self._token()
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(f"{BASE}/me", params={"fields": "followers_count",
                                                     "access_token": token})
            r.raise_for_status()
            return r.json().get("followers_count", 0)

    async def verify(self) -> str | None:
        token = await self._token()
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(f"{BASE}/me", params={"fields": "username",
                                                     "access_token": token})
            r.raise_for_status()
            return "@" + r.json().get("username", "instagram")