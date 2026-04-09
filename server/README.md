# naapurustot.fi Server

Optional backend infrastructure for user accounts, favorites sync, and analytics (Umami), running on a DigitalOcean droplet via Docker Compose.

**The frontend works fully without this server.** User preferences (favorites, notes, filter presets) fall back to localStorage when no server is available.

## Architecture

```
Internet
  │
  ├── analytics.naapurustot.fi → Caddy → Umami (privacy-friendly analytics)
  ├── api.naapurustot.fi → Caddy → Express API (auth + favorites)
  │
  └── PostgreSQL 16 (shared)
      ├── umami database (analytics data)
      └── naapurustot database (users + favorites)
```

## Services

| Service | Port | Purpose |
|---------|------|---------|
| **Caddy** | 80, 443 | Reverse proxy with automatic HTTPS (Let's Encrypt) |
| **API** | 3001 (internal) | Express.js auth server |
| **Umami** | 3000 (internal) | Self-hosted analytics dashboard |
| **PostgreSQL** | 5432 (internal) | Database for both services |

## API endpoints

| Method | Path | Auth | Rate limit | Description |
|--------|------|------|------------|-------------|
| `GET` | `/health` | No | — | Health check |
| `POST` | `/auth/signup` | No | 3/IP/day | Create account (requires Turnstile token) |
| `POST` | `/auth/login` | No | 10/IP/15min | Login (sets httpOnly JWT cookie) |
| `POST` | `/auth/logout` | No | — | Clear auth cookie |
| `GET` | `/auth/me` | Yes | — | Get current user from JWT cookie |
| `GET` | `/auth/favorites` | Yes | — | Get user's favorites list |
| `PUT` | `/auth/favorites` | Yes | — | Replace user's favorites list |

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

# 3. Create .env with secrets
cd /opt/naapurustot
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

# Update images
docker compose pull
docker compose up -d

# Backup databases
docker compose exec db pg_dump -U umami umami > backup-umami.sql
docker compose exec db pg_dump -U naapurustot_api naapurustot > backup-api.sql

# Restore from backup
cat backup-umami.sql | docker compose exec -T db psql -U umami umami
```

> **Warning:** The `postgres_data` volume is marked as `external` to protect it
> from accidental deletion. `docker compose down -v` will NOT remove it. To
> truly delete the database, run `docker volume rm postgres_data` explicitly.
> If the database is ever lost, re-run `seed-umami.sh` to recreate the website
> entry with the correct ID (no need to update `index.html`).
