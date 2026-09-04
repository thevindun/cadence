import asyncio
import httpx

from .base import Adapter

BASE = "https://graph.threads.net/v1.0"
MAX_CAROUSEL = 20
POLL_TIMEOUT_S = 90
POLL_INTERVAL_S = 5


def _public_base() -> str:
    import os
    base = (os.environ.get("PUBLIC_BASE_URL") or "").rstrip("/")
    if not base or base.startswith("http://localhost"):
        raise Exception(
            "Threads media requires PUBLIC_BASE_URL to be a public https host"
        )
    return base


def _err(e: Exception) -> str:
    """Meta returns structured JSON errors; surface the useful part."""
    if isinstance(e, httpx.HTTPStatusError):
        try:
            body = e.response.json()
            msg = body.get("error", {}).get("message")
            if msg:
                return msg
        except Exception:
            pass
        return e.response.text or str(e)
    return str(e)


class ThreadsAdapter(Adapter):
    def __init__(self, conn_id: str):
        super().__init__("threads")
        self._conn_id = conn_id
        self._user_id = None

    async def _token(self) -> str:
        from oauth import valid_access_token
        tok = await valid_access_token(self._conn_id)
        if not tok:
            raise Exception("Threads account not connected")
        return tok

    async def _resolve_uid(self, http, token) -> str:
        if self._user_id:
            return self._user_id
        r = await http.get(f"{BASE}/me", params={"fields": "id,username", "access_token": token})
        r.raise_for_status()
        self._user_id = r.json()["id"]
        return self._user_id

    # ---- media helpers ----

    def _media_info(self, media_id: str) -> dict:
        """Resolve a Cadence media id to a public URL + kind + alt text."""
        from db import get_media
        meta = get_media(media_id)
        if meta is None:
            raise Exception(f"media not found: {media_id}")
        ctype = meta.get("content_type") or ""
        is_video = ctype.startswith("video/")
        return {
            "url": f"{_public_base()}/media/{media_id}",
            "kind": "VIDEO" if is_video else "IMAGE",
            "alt": (meta.get("alt") or "").strip(),
        }

    async def _create_container(self, http, uid, token, params: dict) -> str:
        r = await http.post(f"{BASE}/{uid}/threads",
                            params={**params, "access_token": token})
        r.raise_for_status()
        return r.json()["id"]

    async def _wait_ready(self, http, token, container_id: str):
        """Meta needs time to fetch + process remote media. Poll instead of sleeping blind."""
        waited = 0
        while waited < POLL_TIMEOUT_S:
            r = await http.get(f"{BASE}/{container_id}",
                               params={"fields": "status,error_message",
                                       "access_token": token})
            r.raise_for_status()
            body = r.json()
            status = body.get("status")
            if status == "FINISHED":
                return
            if status in ("ERROR", "EXPIRED"):
                raise Exception(body.get("error_message") or f"container {status}")
            await asyncio.sleep(POLL_INTERVAL_S)
            waited += POLL_INTERVAL_S
        raise Exception("Threads container did not finish processing in time")

    # ---- publish ----

    async def publish(self, post: dict) -> dict:
        try:
            token = await self._token()
            text = post.get("text") or ""
            media = post.get("media") or []

            if len(text) > 500:
                return {"ok": False, "error": "Threads limit is 500 characters"}
            if len(media) > MAX_CAROUSEL:
                return {"ok": False,
                        "error": f"Threads allows at most {MAX_CAROUSEL} media items"}

            async with httpx.AsyncClient(timeout=120) as http:
                uid = await self._resolve_uid(http, token)

                if not media:
                    creation_id = await self._create_container(
                        http, uid, token, {"media_type": "TEXT", "text": text})

                elif len(media) == 1:
                    info = self._media_info(media[0])
                    params = {"media_type": info["kind"], "text": text}
                    params["image_url" if info["kind"] == "IMAGE" else "video_url"] = info["url"]
                    if info["alt"]:
                        params["alt_text"] = info["alt"]
                    creation_id = await self._create_container(http, uid, token, params)
                    await self._wait_ready(http, token, creation_id)

                else:
                    children = []
                    for mid in media:
                        info = self._media_info(mid)
                        params = {"media_type": info["kind"], "is_carousel_item": "true"}
                        params["image_url" if info["kind"] == "IMAGE" else "video_url"] = info["url"]
                        if info["alt"]:
                            params["alt_text"] = info["alt"]
                        children.append(await self._create_container(http, uid, token, params))

                    for cid in children:
                        await self._wait_ready(http, token, cid)

                    creation_id = await self._create_container(
                        http, uid, token,
                        {"media_type": "CAROUSEL", "children": ",".join(children), "text": text})
                    await self._wait_ready(http, token, creation_id)

                published = await http.post(
                    f"{BASE}/{uid}/threads_publish",
                    params={"creation_id": creation_id, "access_token": token},
                )
                published.raise_for_status()
                return {"ok": True, "ref": published.json()["id"]}

        except Exception as e:
            return {"ok": False, "error": _err(e)}

    async def fetch_metrics(self, ref: str) -> dict:
        token = await self._token()
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(
                f"{BASE}/{ref}/insights",
                params={"metric": "likes,replies,reposts,quotes", "access_token": token},
            )
            r.raise_for_status()
            vals = {}
            for item in r.json().get("data", []):
                v = item.get("total_value", {}).get("value")
                if v is None:                       # some metrics come as a values[] series
                    v = (item.get("values") or [{}])[0].get("value", 0)
                vals[item.get("name")] = v or 0
            return {
                "likes":   vals.get("likes", 0),
                "reposts": vals.get("reposts", 0) + vals.get("quotes", 0),
                "replies": vals.get("replies", 0),
            }

    async def verify(self) -> str | None:
        token = await self._token()
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(f"{BASE}/me", params={"fields": "username", "access_token": token})
            r.raise_for_status()
            return "@" + r.json().get("username", "threads")