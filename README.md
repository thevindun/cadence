<div align="center">

# Cadence

**Post on repeat, never miss a beat.**

A free, self-hosted social media scheduler. Write once, publish everywhere, and get your real engagement numbers back.

[Features](#features) · [Platforms](#supported-platforms) · [Quick start](#quick-start) · [Deploy](#deploying-to-flyio) · [Platform setup](#platform-setup) · [Architecture](#architecture)

</div>

---

## What Cadence is

Cadence is a content scheduler you run yourself. You compose a post once, pick which connected accounts should receive it, and a server-side worker publishes on schedule — whether or not the app is open. It then pulls engagement and follower metrics back so you can see what actually worked.

It exists because the hosted alternatives charge monthly for features that amount to a cron job and a handful of API calls. Cadence is free, the data is yours, and the credentials never leave your server.

**Design principles**

- **Your tokens, your machine.** Access tokens are stored encrypted at rest on your own server and are never exposed to the browser.
- **Publishing is server-side.** Close the laptop. Posts still go out.
- **The core knows nothing about platforms.** Every integration is an adapter behind one interface, so adding a platform never means touching the scheduler.
- **No overclaiming.** If a platform isn't wired up, the UI says so.

---

## Features

**Composing**
- Multi-account targeting — connect several accounts per platform, each publishes independently
- Per-platform text variants, with a shared base caption as the fallback
- Threads and chains (Bluesky, Mastodon), first comments, Mastodon polls
- Image and video upload with alt text, plus a reusable media library
- Templates, hashtag groups, and categories
- Live per-platform preview and character counting against the strictest selected limit
- Optional AI caption assistance

**Scheduling**
- One-off or recurring posts (daily, weekly, monthly)
- Posting slots and a "next open slot" shortcut
- Evergreen pool that auto-fills upcoming slots from a rotating set of posts
- Queue and calendar views
- Timezone-aware throughout

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

| Platform | Publishing | Metrics | Inbox | Notes |
|---|---|---|---|---|
| Bluesky | ✅ Text, images, video, threads | ✅ | ✅ | App password, no OAuth app needed |
| Mastodon | ✅ Text, images, video, threads, polls | ✅ | ✅ | Access token, no OAuth app needed |
| Threads | ✅ Text, images, video, carousels | ✅ | — | Meta app required |
| LinkedIn | ✅ Personal profile | ✅ | — | Org/Page posting not supported |
| Instagram | ✅ Images, video (Reels), carousels | ✅ | — | Professional account required; no text-only posts |
| Facebook | ✅ Text, photos, multi-photo, video | ✅ | — | Pages only; no personal profile API |
| YouTube | ✅ Video | ✅ | — | Uploads are private until Google's compliance audit |
| TikTok | ❌ Not implemented | — | — | — |
| X / Twitter | ❌ Not supported | — | — | API is paid-only |

**Worth knowing before you start**

- **YouTube** restricts uploads from unaudited API projects to private visibility. This is Google policy, not a Cadence limitation. Public posting requires passing their compliance audit.
- **Instagram** requires a Business or Creator account and rejects text-only posts.
- **Facebook** has no API for posting to a personal profile. You need a Page you administer.
- **LinkedIn** organization posting needs a separate app with Community Management API access and is not currently wired up.

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

**The adapter pattern is the spine.** Core code never imports a platform module. Each adapter implements the same interface:

```python
class MyAdapter(Adapter):
    async def publish(self, post: dict) -> dict:      # -> {"ok": bool, "ref": str} | {"ok": False, "error": str}
    async def fetch_metrics(self, ref: str) -> dict:  # -> {"likes": int, "reposts": int, "replies": int}
    async def fetch_followers(self) -> int
    async def verify(self) -> str | None              # -> display handle
```

Adapters are registered in `server/adapters/registry.py` — token-based ones in `_BUILDERS`, OAuth ones in `_OAUTH_BUILDERS`. A platform runs against a built-in mock provider until real credentials appear in the environment, so you can develop the whole flow without registering anything.

**Tech stack**

| Layer | Choice |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS v4 (`@theme` tokens, no config file) |
| Backend | FastAPI, stdlib `sqlite3`, `httpx` |
| Desktop | Tauri v2 with a PyInstaller sidecar |
| Hosting | Fly.io (any Docker host works) |

**Repository layout**

```
├── server/
│   ├── main.py            # routes, auth gate, scheduling worker
│   ├── db.py              # SQLite access, media storage
│   ├── oauth.py           # OAuth flows, token refresh, per-provider hooks
│   ├── crypto.py          # credential encryption at rest
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
git clone https://github.com/<your-org>/cadence.git
cd cadence

# backend
cd server
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# frontend, in a second terminal
npm install
npm run dev
```

Open `http://localhost:5173`.

With no platform credentials configured, every OAuth platform runs against the local mock provider — you can connect fake accounts and exercise scheduling, publishing, and the review workflow end to end.

To connect something real immediately, Bluesky and Mastodon need no app registration:

- **Bluesky** — Settings → Privacy and Security → App Passwords. Paste your handle and the generated password.
- **Mastodon** — your instance's Preferences → Development → New Application. Paste the instance URL and access token.

---

## Deploying to Fly.io

Cadence is built to run as a single always-on machine with a persistent volume. The whole thing fits comfortably in Fly's smallest paid tier.

### 1. Install and sign in

```bash
curl -L https://fly.io/install.sh | sh      # Windows: iwr https://fly.io/install.ps1 -useb | iex
fly auth signup                              # or: fly auth login
```

### 2. Create the app

```bash
fly launch --no-deploy
```

Pick a name and a region near you. Decline the offers to add Postgres or Redis — Cadence uses SQLite on a volume.

### 3. Create the volume

Credentials and the database live here and must survive restarts.

```bash
fly volumes create cadence_data --size 3 --region <your-region>
```

### 4. Configure `fly.toml`

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
  memory = '1gb'
  cpu_kind = 'shared'
  cpus = 1
```

> **`auto_stop_machines` must stay `false`.** The scheduling worker runs inside the app process. If Fly suspends the machine during idle traffic, scheduled posts don't publish.

### 5. Set secrets

```bash
fly secrets set CADENCE_SECRET_KEY=$(openssl rand -hex 32)
fly secrets set CADENCE_AUTH=1
```

`CADENCE_SECRET_KEY` encrypts stored credentials at rest. **Set it before connecting any account** — rotating it later invalidates every stored token. `CADENCE_AUTH=1` turns on login; leave it unset for a single-user private deployment.

### 6. Deploy

```bash
fly deploy
fly logs
```

Wait for `Application startup complete`, then open your app. The first account you register becomes the admin.

### 7. Custom domain (optional but recommended)

Platform OAuth generally requires HTTPS on a real domain.

```bash
fly certs add cadence.yourdomain.com
fly certs show cadence.yourdomain.com      # prints the DNS records to add
```

Add the CNAME/A records at your DNS provider, then update `PUBLIC_BASE_URL` and `OAUTH_REDIRECT_BASE` in `fly.toml` and redeploy.

### Deploying elsewhere

Nothing here is Fly-specific beyond `fly.toml`. Any host that runs the Dockerfile with a persistent volume at `DATA_DIR` works — Railway, Render, Hetzner, a VPS with Docker Compose. You need: a persistent disk, a public HTTPS URL, and a process that isn't suspended when idle.

---

## Environment variables

### Core

| Variable | Required | Description |
|---|---|---|
| `PORT` | — | HTTP port. Default `8000` |
| `DATA_DIR` | — | Where the database and media live. Default is alongside the server |
| `PUBLIC_BASE_URL` | **Yes** | Public HTTPS base. Used for tracked links and for platform media fetching |
| `OAUTH_REDIRECT_BASE` | **Yes** | Public HTTPS base for OAuth callbacks. No trailing slash |
| `CORS_ORIGINS` | **Yes** | Comma-separated allowed origins |
| `CADENCE_SECRET_KEY` | Recommended | Encrypts credentials at rest. Set before connecting accounts |
| `CADENCE_AUTH` | — | Set to `1` to require login |

> `PUBLIC_BASE_URL` matters more than it looks. Meta platforms fetch your images and video from a public URL rather than accepting an upload, so media publishing fails on `localhost`.

### Platform credentials

A platform switches from the mock provider to the real one the moment its `CLIENT_ID` and `CLIENT_SECRET` are both present. Leave them unset to keep developing against the mock.

| Variable | Platform |
|---|---|
| `THREADS_CLIENT_ID` / `THREADS_CLIENT_SECRET` | Threads |
| `INSTAGRAM_CLIENT_ID` / `INSTAGRAM_CLIENT_SECRET` | Instagram |
| `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` / `FACEBOOK_CONFIG_ID` | Facebook |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | YouTube |

### Optional

| Variable | Description |
|---|---|
| `FACEBOOK_API_VERSION` | Graph API version. Default `v25.0` |
| `INSTAGRAM_API_VERSION` | Graph API version. Default `v25.0` |
| `YOUTUBE_PRIVACY` | `public`, `private`, or `unlisted`. Default `public` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `NOTIFY_EMAIL` | Failure notification email |

---

## Platform setup

Every OAuth platform uses the same callback shape:

```
https://your-domain.com/accounts/{platform}/oauth/callback
```

### Bluesky

Settings → Privacy and Security → App Passwords. Connect with your handle and the app password. No developer account needed.

### Mastodon

Your instance → Preferences → Development → New Application. Scopes: `read`, `write`. Connect with the instance URL and access token.

### Threads

1. [developers.facebook.com](https://developers.facebook.com) → create an app
2. Add the **Threads API** use case
3. Permissions: `threads_basic`, `threads_content_publish`, `threads_manage_insights`
4. Settings → Redirect Callback URLs → add the callback, **press Enter to commit it**, save, then reload the page to confirm it persisted
5. App roles → add yourself as a **Threads Tester**, and accept from the Threads mobile app under Settings → Website permissions → Invites
6. Set `THREADS_CLIENT_ID` and `THREADS_CLIENT_SECRET` from the **Threads use case settings**, not the general app credentials

### Instagram

Requires a Business or Creator account. Convert in the Instagram app under Settings → Account type and tools.

1. Same Meta app → add the **Instagram** use case → choose **Instagram API with Instagram Login**
2. Permissions: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`
3. Add the callback URL and save
4. App roles → add an **Instagram Tester** → accept at instagram.com → Edit Profile → Apps and Websites → Tester Invites
5. Set `INSTAGRAM_CLIENT_ID` / `INSTAGRAM_CLIENT_SECRET`

### Facebook

Requires a Page you administer. Personal profiles have no posting API.

1. Same Meta app → add **Facebook Login for Business**
2. **Configurations → Create configuration**: General login variation, User access token, and these permissions — `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `pages_manage_engagement`, `pages_read_user_content`, `publish_video`
3. Copy the **Configuration ID**
4. **Settings → Client OAuth Settings**: Client OAuth login and Web OAuth login both **on**, and add the callback to **Valid OAuth Redirect URIs**
5. Set `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`, and `FACEBOOK_CONFIG_ID`

Connecting creates one Cadence connection per Page you grant access to. Page tokens derived from a long-lived user token don't expire.

<details>
<summary><b>Troubleshooting Facebook</b></summary>

Meta's console is the hardest part of this project. In rough order of likelihood:

- **"Feature unavailable"** — Valid OAuth Redirect URIs is empty. The field is a chip input: type the URL, press **Enter**, save, then reload the page to verify it actually persisted.
- **"App not active"** — the Facebook account you're logging in as has no role on the app. Development mode only permits people with a role.
- **"No Facebook Pages found"** — the account you authorized as doesn't administer any Page. Verify independently with the [Graph API Explorer](https://developers.facebook.com/tools/explorer): request `pages_show_list`, then query `me/accounts`. An empty `data` array means the Page assignment hasn't taken effect, and no amount of retrying the connect will change that.
- **Permissions dropdown is empty** — the app has no Pages capability. Add the "Manage everything on your Page" use case first, then rebuild the configuration.
- **Business portfolio confusion** — a Page can belong to only one portfolio, and portfolio membership is not the same as being assigned to the Page. Assign people on the Page itself, under Settings → Accounts → Pages.

</details>

### YouTube

1. [console.cloud.google.com](https://console.cloud.google.com) → new project
2. APIs & Services → Library → enable **YouTube Data API v3**
3. Google Auth Platform → **Branding** (app name, authorized domain) → **Audience** (External, and add yourself under Test users) → **Data Access** (add `youtube.upload` and `youtube.readonly`)
4. **Clients → Create OAuth client → Web application** → add the callback URL
5. Set `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`

Expect an "unverified app" warning during consent — click through via Advanced. Uploads land as **private** until your project passes Google's compliance audit.

### LinkedIn

1. [linkedin.com/developers](https://www.linkedin.com/developers/) → create an app, associate a Page
2. Products: **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**
3. Auth → add the callback URL
4. Set `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`

---

## Desktop app

Cadence ships a Tauri v2 shell that bundles the backend as a PyInstaller sidecar, for running entirely on your own machine with no server.

```bash
npm run tauri dev      # development
npm run tauri build    # produces a platform installer
```

Server-side scheduling is the recommended setup — the desktop build only publishes while it's running.

---

## Contributing

### Adding a platform

1. Create `server/adapters/yourplatform.py` implementing the `Adapter` interface
2. Register it in `server/adapters/registry.py` and add the id to `PLATFORM_IDS`
3. For OAuth platforms, add an entry to `_REAL` in `server/oauth.py`
4. Add a `PLATFORMS` entry in `src/core/types.js` with the label, short code, and character limit
5. Document the console setup in this README

**Verify the API against current documentation before writing the adapter.** Every platform in this repo changed its API in ways that broke assumptions from tutorials less than a year old. Guessing at endpoint shapes has been the single largest source of wasted time in this project.

### Guidelines

- The core never imports a platform module. If you need a special case in `main.py`, the adapter interface probably needs extending instead.
- Adapters return errors rather than raising. Unwrap the platform's error message — a bare HTTP status is not a diagnosis.
- Don't overclaim in the UI. A platform that isn't wired up says "Coming soon" or isn't listed.
- Test each publish path separately: text, single image, multi-image, video. They hit different code.

---

## Security

- Credentials are encrypted at rest with `CADENCE_SECRET_KEY` and never sent to the browser.
- Media is served from unguessable UUID paths, which is what lets platform servers fetch it without authentication. Treat anything you upload as effectively public.
- Enable `CADENCE_AUTH=1` on any deployment reachable from the internet.
- Never commit `.env` or app secrets. Use `fly secrets set` or your host's equivalent.

Found a vulnerability? Please report it privately rather than opening a public issue.

---

## Known limitations

- TikTok is not implemented
- X/Twitter is not supported — its API is paid-only
- LinkedIn organization and Page posting is not wired up
- YouTube uploads are private until Google's compliance audit passes
- Instagram rejects text-only posts; YouTube requires a video; Facebook can't mix photos and video in one post. These are enforced at publish time rather than while composing, so invalid combinations currently surface in the Failures view.
- SQLite is single-writer. Fine for personal and small-team use; a multi-tenant deployment would want Postgres.

---

## License

MIT. See [LICENSE](LICENSE).

---

<div align="center">

Built by [Velarox Solutions](https://velaroxsolutions.com)

</div>