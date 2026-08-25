import db
from models import Post


def _post(pid, ws, text="hello"):
    return Post(id=pid, text=text, platforms=[], scheduledAt="2030-01-01T00:00:00Z",
                status="draft", createdAt=0)


def test_posts_are_workspace_scoped():
    a = db.create_workspace("A", None)
    b = db.create_workspace("B", None)
    db.upsert_post(_post("p1", a, "alice"), a)
    db.upsert_post(_post("p2", b, "bob"), b)

    assert [p["id"] for p in db.list_posts(a)] == ["p1"]
    assert [p["id"] for p in db.list_posts(b)] == ["p2"]
    assert len(db.list_posts_all()) == 2


def test_get_post_respects_workspace():
    a = db.create_workspace("A", None)
    b = db.create_workspace("B", None)
    db.upsert_post(_post("p1", a), a)
    assert db.get_post("p1", a) is not None
    assert db.get_post("p1", b) is None          # <- the leak this guards


def test_delete_post_cannot_cross_workspaces():
    a = db.create_workspace("A", None)
    b = db.create_workspace("B", None)
    db.upsert_post(_post("p1", a), a)
    db.delete_post("p1", b)                       # wrong workspace: must be a no-op
    assert db.get_post("p1", a) is not None


def test_same_handle_in_two_workspaces():
    a = db.create_workspace("A", None)
    b = db.create_workspace("B", None)
    ida = db.set_connection(a, "bluesky", "me.bsky.social", {"handle": "me.bsky.social"})
    idb = db.set_connection(b, "bluesky", "me.bsky.social", {"handle": "me.bsky.social"})
    assert ida != idb
    assert len(db.list_connections(a)) == 1
    assert len(db.list_connections(b)) == 1
    assert db.relative_id(ida) == "bluesky:me.bsky.social"


def test_resolve_target_scoped():
    a = db.create_workspace("A", None)
    b = db.create_workspace("B", None)
    db.set_connection(a, "bluesky", "me.bsky.social", {"handle": "me.bsky.social"})
    assert db.resolve_target(a, "bluesky:me.bsky.social") is not None
    assert db.resolve_target(b, "bluesky:me.bsky.social") is None


def test_media_and_categories_scoped():
    a = db.create_workspace("A", None)
    b = db.create_workspace("B", None)
    db.add_media("m1", "image/png", "x.png", 10, a)
    db.add_category("c1", "News", "#fff", a)
    assert len(db.list_media(a)) == 1 and len(db.list_media(b)) == 0
    assert len(db.list_categories(a)) == 1 and len(db.list_categories(b)) == 0