# Server migration: DigitalOcean → Hetzner (Helsinki)

Moves the backend (Caddy, API, Umami, PostgreSQL, backup sidecar) from the DigitalOcean
droplet to a Hetzner Cloud server in Helsinki, then optionally (phase 2) serves the static
site from that server with GitHub Pages kept as a standby. The map stays on GitHub Pages
throughout phase 1; only accounts, sync and analytics go offline, for roughly 15–30 minutes
during the cutover. Step 8 moves the droplet's other tenant, the `vakiosulkapollbot` Telegram
bot, so the droplet can be destroyed afterwards.

This runbook is written to be executed **on the new server**, either by the operator or by
Claude Code running there. Every step says who does it:

- **Operator** — anything behind a web login (Hetzner, Cloudflare, GitHub, DigitalOcean,
  Stripe, Umami) and every go/no-go decision.
- **Claude** — terminal work on the new server, and on the droplet over SSH.

`OLD` is the droplet's IP and `NEW` is the Hetzner server's IP; the operator gives both at
the start. Commands run on `NEW` from `/opt/naapurustot/server` unless marked otherwise.

## Rules for Claude running this runbook

1. **One step at a time.** Finish a step, report what happened against the step's expected
   result, and wait for the operator's go before starting the next one.
2. **`CONFIRM` means ask first.** Commands marked `CONFIRM` stop production or replace data.
   Show the exact command and wait for an explicit yes.
3. **Touch the droplet only with the commands written here.** Never run `docker compose
   down`, never remove a Docker volume, never delete files on `OLD`. The droplet is the
   rollback until the operator destroys it.
4. **Never print secrets.** Copy `server/.env`; don't `cat` it. Verify a copy by checksum.
5. **Don't edit tracked files in `/opt/naapurustot`.** The deploy workflow runs `git pull`
   there, and a local edit makes it fail. Changes go through the repo, never from this server.
6. **Web consoles are the operator's.** If a step needs Hetzner, Cloudflare, GitHub or
   DigitalOcean, ask for it; don't look for a way around it.
7. **Off-script output means stop.** If a result differs from what the step expects, report
   it and wait. Don't improvise a fix on production.
8. **No `-f` on logs.** Use `docker compose logs --since 5m <service>` and poll; a followed
   log never returns.

## 0. Bootstrap — Operator

1. **Create the server** in the Hetzner Cloud console: location Helsinki, Ubuntu 24.04,
   shared vCPU x86 with at least the droplet's RAM (4 GB is comfortable), your SSH key,
   backups on, and a firewall allowing inbound TCP 22, 80, 443 and UDP 443 (Caddy serves
   HTTP/3). Leave 22 open to all addresses: the GitHub Actions deploy connects from changing IPs.
2. **Update, reboot, clone the repo and start Claude**, from your computer:

   ```bash
   ssh root@NEW
   apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -y upgrade
   reboot                         # then ssh root@NEW again
   git clone https://github.com/jvmarten/naapurustot.git /opt/naapurustot
   curl -fsSL https://claude.ai/install.sh | bash
   tmux new -s claude             # keeps the session alive if SSH drops
   cd /opt/naapurustot
   claude                         # log in once, then exit
   claude remote-control          # the session appears in the Claude app
   ```

   Keep the session in the default permission mode, so every command waits for approval.
3. **Start it** with: "Follow docs/SERVER_MIGRATION.md. OLD is `<ip>`, NEW is `<ip>`.
   Start at step 1."

## 1. SSH from NEW to the droplet — Claude, then Operator

Claude creates a key for this migration and prints its public half:

```bash
ssh-keygen -t ed25519 -N '' -C 'naapurustot-migration' -f /root/.ssh/id_ed25519
cat /root/.ssh/id_ed25519.pub
```

Operator, from your computer, adds it to the droplet:

```bash
ssh root@NEW 'cat /root/.ssh/id_ed25519.pub' | ssh root@OLD 'cat >> /root/.ssh/authorized_keys'
```

Claude checks the connection and records the droplet's state:

```bash
ssh -o StrictHostKeyChecking=accept-new root@OLD 'hostname && free -h && df -h /'
ssh root@OLD 'cd /opt/naapurustot/server && docker compose ps && ls -lh backups/ | tail -5 && cat backups/status.json'
```

Expected: all five services up on `OLD`, and `status.json` showing `"umami_ok":1` and
`"naapurustot_ok":1` from the last 24 hours. Report the droplet's RAM so the operator can
check the new server is at least as big.

Then take an inventory of everything else on the droplet, so nothing is left behind when it
is destroyed:

```bash
ssh root@OLD 'docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"; crontab -l; ls -la /root; systemctl list-units --type=service --state=running --no-pager'
```

Expected: naapurustot's five containers plus `vakiosulkapollbot` and `warp` (step 8). The
bot's own deploy guide also lists a `drawbot` on port 80, which cannot be running while Caddy
holds that port. Report anything beyond the expected list, and any crontab entries, to the
operator before going further.

## 2. Prepare NEW — Claude

```bash
curl -fsSL https://get.docker.com | sh
docker compose version                     # expect v2.x
docker volume create postgres_data
mkdir -p /opt/naapurustot/server/backups
cd /opt/naapurustot/server
scp root@OLD:/opt/naapurustot/server/.env .env
chmod 600 .env
md5sum .env && ssh root@OLD 'md5sum /opt/naapurustot/server/.env'    # must match
ssh root@OLD 'cat /root/.ssh/authorized_keys' >> /root/.ssh/authorized_keys
docker compose build api
docker compose pull caddy umami db
```

The `authorized_keys` line carries over the public half of the `DEPLOY_SSH_KEY` GitHub
secret, so the deploy workflow can log in here with the key it already has.

Expected: matching checksums, a built `api` image, pulled images. Nothing is started yet.

## 3. Rehearse the restore — Claude (no downtime)

Restores last night's dumps while the droplet keeps serving everyone. This proves the
backups restore before anything is offline.

```bash
cd /opt/naapurustot/server
ssh root@OLD 'cd /opt/naapurustot/server && ls -t backups/naapurustot-*.sql.gz | head -1 && ls -t backups/umami-*.sql.gz | head -1'
scp root@OLD:/opt/naapurustot/server/backups/naapurustot-YYYYMMDD-HHMMSS.sql.gz backups/
scp root@OLD:/opt/naapurustot/server/backups/umami-YYYYMMDD-HHMMSS.sql.gz backups/
docker compose up -d db api umami
./restore.sh naapurustot backups/naapurustot-YYYYMMDD-HHMMSS.sql.gz
./restore.sh umami backups/umami-YYYYMMDD-HHMMSS.sql.gz
docker compose exec -T api wget -q -O - http://localhost:3001/health
ssh root@OLD "cd /opt/naapurustot/server && docker compose exec -T db psql -tAX -U naapurustot_api -d naapurustot -c 'SELECT count(*) FROM users;'"
```

- **Name the dump files explicitly.** Copied files get a new modification time, so
  `restore.sh`'s "newest" default can pick the wrong one.
- **Do not start Caddy.** DNS still points at the droplet; failed certificate requests can
  hit Let's Encrypt's rate limit right before the cutover needs a certificate.

Expected: each restore prints a non-zero row count, `/health` answers, and the `users` count
on `NEW` is at most a few below the droplet's (the dump is from last night).

## 4. Cutover — Operator, then Claude (`CONFIRM`)

Accounts, sync and analytics are offline from here until step 5's DNS change has spread.

Operator first:

1. Pick a quiet hour.
2. In GitHub, Actions → Deploy Server → ··· → **Disable workflow**. Otherwise a merge touching
   `server/` restarts the droplet's API and takes writes after the final dump.
3. Tell Claude to go.

Claude:

```bash
# CONFIRM — stops writes on the droplet; downtime starts here
ssh root@OLD 'cd /opt/naapurustot/server && docker compose stop api umami'

ssh root@OLD 'set -o pipefail; cd /opt/naapurustot/server \
  && docker compose exec -T db pg_dump -U naapurustot_api naapurustot | gzip > backups/naapurustot-final.sql.gz \
  && docker compose exec -T db pg_dump -U umami umami | gzip > backups/umami-final.sql.gz \
  && gunzip -t backups/naapurustot-final.sql.gz backups/umami-final.sql.gz \
  && ls -lh backups/*-final.sql.gz'

cd /opt/naapurustot/server
scp root@OLD:/opt/naapurustot/server/backups/naapurustot-final.sql.gz backups/
scp root@OLD:/opt/naapurustot/server/backups/umami-final.sql.gz backups/

# CONFIRM — replaces the rehearsal data with the final dumps
./restore.sh naapurustot backups/naapurustot-final.sql.gz
./restore.sh umami backups/umami-final.sql.gz

docker compose exec -T api wget -q -O - http://localhost:3001/health
docker compose exec -T db psql -tAX -U naapurustot_api -d naapurustot -c 'SELECT count(*) FROM users;'
ssh root@OLD "cd /opt/naapurustot/server && docker compose exec -T db psql -tAX -U naapurustot_api -d naapurustot -c 'SELECT count(*) FROM users;'"
```

Expected: both dumps non-empty and passing `gunzip -t`, `/health` answering, and the two
`users` counts **exactly equal**. Stripe webhooks that arrive during the window fail and are
retried by Stripe later.

## 5. DNS and certificates — Operator, then Claude

Operator, at Cloudflare: point the A records for `api.naapurustot.fi` and
`analytics.naapurustot.fi` at `NEW`, DNS only (grey cloud). Leave `naapurustot.fi` and
`www` alone; they point at GitHub Pages.

Claude:

```bash
getent hosts api.naapurustot.fi analytics.naapurustot.fi    # repeat until both show NEW
cd /opt/naapurustot/server
docker compose up -d
docker compose logs --since 5m caddy | grep -i 'certificate obtained'
```

Expected: one "certificate obtained successfully" line per name, usually within a minute.
`up -d` also starts `db-backup`, which takes its first dump immediately.

## 6. Verify — Claude, then Operator

Claude:

```bash
curl -sf https://api.naapurustot.fi/health
curl -sI https://analytics.naapurustot.fi | head -1
docker compose ps                     # caddy, api, umami, db, db-backup all up
cat backups/status.json               # "umami_ok":1 and "naapurustot_ok":1
```

Operator: sign in on naapurustot.fi, add a favourite and reload; sign in to Umami with the
existing password and check new pageviews; check the Stripe webhook endpoint for deliveries
still failing from the window and resend them; check Sentry for new API errors.

## 7. Point deploys at NEW — Operator

1. GitHub → Settings → Secrets and variables → Actions: set `DEPLOY_SERVER_IP` to `NEW`.
   `DEPLOY_SSH_KEY` stays; its public half was copied in step 2.
2. Re-enable the Deploy Server workflow and run it once on `main`. A good run ends with
   "api healthy after N attempt(s)".

Claude then checks: `git -C /opt/naapurustot log -1 --oneline` matches `main`, and
`docker compose ps` shows everything up.

## 8. Move vakiosulkapollbot — Operator, then Claude (`CONFIRM`)

The droplet's other tenant (`jvmarten/vakiosulkapollbot`, private) is a Telegram bot run by
its own `deploy.sh` with `docker run`, not compose: a `vakiosulkapollbot` container plus a
`warp` SOCKS proxy (Cloudflare WARP, because varaamo.hel.fi drops datacenter IPs) on a
`botnet` network. It polls Telegram, so it needs no DNS and no open ports, and it shares
nothing with naapurustot's stack. Do it any time after step 2.

Telegram lets only one process poll a bot token, so the old bot stops **before** the new one
starts; with both running, scheduled posts would also go out twice. The operator picks a time
clear of the bot's schedule (Helsinki time): Monday 07:00 weekly poll, Wednesday 21:00
reminder, Thursday 07:00 video. A post that falls inside the gap is skipped until the next
week.

The paths below assume the bot runs as root on the droplet; confirm with the step 1 inventory
(`/root/vakiosulkapollbot` exists) and stop if it doesn't.

1. **Claude** creates a key used only for this repo, behind its own SSH alias, so it never
   becomes the server's default GitHub identity:

   ```bash
   ssh-keygen -t ed25519 -N '' -C 'vakiosulkapollbot deploy key' -f /root/.ssh/vakiosulkapollbot_deploy
   cat >> /root/.ssh/config <<'EOF'
   Host github-vakiosulkapollbot
     HostName github.com
     User git
     IdentityFile /root/.ssh/vakiosulkapollbot_deploy
     IdentitiesOnly yes
   EOF
   chmod 600 /root/.ssh/config
   cat /root/.ssh/vakiosulkapollbot_deploy.pub
   ```

2. **Operator:** GitHub → jvmarten/vakiosulkapollbot → Settings → Deploy keys → Add deploy
   key; paste the key, write access off.
3. **Claude** clones through the alias (`deploy.sh` reuses the clone's remote from then on)
   and pre-pulls the proxy image:

   ```bash
   ssh -o StrictHostKeyChecking=accept-new -T github-vakiosulkapollbot   # "successfully authenticated"; exits 1
   git clone git@github-vakiosulkapollbot:jvmarten/vakiosulkapollbot.git /root/vakiosulkapollbot
   docker pull caomingjun/warp
   ```

4. **Claude** (`CONFIRM` — the bot goes offline), at the time the operator picked:

   ```bash
   ssh root@OLD 'docker stop vakiosulkapollbot'
   scp root@OLD:/root/vakiosulkapollbot/.env /root/vakiosulkapollbot/.env
   chmod 600 /root/vakiosulkapollbot/.env
   md5sum /root/vakiosulkapollbot/.env && ssh root@OLD 'md5sum /root/vakiosulkapollbot/.env'   # must match
   scp -r root@OLD:/root/vakiosulkapollbot/data /root/vakiosulkapollbot/
   scp -r root@OLD:/root/vakiosulkapollbot/warp-data /root/vakiosulkapollbot/
   /root/vakiosulkapollbot/deploy.sh main
   docker logs --since 5m vakiosulkapollbot
   ```

   The old container's restart policy is `unless-stopped`, so a stopped bot stays stopped.
   Expected: "Bot started" with the next poll times. `Conflict: terminated by other
   getUpdates request` means the old bot is still running: stop and report.

5. **Claude** checks the tennis scanner after about ten minutes (it first runs 30 s after
   start, then every 5 min): `docker logs --since 10m vakiosulkapollbot` shows no blocked or
   timed-out requests to varaamo.hel.fi, and `docker logs --since 10m warp` shows WARP
   connected. If the copied WARP registration won't connect, register fresh (`CONFIRM`):
   `docker rm -f warp && rm -rf /root/vakiosulkapollbot/warp-data && /root/vakiosulkapollbot/deploy.sh main`.
6. **Operator:** check the bot answers in Telegram. Then in the bot repo's Settings → Secrets
   and variables → Actions, set `DROPLET_IP` to `NEW` and run its Deploy workflow once. The
   droplet's authorized keys, copied in step 2, should already hold the workflow key's public
   half; that run confirms it. If `DROPLET_USER` is not `root`, that user must exist on `NEW`
   first.

Rolling the bot back: `docker stop vakiosulkapollbot` on `NEW`, copy `data/` back to the
droplet, then `ssh root@OLD 'docker start vakiosulkapollbot'`.

## Rollback — Operator decides, Claude runs

Until the droplet is destroyed, its data is exactly as it was at the freeze.

1. Operator: point the `api` and `analytics` A records back to `OLD`; if step 7 is done, set
   `DEPLOY_SERVER_IP` back too.
2. Claude: `ssh root@OLD 'cd /opt/naapurustot/server && docker compose up -d'`.

Anything written on `NEW` after the cutover exists only there. If `NEW` served traffic for more
than a few minutes, first dump its `naapurustot` database, copy it to `OLD` and run
`restore.sh` there (`CONFIRM`), mirroring step 4.

## After the migration — Operator

- After a week of normal running, and only once step 8 is done and the step 1 inventory showed
  nothing else to move, download `backups/*-final.sql.gz` from `OLD` and destroy the droplet.
  The migration key on it goes with it.
- Add an off-site copy of the daily dumps (a bucket with another provider): the dumps and
  Hetzner's backups currently live with one provider.
- Update the docs that still name DigitalOcean: `README.md`, `server/README.md`,
  `docs/ARCHITECTURE.md` and the header comment of `server/backup.sh`.

## Phase 2: serve the site from NEW

Start only after phase 1 has run cleanly for a week or two **and** the phase 2 repo changes
(server job in `deploy.yml`, site block in the Caddyfile, `SITE_HOSTS`) have merged. Claude
checks the second condition first and stops if it fails:

```bash
grep -q SITE_HOSTS /opt/naapurustot/server/docker-compose.yml \
  && echo 'phase 2 changes present' || echo 'phase 2 changes NOT merged: stop'
```

1. **Claude:** `df -h /` (a release is about 1 GB; deploys hard-link unchanged files, so five
   releases stay within a few GB), then `mkdir -p /srv/naapurustot/releases`.
2. **Operator:** at Cloudflare, add an A record `next.naapurustot.fi` → `NEW`, DNS only.
3. **Claude:** after the next site deploy, check that `/srv/naapurustot/current` points at the
   newest release and `curl -sI https://next.naapurustot.fi/` answers 200 from Caddy. Signing
   in fails on that address by design: the API only accepts `naapurustot.fi` origins.
4. **Operator:** at Cloudflare, replace the four GitHub A records for `naapurustot.fi`
   (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`) with one A record
   to `NEW`, and the `www` CNAME (`jvmarten.github.io`) with an A record to `NEW`. Write the old
   values down: they are how you switch to the Pages standby.
5. **Claude** (`CONFIRM` — recreating Caddy drops `api.` and `analytics.` for a second or two):

   ```bash
   getent hosts naapurustot.fi www.naapurustot.fi      # both must show NEW
   cd /opt/naapurustot/server
   echo 'SITE_HOSTS="naapurustot.fi, www.naapurustot.fi"' >> .env
   docker compose up -d caddy
   docker compose logs --since 5m caddy | grep -i 'certificate obtained'
   curl -sI https://naapurustot.fi/ | grep -i '^server'                                   # Caddy
   curl -sI https://naapurustot.fi/alue/01120-vasterskog | grep -i '^location'             # trailing /
   curl -s -o /dev/null -w '%{http_code}\n' https://naapurustot.fi/nonexistent-xyz        # 404
   curl -sI https://www.naapurustot.fi/ | grep -i '^location'                              # apex
   ```

6. **Operator:** sign in and sync on naapurustot.fi, check a shared area link's preview image
   in a chat app, check Umami, then delete the `next.naapurustot.fi` record.

**Switching to the Pages standby** (operator): put the GitHub records from step 4 back, then
check HTTPS under GitHub → Settings → Pages; if the certificate hasn't come back after several
minutes, remove the custom domain and add it again. **Rolling phase 2 back:** do the standby
switch, then Claude runs `sed -i '/^SITE_HOSTS=/d' .env && docker compose up -d caddy`
(`CONFIRM`).
