# naapurustot.fi Server

Optional backend infrastructure for user accounts, user-data sync (favorites, shortlist, notes, preferences), and analytics (Umami), running on a DigitalOcean droplet via Docker Compose.

**The frontend works fully without this server.** User preferences (favorites, notes, filter presets) fall back to localStorage when no server is available.

## Architecture

```
Internet
  │
  ├── analytics.naapurustot.fi → Caddy → Umami (privacy-friendly analytics)
  ├── api.naapurustot.fi → Caddy → Express API (auth + user-data sync)
  │
  └── PostgreSQL 16 (shared)
      ├── umami database (analytics data)
      └── naapurustot database (users + favorites/shortlist/notes/preferences)
```

## Services

| Service | Port | Purpose |
|---------|------|---------|
| **Caddy** | 80, 443 | Reverse proxy with automatic HTTPS (Let's Encrypt) |
| **API** | 3001 (internal) | Express.js auth server |
| **Umami** | 3000 (internal) | Self-hosted analytics dashboard |
| **PostgreSQL** | 5432 (internal) | Database for both services |
| **db-backup** | — | Daily `pg_dump` of both databases into `./backups/` (14-day retention) |

## API endpoints

| Method | Path | Auth | Rate limit | Description |
|--------|------|------|------------|-------------|
| `GET` | `/health` | No | — | Health check |
| `POST` | `/auth/signup` | No | 3/IP/day | Create account (requires Turnstile token) |
| `POST` | `/auth/login` | No | 10/IP/15min | Login (sets httpOnly JWT cookie) |
| `POST` | `/auth/logout` | No | — | Clear auth cookie |
| `POST` | `/auth/forgot-password` | No | 5/IP/hour | Email a reset link. **Always** answers `200 {ok:true}` (see below) |
| `POST` | `/auth/reset-password` | No | 10/IP/hour | Redeem a reset token and set a new password |
| `PATCH` | `/auth/email` | Yes | 10/user/hour | Set/change/clear the account email (requires the current password) |
| `PATCH` | `/auth/password` | Yes | 10/user/hour | Change the password from a signed-in session |
| `GET` | `/auth/me` | Yes | — | Get current user from JWT cookie |
| `GET` | `/auth/export` | Yes | — | Download the full stored record as JSON (GDPR data export) |
| `DELETE` | `/auth/account` | Yes | — | Permanently delete the account and all data (GDPR), then clear the cookie |
| `GET` | `/auth/favorites` | Yes | — | Get user's favorites list |
| `PUT` | `/auth/favorites` | Yes | — | Replace user's favorites list (max 200 entries) |
| `GET` | `/auth/shortlist` | Yes | — | Get user's shortlist |
| `PUT` | `/auth/shortlist` | Yes | — | Replace user's shortlist (max 200 entries) |
| `GET` | `/auth/notes` | Yes | — | Get user's neighborhood notes |
| `PUT` | `/auth/notes` | Yes | — | Replace notes, keyed by 5-digit postal code (max 500 notes × 5000 chars) |
| `GET` | `/auth/preferences` | Yes | — | Get filter presets + quality weights |
| `PUT` | `/auth/preferences` | Yes | — | Update filter presets and/or quality weights (partial update — omitted field keeps its value) |

"Auth: Yes" means the request must carry the httpOnly JWT cookie set by login/signup.

### GDPR data export & deletion (CF-13)

These two endpoints let a logged-in user exercise their right to data
portability and erasure directly from the account menu:

- **`GET /auth/export`** returns a single JSON document containing the account
  row (id, username, email, display name, trust level, timestamps) plus the
  user's favorites, shortlist, notes, filter presets and quality weights. The
  response sets `Content-Disposition: attachment; filename="naapurustot-data.json"`.
  It reports exactly what the API stores — nothing more.
- **`DELETE /auth/account`** requires a JSON body `{ "confirm": "DELETE" }` and
  permanently deletes the `users` row. The `ON DELETE CASCADE` foreign keys on
  `user_favorites`, `user_shortlist`, `user_notes` and `user_preferences` remove
  every dependent row, so no orphaned personal data remains. The auth cookie is
  cleared on success. Deletion is irreversible (recoverable only from a prior
  `pg_dump` backup, which ages out per `BACKUP_RETENTION_DAYS`).

> **Owner review:** the in-app copy points users to delete/export their own
> data; there is no separate privacy-contact address baked into the app. If a
> data-protection contact is required, add it via the project's existing
> channels rather than hard-coding a personal email.

### Password reset

`POST /auth/forgot-password` **always** responds `200 {"ok": true}` — for an
unknown address, a malformed address, and a real one alike — and does so
*before* the lookup and the mail send. Anything else (a different status, a
different body, or simply a slower response when the address matched) would turn
the endpoint into an oracle for "does this person have an account here?". Treat
that invariant as load-bearing: it is the same account-enumeration defence the
login route buys with its `DUMMY_HASH` bcrypt compare.

Tokens are 32 random bytes, stored **only** as a SHA-256 hash in
`password_reset_tokens`, valid for one hour and single-use. Requesting a new link
retires any outstanding one. Redemption is a single conditional
`UPDATE … WHERE used_at IS NULL AND expires_at > NOW() RETURNING user_id`, so two
requests racing with the same token cannot both succeed.

A completed reset increments `users.token_version`. Session JWTs carry the
matching `tv` claim and `resolveUser` rejects a stale generation, so **resetting
a password ends every other session** — without this a stolen 7-day cookie would
outlive the reset that was meant to revoke it. Tokens issued before this shipped
have no `tv` claim and are read as generation 0 (the column default), so
deploying it does not sign existing users out.

Reset mail goes out through Resend from a DKIM-verified `naapurustot.fi` (EU
`eu-west-1` return path), with `Reply-To: info@naapurustot.fi` — the address
Cloudflare Email Routing forwards to a real inbox. With `RESEND_API_KEY` unset
the mailer no-ops: nothing is sent, nothing throws, and every other endpoint is
unaffected.

### Changing a password while signed in

`PATCH /auth/password` takes the current password and a new one. It bumps
`token_version` like a reset does — so every OTHER session dies — but unlike the
reset it **re-issues the caller's own cookie** against the new generation.
Otherwise you would change your password and be logged straight out of the tab
you did it in. The reset path deliberately issues nothing: redeeming a mailed
token proves control of a mailbox, not knowledge of the account.

It also **rejects reuse** of the current password, which `/auth/reset-password`
does not. The asymmetry is intentional: people reset because they forgot, and a
fair number remember partway through, so refusing there is friction on the common
case against a threat that barely applies (a stolen *cookie* never revealed the
password, and the `token_version` bump already killed it). Someone deliberately
rotating has no such excuse, and accepting a no-op would report a rotation that
did not happen.

Both `PATCH` routes share a `credential` limiter — 10 attempts per hour, keyed on
userId — because both verify the current password, and a stolen session that
brute-forces it escalates into a permanently owned account.

Because email is **optional** at signup, an account with no address on file
cannot be recovered. `PATCH /auth/email` (which requires the current password —
a stolen session must not be able to redirect the reset channel) lets users add
one later. To see how many accounts are currently unrecoverable:

```bash
docker compose exec -T db psql -U naapurustot_api -d naapurustot \
  -c "SELECT count(*) total, count(email) with_email FROM users;"
```

## Prerequisites

- Ubuntu 24.04 droplet with Docker installed
- DNS A records pointing to the droplet:
  - `analytics.naapurustot.fi`
  - `api.naapurustot.fi`
- Firewall allowing ports 22, 80, 443

## Setup

```bash
# 1. Clone this repo (or just copy the server/ directory)
scp -r server/ root@YOUR_DROPLET_IP:/opt/naapurustot/

# 2. SSH into the droplet
ssh root@YOUR_DROPLET_IP

# 3. Create .env with secrets (the scp above put everything in /opt/naapurustot/server)
cd /opt/naapurustot/server
cp .env.example .env
# Generate and fill in the values:
# openssl rand -hex 32   (run for each secret)
nano .env

# 4. Create the persistent database volume (one-time, survives docker compose down -v)
docker volume create postgres_data

# 5. Start services
docker compose up -d

# 6. Check everything is running
docker compose ps
docker compose logs -f
```

## Environment variables (`server/.env`)

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | PostgreSQL password for the Umami database user |
| `APP_SECRET` | Umami application secret (for session signing) |
| `API_DB_PASSWORD` | PostgreSQL password for the API database user |
| `JWT_SECRET` | Secret for signing JWT auth tokens (must be set in production) |
| `TURNSTILE_SECRET` | Cloudflare Turnstile secret key (skip in dev to disable bot check) |
| `TURNSTILE_ALLOWED_HOSTNAMES` | Optional — comma-separated hostnames a Turnstile token must have been solved on (e.g. `naapurustot.fi,www.naapurustot.fi`); empty disables the check |
| `RESEND_API_KEY` | Optional — Resend "Sending access" key for password-reset mail; empty disables sending (the endpoint still answers 200). **Not** the `gmail-smtp` key — that one is Gmail's "Send mail as" SMTP password for info@naapurustot.fi |
| `MAIL_FROM` | From address for reset mail (default `noreply@naapurustot.fi`); must be on a Resend-verified domain |
| `APP_BASE_URL` | Origin used to build reset links (default `https://naapurustot.fi`); must match the deployed frontend |
| `SENTRY_DSN` | Optional — Sentry error tracking for the API; empty disables Sentry entirely |
| `SENTRY_RELEASE` | Optional — release identifier attached to Sentry events |
| `BACKUP_RETENTION_DAYS` | Optional — days of pg_dumps to keep in `./backups/` (default: 14) |

Generate secrets with: `openssl rand -hex 32`

## After first start

1. Open `https://analytics.naapurustot.fi` in your browser
2. Log in with the default Umami credentials: `admin` / `umami`
3. **Change the admin password immediately**
4. Seed the website entry (matches the ID already in `index.html`):
   ```bash
   docker compose cp seed-umami.sh db:/seed-umami.sh
   docker compose exec db bash /seed-umami.sh
   ```
   This is safe to re-run — it skips if the website already exists.

## Custom event tracking

Track feature usage from the frontend via the Umami script:

```typescript
// In any React component (uses src/utils/analytics.ts wrapper):
import { trackEvent } from '../utils/analytics';
trackEvent('export-csv');
trackEvent('wizard-complete', { step: 4 });
trackEvent('compare-neighborhoods', { count: 3 });
```

## Maintenance

```bash
# View logs
docker compose logs -f umami
docker compose logs -f api
docker compose logs -f db-backup     # nightly backup status

# Update images
docker compose pull
docker compose up -d

# Ad-hoc backup (the db-backup container also runs this nightly)
docker compose exec db pg_dump -U umami umami > backup-umami.sql
docker compose exec db pg_dump -U naapurustot_api naapurustot > backup-api.sql
```

## Backups

The `db-backup` sidecar container runs `pg_dump` for both databases once a
day, writes gzip'd dumps to `server/backups/` on the host, and deletes
anything older than `BACKUP_RETENTION_DAYS` (default 14). Because the dumps
live on the host filesystem, DigitalOcean droplet snapshots include them
automatically — so even between weekly snapshots you have a daily restore
point on disk.

```bash
# List available backups
ls -lh /opt/naapurustot/server/backups/

# Verify the latest dumps are recent
ls -t /opt/naapurustot/server/backups/umami-*.sql.gz | head -1
ls -t /opt/naapurustot/server/backups/naapurustot-*.sql.gz | head -1
```

> **Off-droplet copy (recommended):** the `backups/` directory only protects
> against in-container DB corruption — if the droplet itself is lost between
> DO snapshots, those backups go with it. Consider periodically `scp`-ing
> recent dumps off the droplet, or syncing them to object storage.

## Recovery

### Restoring from a `pg_dump` backup (most common)

If the Umami database is empty or corrupted but the host's `backups/`
directory is intact:

Use `restore.sh`. It stops the consumers, takes a safety dump of the current
state, recreates the database **with the correct owner**, restores with
`ON_ERROR_STOP=1`, and refuses to declare success unless the restored data is
actually present.

```bash
cd /opt/naapurustot/server

./restore.sh naapurustot          # newest backups/naapurustot-*.sql.gz
./restore.sh umami                # newest backups/umami-*.sql.gz
./restore.sh naapurustot backups/naapurustot-20260727-030000.sql.gz  # a specific dump
```

> **Do not hand-roll the drop/create.** The previous version of this runbook ran
> `CREATE DATABASE naapurustot;` as the bootstrap superuser and then piped the
> dump in as `naapurustot_api`. Since PostgreSQL 15 the `public` schema is owned
> by `pg_database_owner` and `PUBLIC` has no `CREATE` on it, so every
> `CREATE TABLE` failed with `permission denied for schema public` — and without
> `ON_ERROR_STOP=1`, `psql` exited 0 anyway. The result was a silently **empty**
> database, during an outage, with the operator reasonably concluding the backups
> were bad. `restore.sh` creates the database with `OWNER naapurustot_api` and
> asserts a non-zero row count before finishing.

Check afterwards:

```bash
docker compose ps
curl -sf https://api.naapurustot.fi/health
```

### When no backup exists ("Websites: No data available")

Historical sessions/pageviews are unrecoverable in this case. You can still
restore the *website entry* so new analytics start flowing again with the
existing tracking ID baked into `index.html`:

```bash
docker compose cp seed-umami.sh db:/seed-umami.sh
docker compose exec db bash /seed-umami.sh
```

This is idempotent (`ON CONFLICT DO NOTHING`) and is also re-run on every
deploy by `.github/workflows/deploy-server.yml`, so the entry will always
re-appear after a fresh DB.

### Checking whether the old volume still exists

If the database appears empty but you suspect the data is sitting in an
orphaned volume (e.g. left over from before `postgres_data` was marked
`external`), check:

```bash
docker volume ls | grep postgres
# Look for *_postgres_data alongside postgres_data. If you find one,
# inspect it before deleting:
docker run --rm -v server_postgres_data:/old alpine ls -la /old
```

> **Warning:** The `postgres_data` volume is marked as `external` to protect it
> from accidental deletion. `docker compose down -v` will NOT remove it. To
> truly delete the database, run `docker volume rm postgres_data` explicitly.
> If the database is ever lost, re-run `seed-umami.sh` to recreate the website
> entry with the correct ID (no need to update `index.html`).
