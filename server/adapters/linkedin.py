from urllib.parse import quote

import httpx

from .base import Adapter

API = "https://api.linkedin.com"
VERSION = "202608"   # LinkedIn-Version (YYYYMM) — bump within LinkedIn's supported window


class LinkedInAdapter(Adapter):
    def __init__(self, conn_id: str):
        super().__init__("linkedin")
        self._conn_id = conn_id
        self._author = None       # urn:li:person:{id}

    async def _token(self) -> str:
        from oauth import valid_access_token
        tok = await valid_access_token(self._conn_id)
        if not tok:
            raise Exception("LinkedIn account not connected")
        return tok

    def _headers(self, token):
        return {
            "Authorization": f"Bearer {token}",
            "X-Restli-Protocol-Version": "2.0.0",
            "LinkedIn-Version": VERSION,
            "Content-Type": "application/json",
        }

    async def _author_urn(self, http, token) -> str:
        if self._author:
            return self._author
        r = await http.get(f"{API}/v2/userinfo", headers={"Authorization": f"Bearer {token}"})
        r.raise_for_status()
        self._author = f"urn:li:person:{r.json()['sub']}"
        return self._author

    async def publish(self, post: dict) -> dict:
        try:
            token = await self._token()
            async with httpx.AsyncClient(timeout=60) as http:
                if post.get("media"):
                    return {"ok": False,
                            "error": "LinkedIn media needs the asset-upload flow (deploy step); text posts work now"}

                author = await self._author_urn(http, token)
                body = {
                    "author": author,
                    "commentary": post["text"],
                    "visibility": "PUBLIC",
                    "distribution": {
                        "feedDistribution": "MAIN_FEED",
                        "targetEntities": [],
                        "thirdPartyDistributionChannels": [],
                    },
                    "lifecycleState": "PUBLISHED",
                    "isReshareDisabledByAuthor": False,
                }
                r = await http.post(f"{API}/rest/posts", headers=self._headers(token), json=body)
                r.raise_for_status()
                ref = r.headers.get("x-restli-id", "")     # post URN comes in the header
                return {"ok": True, "ref": ref}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def fetch_metrics(self, ref: str) -> dict:
        # Member-post engagement is permission-gated; return zeros if unavailable.
        try:
            token = await self._token()
            async with httpx.AsyncClient(timeout=30) as http:
                r = await http.get(
                    f"{API}/rest/socialActions/{quote(ref, safe='')}",
                    headers=self._headers(token),
                )
                r.raise_for_status()
                d = r.json()
                return {
                    "likes":   d.get("likesSummary", {}).get("totalLikes", 0),
                    "reposts": 0,
                    "replies": d.get("commentsSummary", {}).get("totalFirstLevelComments", 0),
                }
        except Exception:
            return {"likes": 0, "reposts": 0, "replies": 0}

    async def verify(self) -> str | None:
        token = await self._token()
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(f"{API}/v2/userinfo", headers={"Authorization": f"Bearer {token}"})
            r.raise_for_status()
            return r.json().get("name") or "LinkedIn"