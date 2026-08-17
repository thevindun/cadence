import httpx
import asyncio
from db import load_media_bytes
from .base import Adapter
from db import read_media
import re
import html as _html
from datetime import datetime

class MastodonAdapter(Adapter):
    def __init__(self, instance_url: str, access_token: str):
        super().__init__("mastodon")
        self._base = instance_url.rstrip("/")
        self._token = access_token

    def _headers(self):
        return {"Authorization": f"Bearer {self._token}"}

    async def verify(self) -> str | None:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{self._base}/api/v1/accounts/verify_credentials",
                headers=self._headers(),
            )
            r.raise_for_status()
            acct = r.json().get("acct")
            host = self._base.split("://")[-1]
            return f"@{acct}@{host}" if acct else None

    async def fetch_followers(self) -> int | None:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(f"{self._base}/api/v1/accounts/verify_credentials", headers=self._headers())
                r.raise_for_status()
                return r.json().get("followers_count")
        except Exception:
            return None
        
    async def publish(self, post: dict) -> dict:
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                medias = [m for m in (read_media(mid) for mid in post.get("media", [])) if m]
                videos = [m for m in medias if m["is_video"]]
                medias = videos[:1] if videos else medias[:4]   # 1 video, else ≤4 images

                media_ids = []
                for m in medias:
                    up = await client.post(
                        f"{self._base}/api/v2/media",
                        headers=self._headers(),
                        files={"file": ("upload", m["bytes"], m["content_type"])},
                        data={"description": m["alt"]},        # alt text
                    )
                    up.raise_for_status()
                    remote_id = up.json()["id"]
                    if up.status_code == 202:                  # video: async processing
                        await self._wait_for_media(client, remote_id)
                    media_ids.append(remote_id)
                form = {"status": post["text"]}
                if media_ids:
                    form["media_ids[]"] = media_ids

                poll = post.get("poll") or {}
                opts = [o.strip() for o in (poll.get("options") or []) if o.strip()]
                if len(opts) >= 2 and not media_ids:   # Mastodon: poll OR media, never both
                    form["poll[options][]"] = opts[:4]
                    form["poll[expires_in]"] = str(int(poll.get("expires_in") or 86400))
                    form["poll[multiple]"] = "true" if poll.get("multiple") else "false"         # httpx repeats the key per id
                r = await client.post(
                    f"{self._base}/api/v1/statuses",
                    headers={**self._headers(), "Idempotency-Key": post["id"]},
                    data=form,
                )
                r.raise_for_status()
                first_id = str(r.json()["id"])

                prev_id = first_id
                for i, seg in enumerate(post.get("thread") or []):
                    seg = seg.strip()
                    if not seg:
                        continue
                    rr = await client.post(
                        f"{self._base}/api/v1/statuses",
                        headers={**self._headers(), "Idempotency-Key": f"{post['id']}-{i}"},
                        data={"status": seg, "in_reply_to_id": prev_id},
                    )
                    rr.raise_for_status()
                    prev_id = str(rr.json()["id"])

                first_comment = (post.get("first_comment") or "").strip()
                if first_comment:
                    rc = await client.post(
                        f"{self._base}/api/v1/statuses",
                        headers={**self._headers(), "Idempotency-Key": f"{post['id']}-fc"},
                        data={"status": first_comment, "in_reply_to_id": first_id},
                    )
                    rc.raise_for_status()

                return {"ok": True, "ref": first_id}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    
    async def _wait_for_media(self, client, remote_id, attempts=8):
        delay = 1.0
        for _ in range(attempts):
            await asyncio.sleep(delay)
            r = await client.get(
                f"{self._base}/api/v1/media/{remote_id}",
                headers=self._headers(),
            )
            if r.status_code == 200:      # 200 = ready; 206 = still processing
                return
            delay = min(delay * 1.5, 8)

    async def fetch_metrics(self, ref: str) -> dict:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{self._base}/api/v1/statuses/{ref}",
                headers=self._headers(),
            )
            r.raise_for_status()
            s = r.json()
            return {
                "likes":   s.get("favourites_count", 0) or 0,
                "reposts": s.get("reblogs_count", 0) or 0,
                "replies": s.get("replies_count", 0) or 0,
            }
    async def fetch_inbox(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(f"{self._base}/api/v1/notifications",
                                 headers=self._headers(), params={"types[]": "mention", "limit": 40})
            r.raise_for_status()
            items = []
            for n in r.json():
                st = n.get("status") or {}
                try:
                    ts = int(datetime.fromisoformat(n["created_at"].replace("Z", "+00:00")).timestamp() * 1000)
                except Exception:
                    ts = 0
                items.append({
                    "id": str(n["id"]),
                    "author": n["account"]["acct"],
                    "author_name": n["account"].get("display_name") or n["account"]["acct"],
                    "text": _strip_html(st.get("content", "")),
                    "reason": "mention",
                    "created_at": ts,
                    "reply_ctx": {"status_id": st.get("id")},
                })
            return items

    async def reply(self, ctx: dict, text: str) -> dict:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(f"{self._base}/api/v1/statuses", headers=self._headers(),
                                      data={"status": text, "in_reply_to_id": ctx.get("status_id")})
                r.raise_for_status()
                return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

def _strip_html(s: str) -> str:
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"</p>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    return _html.unescape(s).strip()