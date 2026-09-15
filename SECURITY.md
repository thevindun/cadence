# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Email the maintainer directly, or use GitHub's private vulnerability reporting under the Security tab. Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a response within a few days.

## How Cadence handles credentials

**Platform tokens** are encrypted at rest using `CADENCE_SECRET_KEY` and stored in the SQLite database. They are never sent to the browser — all publishing happens server-side.

**Set `CADENCE_SECRET_KEY` before connecting any account.** Rotating it later makes every stored token unreadable, and you'll have to reconnect everything.

**Passwords** are salted and hashed. Sessions are bearer tokens with a 30-day expiry, pruned at startup.

## Things to know before you deploy

**Media is served from unauthenticated URLs.** `GET /media/{id}` is deliberately outside the auth gate, because Instagram, Threads, Facebook, and Pinterest fetch your images and video directly from your server rather than accepting an upload. The IDs are 32 random hex characters, so they're unguessable — but treat anything you upload as effectively public.

**Enable authentication on any internet-facing deployment.** Set `CADENCE_AUTH=1`. Without it, anyone who finds your URL has full access to your connected accounts.

**Registration closes after the first user.** The first account created becomes admin; everyone else must be added by that admin. This is intentional — don't work around it on a public deployment.

**SQLite has no network surface**, which is a security benefit. Keep it that way; don't expose the volume.

## If you're self-hosting

- Never commit `.env`, `*.db`, or anything under `server/media/`
- Use your host's secret management (`fly secrets set`, or equivalent) rather than environment files in the image
- Put the app behind HTTPS — platform OAuth requires it anyway
- Restrict `CORS_ORIGINS` to your actual domain
- Back up the volume; it holds credentials and all your scheduled content

## If you fork this repo

Every platform integration needs **your own** developer app — your own client IDs, secrets, and redirect URIs. Credentials are not shareable across deployments, and the setup instructions in the README walk through registering each one.

## Scope

In scope: authentication bypass, credential exposure, injection, privilege escalation between admin and member roles, and anything that lets one deployment affect another.

Out of scope: issues requiring physical access to the server, social engineering, and vulnerabilities in third-party platform APIs themselves.
