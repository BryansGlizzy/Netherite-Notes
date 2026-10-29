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

## Deploying

TLS, reverse proxy, systemd, Docker and backups are covered in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Upgrading from an earlier version: [docs/UPGRADING.md](docs/UPGRADING.md).

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
