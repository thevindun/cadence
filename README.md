<div align="center">

# Cadence

**Post on repeat, never miss a beat.**

A free, self-hosted social media scheduler. Write once, publish everywhere, and get your real engagement numbers back.

[Features](#features) · [Platforms](#supported-platforms) · [Quick start](#quick-start) · [Deploy](#deploying) · [Platform setup](#platform-setup) · [Architecture](#architecture)

</div>

---

## What Cadence is

Cadence is a content scheduler you run yourself. Compose a post once, pick which connected accounts should receive it, and a server-side worker publishes on schedule — whether or not the app is open. It then pulls engagement and follower metrics back so you can see what actually worked.

It exists because the hosted alternatives charge monthly for what amounts to a cron job and a handful of API calls. Cadence is free, the data is yours, and your credentials never leave your server.

**Design principles**

- **Your tokens, your machine.** Access tokens are encrypted at rest on your own server and never exposed to the browser.
- **Publishing is server-side.** Close the laptop. Posts still go out.
- **The core knows nothing about platforms.** Every integration is an adapter behind one interface, so adding a platform never means touching the scheduler.
- **No overclaiming.** If something doesn't work, the docs say so.

---

## Try it

There's a public demo at **[cadence.velaroxsolutions.com](https://cadence.velaroxsolutions.com)**.

The demo runs with `CADENCE_DEMO=1`, which forces every adapter to a mock provider. You can compose, schedule, watch posts publish, and explore the queue, calendar, and insights — but **nothing reaches a real platform**, and connecting real accounts is blocked. Uploads and post counts are capped.

To actually publish, self-host. It takes about ten minutes plus whatever time each platform's developer console demands.

---

## Features

**Composing**
- Multi-account targeting — connect several accounts per platform, each publishes independently
- Per-platform text variants, with a shared base caption as fallback
- Threads and chains (Bluesky, Mastodon), first comments, Mastodon polls
- Image and video upload with alt text, plus a reusable media library
- Templates, hashtag groups, and categories
- Live per-platform preview and character counting against the strictest selected limit
- Optional AI caption assistance

**Scheduling**
- One-off or recurring posts (daily, weekly, monthly)
- Posting slots and a "next open slot" shortcut
- Evergreen pool that auto-fills upcoming slots from a rotating set
- Queue and calendar views, timezone-aware throughout

**After publishing**
- Engagement metrics per post, snapshotted over time
- Follower growth tracking
- Link tracking: UTM tagging or first-party short links with click counts
- Failure view with retry, which skips targets that already succeeded
- Unified inbox for replies and mentions on supported platforms

**Teams**
- Optional authentication with admin and member roles
- Member posts enter a review queue for admin approval
- Email notification when a scheduled post fails

---

## Supported platforms

| Platform | Publishing | Metrics | Inbox | Setup difficulty |
|---|---|---|---|---|
| Bluesky | ✅ Text, images, video, threads | ✅ | ✅ | Trivial — app password |
| Mastodon | ✅ Text, images, video, threads, polls | ✅ | ✅ | Trivial — access token |
| LinkedIn | ✅ Personal profile | ✅ | — | Easy |
| Threads | ✅ Text, images, video, carousels | ✅ | — | Moderate |
| Instagram | ✅ Images, video (Reels), carousels | ✅ | — | Moderate |
| YouTube | ✅ Video | ✅ | — | Moderate |
| Facebook | ✅ Text, photos, multi-photo, video | ✅ | — | **Hard** |
| TikTok | ⚠️ Upload to drafts only | Partial | — | **Hard** |
| X / Twitter | ❌ Not supported | — | — | API is paid-only |

### Constraints worth knowing before you start

- **TikTok publishes to drafts, not to your profile.** Cadence uploads the video and TikTok sends the creator an in-app notification; they tap it to finish and publish. Fully automated posting requires `video.publish`, a privacy-level picker in the composer (not yet built), and passing TikTok's audit. Until that audit passes, content from unaudited clients is forced to private visibility — so the draft flow is the only one that produces a real public post.
- **YouTube uploads are private** until your Google Cloud project passes a compliance audit. This applies to all API projects created after 28 July 2020.
- **Instagram** requires a Business or Creator account and rejects text-only posts.
- **Facebook** has no API for posting to a personal profile — you need a Page you administer, and the Meta console around Pages is genuinely the hardest setup in this repo. See the troubleshooting section.
- **LinkedIn** organization and Page posting needs a separate app with Community Management API access and is not wired up.

### Composer validation gap

Platform rules are enforced when a post publishes, not while you compose it. So scheduling an Instagram post with no image, or a Facebook post mixing photos and video, currently succeeds at compose time and surfaces in the Failures view later. Moving these checks into the composer is the top open item.

---

## Architecture

```
┌─────────────┐     HTTP      ┌──────────────┐
│  React SPA  │ ────────────► │   FastAPI    │
│   (Vite)    │               │   server     │
└─────────────┘               └──────┬───────┘
                                     │
                       ┌─────────────┼─────────────┐
                       ▼             ▼             ▼
                 ┌──────────┐  ┌──────────┐  ┌──────────┐
                 │  SQLite  │  │  Worker  │  │ Adapters │
                 │  + media │  │  (async) │  │ registry │
                 └──────────┘  └──────────┘  └────┬─────┘
                                                  │
                              ┌───────────────────┼───────────────────┐
                              ▼         ▼         ▼         ▼         ▼
                          bluesky  mastodon   threads  instagram  facebook …
```

**How scheduling works.** A scheduled post is one row in SQLite. An async worker inside the same process wakes on an interval, finds posts whose time has come, resolves each target to a connection, refreshes the OAuth token if needed, applies link tracking and per-platform variants, and calls the adapter. Results are written back and repeating posts spawn their next occurrence.

**This means the process must stay running.** Any host that sleeps on idle breaks scheduling — see the deployment notes.

**The adapter pattern is the spine.** Core code never imports a platform module. Each adapter implements the same interface:

```python
class MyAdapter(Adapter):
    async def publish(self, post: dict) -> dict:      # -> {"ok": True, "ref": str} | {"ok": False, "error": str}
    async def fetch_metrics(self, ref: str) -> dict:  # -> {"likes": int, "reposts": int, "replies": int}
    async def fetch_followers(self) -> int
    async def verify(self) -> str | None              # -> display handle
```

Adapters register in `server/adapters/registry.py` — token-based in `_BUILDERS`, OAuth in `_OAUTH_BUILDERS`. A platform runs against a built-in mock provider until real credentials appear in the environment, so the whole flow is developable without registering anything.

**Tech stack**

| Layer | Choice |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS v4 (`@theme` tokens, no config file) |
| Backend | FastAPI, stdlib `sqlite3`, `httpx` |
| Desktop | Tauri v2 with a PyInstaller sidecar |
| Hosting | Any Docker host with a persistent volume |

**Repository layout**

```
├── server/
│   ├── main.py            # routes, auth gate, scheduling worker
│   ├── db.py              # SQLite access, media storage
│   ├── oauth.py           # OAuth flows, token refresh, per-provider hooks
│   ├── crypto.py          # credential encryption at rest
│   ├── demo.py            # public-demo guards
│   └── adapters/          # one module per platform + registry
├── src/
│   ├── components/        # React views
│   └── core/              # API client, hooks, timezone helpers, shared types
├── src-tauri/             # desktop shell
├── Dockerfile
└── fly.toml
```

---

## Quick start

**Requirements:** Python 3.12+, Node 20+

```bash
git clone https://github.com/YOUR-ORG/cadence.git
cd cadence

cp .env.example server/.env        # then edit it

cd server
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

In a second terminal:

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

With no platform credentials set, every OAuth platform runs against the local mock provider — you can connect fake accounts and exercise scheduling, publishing, and the review workflow end to end.

To connect something real straight away, Bluesky and Mastodon need no app registration:

- **Bluesky** — Settings → Privacy and Security → App Passwords
- **Mastodon** — your instance's Preferences → Development → New Application

---

## Deploying

Cadence needs three things from a host:

1. **A persistent volume** at `DATA_DIR` for the database and media
2. **A public HTTPS URL** — platform OAuth requires it, and Meta platforms fetch your media from it
3. **A process that is never suspended on idle** — the scheduler is a loop, not a database trigger

Free tiers that sleep (Render free, Railway free) will silently stop publishing your posts. Options that work: Fly.io, Oracle Cloud Always Free, a GCP e2-micro, or any VPS running Docker.

### Fly.io

```bash
curl -L https://fly.io/install.sh | sh
fly auth signup
fly launch --no-deploy
fly volumes create cadence_data --size 3 --region <your-region>
```

`fly.toml`:

```toml
app = 'your-app-name'
primary_region = 'sjc'

[build]
  dockerfile = 'Dockerfile'

[env]
  PORT = '8080'
  DATA_DIR = '/data'
  PUBLIC_BASE_URL = 'https://your-domain.com'
  OAUTH_REDIRECT_BASE = 'https://your-domain.com'
  CORS_ORIGINS = 'https://your-domain.com,tauri://localhost,http://tauri.localhost'

[mounts]
  source = 'cadence_data'
  destination = '/data'

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  memory = '512mb'
  cpu_kind = 'shared'
  cpus = 1
```

> **`auto_stop_machines` must stay `false`.** The worker runs inside the app process. If the machine is suspended during idle traffic, scheduled posts don't publish.

```bash
fly secrets set CADENCE_SECRET_KEY=$(openssl rand -hex 32)
fly secrets set CADENCE_AUTH=1
fly deploy
```

Wait for `Application startup complete`, then open the app. The first account you register becomes admin.

**Custom domain:**

```bash
fly certs add cadence.yourdomain.com
fly certs show cadence.yourdomain.com    # prints the DNS records to add
```

Then update `PUBLIC_BASE_URL` and `OAUTH_REDIRECT_BASE` and redeploy.

### Other hosts

Nothing here is Fly-specific beyond `fly.toml`. Any Docker host with a persistent volume works — Oracle Cloud Always Free is a genuinely free option that runs 24/7, at the cost of managing TLS, backups, and monitoring yourself.

---

## Environment variables

See [`.env.example`](.env.example) for the full annotated list. The essentials:

| Variable | Required | Description |
|---|---|---|
| `PUBLIC_BASE_URL` | **Yes** | Public HTTPS base. Platforms fetch media from here |
| `OAUTH_REDIRECT_BASE` | **Yes** | Public HTTPS base for OAuth callbacks. No trailing slash |
| `CORS_ORIGINS` | **Yes** | Comma-separated allowed origins |
| `DATA_DIR` | Production | Persistent volume path |
| `CADENCE_SECRET_KEY` | Strongly recommended | Encrypts credentials at rest. **Set before connecting accounts** |
| `CADENCE_AUTH` | Internet-facing | `1` to require login |
| `CADENCE_DEMO` | — | `1` to run as a public demo with everything mocked |

A platform activates when both `{PLATFORM}_CLIENT_ID` and `{PLATFORM}_CLIENT_SECRET` are set. Until then it uses the mock provider.

---

## Platform setup

Every OAuth platform uses the same callback shape:

```
https://your-domain.com/accounts/{platform}/oauth/callback
```

### Bluesky

Settings → Privacy and Security → App Passwords. Connect with your handle and the generated password.

### Mastodon

Your instance → Preferences → Development → New Application. Scopes `read` and `write`. Connect with the instance URL and access token.

### LinkedIn

1. [linkedin.com/developers](https://www.linkedin.com/developers/) → create an app, associate a Page
2. Products: **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**
3. Auth → add the callback URL
4. Set `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`

### Threads

1. [developers.facebook.com](https://developers.facebook.com) → create an app
2. Add the **Threads API** use case
3. Permissions: `threads_basic`, `threads_content_publish`, `threads_manage_insights`
4. Settings → Redirect Callback URLs → add the callback, **press Enter to commit it**, save, then reload the page to confirm it persisted
5. App roles → add yourself as a **Threads Tester**, and accept from the Threads mobile app under Settings → Website permissions → Invites
6. Set `THREADS_CLIENT_ID` / `THREADS_CLIENT_SECRET` from the **Threads use case settings**, not the general app credentials

### Instagram

Requires a Business or Creator account — convert in the Instagram app under Settings → Account type and tools.

1. Same Meta app → add the **Instagram** use case → **Instagram API with Instagram Login**
2. Permissions: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`
3. Add the callback URL and save
4. App roles → add an **Instagram Tester** → accept at instagram.com → Edit Profile → Apps and Websites → Tester Invites
5. Set `INSTAGRAM_CLIENT_ID` / `INSTAGRAM_CLIENT_SECRET`

### Facebook

Requires a Page you administer.

1. Same Meta app → add **Facebook Login for Business**
2. **Configurations → Create configuration**: General variation, User access token, permissions `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `pages_manage_engagement`, `pages_read_user_content`, `publish_video`
3. Copy the **Configuration ID**
4. **Settings → Client OAuth Settings**: Client OAuth login and Web OAuth login both **on**, and add the callback to **Valid OAuth Redirect URIs**
5. Set `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`, `FACEBOOK_CONFIG_ID`

Connecting creates one Cadence connection per Page you grant. Page tokens derived from a long-lived user token don't expire.

<details>
<summary><b>Troubleshooting Facebook</b> — read this before you start</summary>

Meta's Pages console is the hardest part of this project. In rough order of likelihood:

- **"Feature unavailable"** — Valid OAuth Redirect URIs is empty. It's a chip input: type the URL, press **Enter**, save, then **reload the page** to verify it actually persisted. It will happily display a value it never saved.
- **"App not active"** — the Facebook account you're logging in as has no role on the app. Development mode only permits people with a role, and adding one requires that account to have its own Facebook developer account.
- **"No Facebook Pages found"** — the account you authorized doesn't administer any Page. Verify independently with the [Graph API Explorer](https://developers.facebook.com/tools/explorer): request `pages_show_list`, query `me/accounts`. An empty `data` array means the Page assignment hasn't taken effect, and retrying the connect won't change that.
- **Permissions dropdown is empty** — the app has no Pages capability. Add the "Manage everything on your Page" use case first, then rebuild the configuration.
- **Business portfolio confusion** — a Page belongs to only one portfolio, and portfolio membership is *not* the same as being assigned to the Page. Assign people on the Page itself under Settings → Accounts → Pages → Assign people.

The single most useful habit: after any console change, reload the page before believing it saved.

</details>

### YouTube

1. [console.cloud.google.com](https://console.cloud.google.com) → new project
2. APIs & Services → Library → enable **YouTube Data API v3**
3. Google Auth Platform → **Branding** (app name, authorized domain) → **Audience** (External, add yourself under Test users) → **Data Access** (add `youtube.upload` and `youtube.readonly`)
4. **Clients → Create OAuth client → Web application** → add the callback URL
5. Set `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`

Expect an "unverified app" warning during consent — click through via Advanced. Uploads land as **private** until the compliance audit passes.

### TikTok

1. [developers.tiktok.com](https://developers.tiktok.com) → register → create an app
2. **URL properties** → verify your domain. Mandatory for all apps created after September 2024, and it blocks Content Posting API configuration. Drop the verification file in `public/` — Vite copies it to `dist/`, which is served at the domain root. Verify the **root prefix**, not a sub-path, so one verification covers your ToS, privacy, and callback URLs.
3. Create a **Sandbox** from the left panel. New apps are unapproved, and an unapproved production app can't run OAuth at all — sandbox is the only way to test.
4. Inside the sandbox: add **Login Kit** and **Content Posting API**
5. Login Kit → redirect URI → the callback URL
6. Scopes: `user.info.basic`, `video.upload` (add `user.info.stats` for follower tracking). Only request scopes that are actually granted — requesting an ungranted scope fails the whole authorize request
7. **Sandbox settings → Target users → Add account** — log in as the TikTok account you'll post to
8. Set `TIKTOK_CLIENT_ID` (the portal calls it "Client key") and `TIKTOK_CLIENT_SECRET`

Posts upload to the creator's TikTok drafts and produce an in-app notification. That's the expected result, not a failure.

---

## Desktop app

Cadence ships a Tauri v2 shell bundling the backend as a PyInstaller sidecar, for running entirely on your own machine.

```bash
npm run tauri dev
npm run tauri build
```

Server-side hosting is recommended — the desktop build only publishes while it's running.

---

## Contributing

### Adding a platform

1. Create `server/adapters/yourplatform.py` implementing the `Adapter` interface
2. Register it in `server/adapters/registry.py` and add the id to `PLATFORM_IDS`
3. For OAuth platforms, add an entry to `_REAL` in `server/oauth.py`
4. Add a `PLATFORMS` entry in `src/core/types.js` with label, short code, and character limit
5. Document the console setup in this README

**Verify the API against current documentation before writing the adapter.** Every platform here changed its API in ways that broke assumptions from tutorials less than a year old. Guessing at endpoint shapes has been the single largest source of wasted time in this project.

### Guidelines

- The core never imports a platform module. If you need a special case in `main.py`, the adapter interface probably needs extending instead.
- Adapters return errors rather than raising, and unwrap the platform's own error message. A bare HTTP status is not a diagnosis.
- Don't overclaim. A platform that isn't wired up isn't listed as working.
- Test each publish path separately — text, single image, multi-image, video. They hit different code.

---

## Security

See [SECURITY.md](SECURITY.md) for the full policy and how to report a vulnerability.

The short version: tokens are encrypted at rest and never reach the browser, media is served from unguessable public URLs (so treat uploads as public), and you should set `CADENCE_AUTH=1` on anything internet-facing.

---

## Known limitations

- TikTok publishes to drafts, not directly. Full automation needs the audit plus a composer privacy picker
- YouTube uploads are private until Google's compliance audit passes
- X/Twitter is unsupported — its API is paid-only
- LinkedIn organization and Page posting isn't wired up
- Platform content rules are enforced at publish time, not while composing
- SQLite is single-writer, and the volume binds to one machine — fine for personal and small-team use, but a multi-tenant deployment would want Postgres
- Cadence is single-workspace: all users share posts, connections, and settings

---

## License

MIT. See [LICENSE](LICENSE).

---

<div align="center">

Built by [Velarox Solutions](https://velaroxsolutions.com)

</div>