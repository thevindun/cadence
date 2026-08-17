import os
import httpx

MODEL = os.environ.get("CADENCE_AI_MODEL", "claude-sonnet-4-6")
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")


def is_enabled() -> bool:
    return bool(API_KEY)


SYSTEM = """You write social media captions. Rules:
- Match the requested platform's conventions and length.
- No hashtags unless asked. No emoji unless asked.
- Write in the user's voice, not marketing-speak. No "Unlock", "Dive into", "Game-changer".
- Return ONLY the captions, one per line, no numbering, no preamble, no quotes."""


async def generate(prompt: str, platform: str, count: int, max_len: int,
                   tone: str = "", examples: list[str] | None = None) -> list[str]:
    if not API_KEY:
        raise RuntimeError("AI is not configured — set ANTHROPIC_API_KEY")

    parts = [f"Write {count} distinct caption options for {platform}.",
             f"Hard limit: {max_len} characters each.",
             f"Topic: {prompt}"]
    if tone:
        parts.append(f"Tone: {tone}")
    if examples:
        joined = "\n".join(f"- {e}" for e in examples[:5])
        parts.append(f"Match the voice of these previous posts:\n{joined}")

    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": MODEL,
                "max_tokens": 1000,
                "system": SYSTEM,
                "messages": [{"role": "user", "content": "\n\n".join(parts)}],
            },
        )
        r.raise_for_status()
        data = r.json()

    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    lines = [l.strip().lstrip("-•").strip() for l in text.splitlines() if l.strip()]
    return [l for l in lines if len(l) <= max_len + 40][:count]