# Netherite Notes

A self-hosted, multi-user, vault-based note-taking web app inspired by Obsidian: `[[wiki-links]]` with a graph view, a live-preview markdown editor, offline support, real-time presence, an optional bring-your-own AI assistant, and a token-secured REST API.

- **Private by design** — single Node process, one SQLite file, no third-party services required.
- **Multi-vault & sharing** — invite people with a rotatable share code; export/import whole vaults as JSON.
- **Works offline** — installable PWA with an IndexedDB cache and a replay queue.
- **Extensible** — scoped API tokens (`read`/`write`/`delete`) for scripts and integrations; see [docs/API_REFERENCE.md](docs/API_REFERENCE.md).
- **Hardened** — bcrypt, revocable sessions, verified admin accounts, hashed tokens, encrypted AI keys, rate limits, enforced CSP, audit log.

## Quick start

Requires Node.js 22+.

```bash
git clone <this repository> && cd netherite-notes
npm ci
cp .env.example .env            # then set JWT_SECRET and TOKEN_SECRET (openssl rand -hex 32, two different values)
npm run build
npm start                       # http://localhost:20100
npm run health                  # → status ok
```

Create your first account in the browser. To make yourself an administrator, add your email to `ADMIN_EMAILS` in `.env` and run:

```bash
npm run admin:create -- --email you@example.com --username you
```

For development with hot reload: `npm run dev` (binds to `127.0.0.1` only).

## Run with Docker

A multi-platform image (`linux/amd64`, `linux/arm64`) is published on Docker Hub: [`futurelabz/netherite-notes`](https://hub.docker.com/r/futurelabz/netherite-notes).

```bash
docker run -d --name netherite --restart unless-stopped \
  -p 127.0.0.1:20100:20100 \
  -v netherite-data:/data \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -e TOKEN_SECRET=$(openssl rand -hex 32) \
  -e APP_URL=http://localhost:20100 \
  futurelabz/netherite-notes:latest

curl http://localhost:20100/api/v1/health      # → {"status":"ok",...}
```

- **Keep your secrets.** The two values above are generated fresh each time you run that command — save them (or use an `--env-file`), because changing `TOKEN_SECRET` invalidates API tokens and changing `JWT_SECRET` signs everyone out.
- **Data** (database, WAL files and automatic backups) lives in the `netherite-data` volume at `/data`.
- Put a reverse proxy with TLS in front for anything beyond localhost, and set `TRUST_PROXY=1` (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
- Create an admin: `docker exec -it netherite npm run admin:create -- --email you@example.com --username you` (the address must also be in `ADMIN_EMAILS`).
- Pin a version in production (`futurelabz/netherite-notes:1.2.0`) instead of `latest`.

With Docker Compose (uses a `.env` file; builds from source):

```bash
cp .env.example .env     # set JWT_SECRET and TOKEN_SECRET
docker compose -f deploy/docker-compose.yml up -d --build
```

### Building and publishing the image (maintainers)

```bash
docker login -u futurelabz      # use a Docker Hub access token, not your password
docker buildx create --name multi --driver docker-container --use     # once
docker buildx build --platform linux/amd64,linux/arm64 \
  -t futurelabz/netherite-notes:1.2.0 -t futurelabz/netherite-notes:latest --push .
```
Build for both platforms: an arm64-only image (the default on Apple Silicon) fails on most cloud servers with "exec format error".

## Deploying

TLS, reverse proxy, systemd and backups are covered in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Upgrading from an earlier version: [docs/UPGRADING.md](docs/UPGRADING.md).

## Documentation

| | |
|---|---|
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Every HTTP route, the WebSocket protocol, limits, environment variables |
| [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) | Code layout, database schema, data flow, how to extend |
| [docs/Context.md](docs/Context.md) | Product scope, features and tech stack |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Running it for real |
| [docs/UPGRADING.md](docs/UPGRADING.md) | Upgrade and rollback procedure |
| [SECURITY.md](docs/SECURITY.md) | Reporting vulnerabilities, security model |

## Development

```bash
npm test            # integration tests (boot real servers on temporary databases)
npm run lint        # server, scripts, tests
npm run typecheck   # client
npm run doctor      # config + database health report
```

## License

No license file has been added yet. Until one is, the code is "all rights reserved" by default — choose a license (for example MIT or AGPL-3.0) before publishing.
