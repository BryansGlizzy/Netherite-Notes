# Deployment

One Node.js process serves the web app, the REST API and the WebSocket on a single port (default 20100) and stores everything in one SQLite file. Run it behind a TLS-terminating reverse proxy.

## Requirements

Node.js 22+. On Linux the prebuilt `sqlite3` binary needs **glibc 2.38 or newer** (Ubuntu 24.04+, Debian 13+, Fedora 39+). On older distributions (Ubuntu 22.04, Debian 12) `npm ci` falls back to compiling from source if `python3`, `make` and `g++` are installed — or use the Docker image, which is based on Debian 13.

## 1. Configure

```bash
cp .env.example .env
openssl rand -hex 32   # → JWT_SECRET
openssl rand -hex 32   # → TOKEN_SECRET (a different value)
```
Set at least: `JWT_SECRET`, `TOKEN_SECRET`, `APP_URL` (public https URL), `ADMIN_EMAILS`, SMTP settings if you want password-reset and verification emails, and `TRUST_PROXY=1` when a single reverse proxy sits in front. See the table in [API_REFERENCE.md](API_REFERENCE.md#-environment-variables).

Decide who may sign up: `REGISTRATION=open` (default), `invite` (admins generate single-use codes in the admin panel) or `closed`.

## 2. Run it

### Option A — systemd (bare metal / VM)
```bash
sudo mkdir -p /opt/netherite-notes && sudo chown $USER /opt/netherite-notes
git clone <repo> /opt/netherite-notes && cd /opt/netherite-notes
git checkout v1.2.0 && npm ci && npm run build
sudo useradd --system --home /opt/netherite-notes --shell /usr/sbin/nologin netherite
sudo chown -R netherite:netherite /opt/netherite-notes
sudo cp deploy/netherite.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now netherite
npm run health
```
The unit sandboxes the process (read-only system, writes only inside the app directory). Logs: `journalctl -u netherite -f`.

### Option B — Docker
```bash
cp .env.example .env   # fill it in
docker compose -f deploy/docker-compose.yml up -d --build
```
The database and its backups live in the `netherite-data` volume (`/data`). The image runs as a non-root user and has a built-in health check against `/api/v1/health`.

> Tested: the image builds, runs as the non-root `node` user, reports *healthy*, applies migrations on first start and keeps data across restarts.

### Create the first admin
```bash
npm run admin:create -- --email you@example.com --username you     # docker: docker compose exec netherite npm run admin:create -- …
```
The address must also be listed in `ADMIN_EMAILS`.

## 3. Reverse proxy and TLS

Use [deploy/Caddyfile.example](../deploy/Caddyfile.example) (automatic certificates, WebSockets work out of the box) or [deploy/nginx.conf.example](../deploy/nginx.conf.example). Requirements either way:

- forward `Host` and the client IP, and **overwrite** `X-Forwarded-For` (never append untrusted values);
- upgrade WebSocket connections on `/ws`;
- allow request bodies up to 30 MB (vault import);
- set `TRUST_PROXY=1` in `.env` and `APP_URL=https://your.domain`.

The app already sends HSTS (when `APP_URL` is https), a Content-Security-Policy and the other security headers; don't strip them.

## 4. Backups and monitoring

```bash
npm run db:backup                    # writes backups/obsidian-YYYYMMDD-HHMMSS.db (owner-only), keeps the newest 14
```
- Schedule it (cron or a systemd timer) and **copy the files off the machine**; they contain password hashes and encrypted keys, so protect them like the database. `KEEP=30 BACKUP_DIR=/mnt/backups npm run db:backup` customises retention and location.
- Restore: stop the app, replace `obsidian.db` with a backup (delete any leftover `obsidian.db-wal`/`-shm`), start the app.
- Point an uptime monitor at `https://your.domain/api/v1/health` (expects `{"status":"ok"}`).
- `npm run doctor` gives a read-only configuration and database report.

## 5. Updating

See [UPGRADING.md](UPGRADING.md). In short: back up, check out the new tag, `npm ci`, `npm run build`, restart, `npm run health`.

## Hardening checklist

- [ ] `NODE_ENV` is not `development` on any reachable host (`npm run doctor` shows it)
- [ ] two different long random secrets; `.env` readable only by the service user (`chmod 600 .env`)
- [ ] HTTPS everywhere; `APP_URL` is https
- [ ] `TRUST_PROXY` matches your proxy chain
- [ ] SMTP configured with TLS, `ADMIN_EMAILS` set, admin account verified
- [ ] `REGISTRATION` set deliberately
- [ ] backups scheduled and copied off-box; restore tested once
