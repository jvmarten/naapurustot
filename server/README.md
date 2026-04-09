# naapurustot.fi Server

Infrastructure for analytics (Umami) and future backend API, running on a DigitalOcean droplet.

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
# openssl rand -hex 32   (run twice, once for each secret)
nano .env

# 4. Create the persistent database volume (one-time, survives docker compose down -v)
docker volume create postgres_data

# 5. Start services
docker compose up -d

# 6. Check everything is running
docker compose ps
docker compose logs -f
```

## After first start

1. Open `https://analytics.naapurustot.fi` in your browser
2. Log in with the default Umami credentials: `admin` / `umami`
3. **Change the admin password immediately**
4. Add a new website: name `naapurustot.fi`, domain `naapurustot.fi`
5. Copy the Website ID and replace `UMAMI_WEBSITE_ID` in `index.html`

## Custom event tracking

Track feature usage to inform premium feature decisions:

```typescript
// In any React component:
umami.track('export-csv');
umami.track('wizard-complete', { step: 4 });
umami.track('compare-neighborhoods', { count: 3 });
```

## Maintenance

```bash
# View logs
docker compose logs -f umami

# Update images
docker compose pull
docker compose up -d

# Backup database
docker compose exec db pg_dump -U umami umami > backup.sql

# Restore from backup
cat backup.sql | docker compose exec -T db psql -U umami umami
```

> **Warning:** The `postgres_data` volume is marked as `external` to protect it
> from accidental deletion. `docker compose down -v` will NOT remove it. To
> truly delete the database, run `docker volume rm postgres_data` explicitly.
> If the database is ever lost, you will need to re-add the website in Umami
> and update the `data-website-id` in `index.html`.
