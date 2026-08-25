def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_create_and_fetch_post(client):
    body = {"id": "post_x", "text": "hi", "platforms": [],
            "scheduledAt": "2030-01-01T00:00:00Z", "status": "draft", "createdAt": 0}
    assert client.post("/posts", json=body).status_code == 200
    assert client.get("/posts/post_x").json()["text"] == "hi"
    assert client.get("/posts/nope").status_code == 404


def test_delete_missing_post_404s(client):
    assert client.delete("/posts/nope").status_code == 404


def test_settings_roundtrip(client):
    client.put("/settings", json={"timezone": "America/Vancouver"})
    assert client.get("/settings").json()["timezone"] == "America/Vancouver"


def test_options_preflight_never_401s(client):
    # Regression guard for P16.13 — preflight carries no auth header.
    r = client.options("/posts", headers={
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
    })
    assert r.status_code != 401