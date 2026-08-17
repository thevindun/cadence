from typing import Optional
from pydantic import BaseModel, Field


class PublishResult(BaseModel):
    ok: bool
    ref: Optional[str] = None
    error: Optional[str] = None


class PlatformMetrics(BaseModel):
    likes: int = 0
    reposts: int = 0
    replies: int = 0
    impressions: int | None = None
    reach: int | None = None
    views: int | None = None


class Post(BaseModel):
    id: str
    text: str
    platforms: list[str]
    scheduledAt: str
    status: str
    results: dict[str, PublishResult] = Field(default_factory=dict)
    metrics: dict[str, PlatformMetrics] = Field(default_factory=dict)
    repeat: str = "none"
    media: list[str] = Field(default_factory=list)     # media ids
    thread: list[str] = Field(default_factory=list)     # extra parts after the main text
    variants: dict[str, str] = Field(default_factory=dict)   # platform id -> override text
    first_comment: str = ""
    category: Optional[str] = None
    link_mode: str = "off"          # off | utm | tracked
    utm_campaign: str = ""
    createdAt: int
    poll: dict = {}


class PostPatch(BaseModel):
    text: Optional[str] = None
    platforms: Optional[list[str]] = None
    scheduledAt: Optional[str] = None
    status: Optional[str] = None
    results: Optional[dict[str, PublishResult]] = None
    metrics: Optional[dict[str, PlatformMetrics]] = None
    repeat: Optional[str] = None
    media: Optional[list[str]] = None
    thread: Optional[list[str]] = None
    variants: Optional[dict[str, str]] = None
    first_comment: Optional[str] = None
    link_mode: Optional[str] = None
    utm_campaign: Optional[str] = None
    poll: dict = {}