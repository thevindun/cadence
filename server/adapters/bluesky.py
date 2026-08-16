import time
import asyncio
import httpx
from atproto import AsyncClient, models

from .base import Adapter
from db import read_media


class BlueskyAdapter(Adapter):
    def __init__(self, handle: str, app_password: str):
        super().__init__("bluesky")
        self._handle = handle
        self._app_password = app_password
        self._client = None                      # cached logged-in session
        self._pds_cache = None

    async def _get_client(self) -> AsyncClient:
        if self._client is None:
            client = AsyncClient()
            await client.login(self._handle, self._app_password)
            self._client = client
        return self._client

    async def publish(self, post: dict) -> dict:
        try:
            client = await self._get_client()

            medias = [m for m in (read_media(mid) for mid in post.get("media", [])) if m]
            videos = [m for m in medias if m["is_video"]]

            if videos:
                embed = await self._video_embed(client, videos[0])     # 1 video per post
                response = await client.send_post(text=post["text"], embed=embed)
            else:
                images = medias[:4]
                if images:
                    response = await client.send_images(
                        text=post["text"],
                        images=[m["bytes"] for m in images],
                        image_alts=[m["alt"] for m in images],
                    )
                else:
                    response = await client.send_post(text=post["text"])

            thread = post.get("thread") or []
            first_comment = (post.get("first_comment") or "").strip()

            parent_ref = root_ref = None
            if thread or first_comment:
                root_ref = models.create_strong_ref(response)
                parent_ref = root_ref

                for seg in thread:
                    seg = seg.strip()
                    if not seg:
                        continue
                    assert root_ref is not None and parent_ref is not None
                    reply = await client.send_post(
                        text=seg,
                        reply_to=models.AppBskyFeedPost.ReplyRef(parent=parent_ref, root=root_ref),
                    )
                    parent_ref = models.create_strong_ref(reply)

                if first_comment:
                    assert root_ref is not None
                    await client.send_post(          # replies to the ROOT, not the thread tail
                        text=first_comment,
                        reply_to=models.AppBskyFeedPost.ReplyRef(parent=root_ref, root=root_ref),
                    )

            return {"ok": True, "ref": response.uri}

        except Exception as e:
            self._client = None
            detail = str(e) or getattr(e, "content", None) or getattr(e, "response", None)
            msg = f"{type(e).__name__}: {detail}" if detail else type(e).__name__
            return {"ok": False, "error": str(msg)[:300]}

    async def _pds_host(self, client) -> str:
            """The account's real PDS host from its DID doc — NOT the login base URL.
            Service-auth tokens for the video service must be scoped to this host."""
            if self._pds_cache:
                return self._pds_cache
            did = client.me.did
            async with httpx.AsyncClient(timeout=30) as http:
                doc = (await http.get(f"https://plc.directory/{did}")).json()
            for s in doc.get("service", []):
                if s.get("id", "").endswith("#atproto_pds"):
                    host = httpx.URL(s["serviceEndpoint"]).host
                    self._pds_cache = host
                    return host
            raise Exception(f"Could not resolve PDS host for {did}")

    async def _video_embed(self, client, media):
        did = client.me.did
        pds_host = await self._pds_host(client)

        auth = await client.com.atproto.server.get_service_auth(
            models.ComAtprotoServerGetServiceAuth.Params(
                aud=f"did:web:{pds_host}",
                lxm="com.atproto.repo.uploadBlob",
                exp=int(time.time()) + 30 * 60,          # 30-min token
            )
        )

        # uploadVideo must go directly to the video service (no PDS proxy).
        async with httpx.AsyncClient(timeout=180) as http:
            up = await http.post(
                "https://video.bsky.app/xrpc/app.bsky.video.uploadVideo",
                params={"did": did, "name": f"{int(time.time() * 1000)}.mp4"},
                headers={
                    "Authorization": f"Bearer {auth.token}",
                    "Content-Type": media["content_type"] or "video/mp4",
                },
                content=media["bytes"],
            )
            # 409 = this exact video was already uploaded; the body still carries
            # the completed job, so reuse it instead of treating it as an error.
            if up.status_code != 409:
                up.raise_for_status()
            body = up.json()

        js = body.get("jobStatus") or body
        blob = js.get("blob")
        job_id = js.get("jobId")

# getJobStatus must ALSO go to the video service — the PDS returns 501.
        async with httpx.AsyncClient(timeout=60) as http:
            for _ in range(60):                          # ~2 min ceiling
                if blob:
                    break
                await asyncio.sleep(2)
                r = await http.get(
                    "https://video.bsky.app/xrpc/app.bsky.video.getJobStatus",
                    params={"jobId": job_id},
                    headers={"Authorization": f"Bearer {auth.token}"},
                )
                r.raise_for_status()
                js2 = r.json().get("jobStatus") or {}
                if js2.get("state") == "JOB_STATE_FAILED":
                    raise Exception(js2.get("error") or "video processing failed")
                blob = js2.get("blob")
        if blob is None:
            raise Exception("video processing timed out")

        return models.AppBskyEmbedVideo.Main(video=blob, alt=media["alt"] or None)  # type: ignore[call-arg]
    
    async def fetch_metrics(self, ref: str) -> dict:
        try:
            client = await self._get_client()
            response = await client.get_posts([ref])
            post = response.posts[0] if response.posts else None
            return {
                "likes":   (post.like_count   if post else 0) or 0,
                "reposts": (post.repost_count if post else 0) or 0,
                "replies": (post.reply_count  if post else 0) or 0,
            }
        except Exception:
            self._client = None
            raise
    async def verify(self) -> str | None:
        await self._get_client()          # logs in; raises if handle/password are wrong
        return self._handle

    async def fetch_followers(self) -> int | None:
        try:
            client = await self._get_client()
            profile = await client.get_profile(self._handle)
            return profile.followers_count
        except Exception:
            self._client = None
            return None

    async def fetch_inbox(self) -> list[dict]:
        from datetime import datetime
        client = await self._get_client()
        resp = await client.app.bsky.notification.list_notifications()
        items = []
        for n in resp.notifications:
            if n.reason not in ("reply", "mention", "quote"):
                continue
            rec = n.record
            root_uri, root_cid = n.uri, n.cid
            reply = getattr(rec, "reply", None)
            if reply is not None and getattr(reply, "root", None) is not None:
                root_uri, root_cid = reply.root.uri, reply.root.cid
            try:
                ts = int(datetime.fromisoformat(n.indexed_at.replace("Z", "+00:00")).timestamp() * 1000)
            except Exception:
                ts = 0
            items.append({
                "id": n.uri,
                "author": n.author.handle,
                "author_name": n.author.display_name or n.author.handle,
                "text": getattr(rec, "text", "") or "",
                "reason": n.reason,
                "created_at": ts,
                "reply_ctx": {"uri": n.uri, "cid": n.cid, "root_uri": root_uri, "root_cid": root_cid},
            })
        return items

    async def reply(self, ctx: dict, text: str) -> dict:
        try:
            client = await self._get_client()
            parent = models.ComAtprotoRepoStrongRef.Main(uri=ctx["uri"], cid=ctx["cid"])
            root = models.ComAtprotoRepoStrongRef.Main(
                uri=ctx.get("root_uri", ctx["uri"]), cid=ctx.get("root_cid", ctx["cid"]))
            await client.send_post(text=text,
                                   reply_to=models.AppBskyFeedPost.ReplyRef(parent=parent, root=root))
            return {"ok": True}
        except Exception as e:
            self._client = None
            return {"ok": False, "error": str(e)}