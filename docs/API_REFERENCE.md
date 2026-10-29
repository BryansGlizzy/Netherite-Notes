# Netherite Notes — API Reference

Every HTTP route and the WebSocket channel served by `server/`. Three families of routes exist; they differ in authentication and in the shape of error responses.

| Family | Prefix | Auth | Error body |
|---|---|---|---|
| **REST API v1** (for integrations) | `/api/v1` | API token `Bearer nt_…` — except token management and health | `{ "error": { "code", "message" } }` |
| **Account, vault and note routes** (used by the web app) | `/api/register`, `/api/login`, `/api/user/*`, `/api/auth/*`, `/api/groups*`, `/api/notes*`, `/api/admin/*` | User JWT `Bearer <jwt>` — except the public ones marked below | `{ "error": "message", "code": "…" }` |
| **Health** | `/api/v1/health`, `/healthz` | none | — |

All bodies are JSON (`Content-Type: application/json`). Every response carries an `X-Request-Id` header; unexpected 500s return `{"error":"Internal server error","requestId":"…"}` — quote the id when reporting a problem.

---

## 🌐 Base URL

The server listens on `HOST:PORT` (default `0.0.0.0:20100` in production, `127.0.0.1` in development). Same origin serves the web app and the API: `http://localhost:20100`, API v1 root `http://localhost:20100/api/v1`.

Cross-origin browser access is **off** unless you list origins in `CORS_ORIGINS`. Server-side integrations using `nt_` tokens don't need CORS.

---

## 🔐 Authentication

### User JWT
`POST /api/login` / `POST /api/register` return a JWT valid for 7 days. Send it as `Authorization: Bearer <jwt>`.

- Checked against the database on every request, so deleting a user, changing/resetting their password, or an admin password reset **signs out all of that user's sessions** immediately (HTTP 401).
- Tokens issued by older versions (without a version claim) remain valid until they expire or the password changes.

### API tokens (`nt_…`)
Created by a vault owner (see [Token management](#-token-management-vault-owner)). Send as `Authorization: Bearer nt_<32 hex>`.

- A token belongs to **one vault**; anything outside it returns `403`.
- Permissions are independent flags: `read`, `write`, `delete`, `admin`. (`admin` is reserved; no route checks it yet.) `write` does not imply `read`.
- Stored only as an HMAC-SHA256 hash (keyed by `TOKEN_SECRET`); the raw value is returned once. Optional expiry (`expiresAt`, unix ms, must be in the future); revocable; at most `MAX_TOKENS_PER_VAULT` (50) active per vault.

### Admin
A user is an admin if their email is listed in `ADMIN_EMAILS` **and** verified (by emailed link, or because an operator created the account with `npm run admin:create`). The check is re-read from the database on every request. Addresses in `ADMIN_EMAILS` cannot be claimed through sign-up or the settings page.

---

## ⏱️ Rate limiting

Exceeding a limit returns `429` with code `RATE_LIMITED` (v1: `{error:{code,message}}`). `RateLimit-*` headers are sent. Behind a reverse proxy set `TRUST_PROXY=1` so limits see real client IPs.

| What | Default | Counted per | Env var |
|---|---|---|---|
| Failed logins | 10 / 15 min | IP **and** username | `RATE_LIMIT_LOGIN_MAX` |
| Email verify / reset-password attempts that fail | shares the login budget | IP | |
| Sign-ups | 10 / hour | IP | `RATE_LIMIT_REGISTER_MAX` |
| Forgot-password / resend-verification | 3 / hour | IP **and** address | `RATE_LIMIT_FORGOT_MAX` |
| All `/api` requests | 3000 / min | IP | `RATE_LIMIT_API_MAX` |
| Failed (≥400) `/api` requests | 120 / min | IP | `RATE_LIMIT_API_FAIL_MAX` |
| Failed `/api/v1` requests (bad/expired tokens) | 60 / min | IP | `RATE_LIMIT_V1_FAIL_MAX` |
| Authenticated v1 requests | 120 / min | API token | `RATE_LIMIT_V1_TOKEN_MAX` |
| Health | 60 / min | IP | — |

"Failed-only" limits count responses with status ≥ 400, so normal use never consumes them.

---

## ❤️ Health

`GET /api/v1/health` (alias `GET /healthz`) — open, read-only, cacheless.

```json
200 { "status": "ok",       "version": "1.2.0", "uptimeSec": 4821, "db": "ok" }
503 { "status": "degraded", "version": "1.2.0", "uptimeSec": 4821, "db": "error" }
```
It reveals nothing else (no counts, paths or configuration). Use it for uptime monitors and container health checks; `npm run health` calls it.

---

## 👤 Accounts and sessions

### Public configuration
`GET /api/auth/config` → `{ "registration": "open" | "invite" | "closed" }` — lets the sign-up form know whether an invite code is needed.

### Register
`POST /api/register` (public)
```json
{ "username": "alice", "password": "at-least-10-chars", "email": "alice@example.com", "inviteCode": "nti_…" }
```
- `username`: 3–32 characters from `A–Z a–z 0–9 . _ -` (no `@`); unique case-insensitively and distinct from every email.
- `password`: 10–72 bytes.
- `email`: optional (needed for password reset and admin); lower-cased; unique; an `ADMIN_EMAILS` address is refused with `403`.
- `inviteCode`: required when `REGISTRATION=invite`; `403` `REGISTRATION_CLOSED` when `closed`.
- Creates the user, a default vault ("My Vault") and a "Welcome" note, and — if an email was given — sends a verification link.

Response `200`:
```json
{ "id": "uuid", "username": "alice", "email": "alice@example.com", "emailVerified": false,
  "groupIds": ["vault-id"], "token": "eyJ…", "isAdmin": false,
  "aiEndpoint": null, "hasAiApiKey": false, "aiModel": null,
  "keybindSplitBlock": "Enter", "keybindNewLine": "Shift+Enter" }
```

### Login
`POST /api/login` (public) — `{ "username": "alice" | "alice@example.com", "password": "…" }`; response as above. The username match is case-insensitive when unambiguous. Wrong credentials return `401 INVALID_CREDENTIALS` after the same amount of work whether or not the account exists.

### Get user
`GET /api/user/:id` (JWT; `:id` must be yourself) → the object above without `token`.

### Update settings
`PUT /api/user/:id/settings` (JWT; yourself only). All fields optional:
```json
{ "username": "new_name", "currentPassword": "…", "newPassword": "…",
  "email": "me@example.com",
  "aiEndpoint": "https://api.example.com", "aiApiKey": "sk-…", "aiModel": "model-name",
  "keybindSplitBlock": "Enter", "keybindNewLine": "Shift+Enter" }
```
- Changing the password needs `currentPassword`, and signs out every other session (the response carries a fresh JWT for this one).
- `email` can only be set if the account has none; it is created unverified and a verification link is sent.
- `aiApiKey` is encrypted at rest; `""` removes it. `aiEndpoint` must be an `http(s)` URL.
- Response: the user object (with a fresh `token`, without `groupIds`). **The AI key is never returned.**

### AI configuration (on demand)
`GET /api/user/:id/ai-config` (JWT; yourself only, `Cache-Control: no-store`) → `{ "aiEndpoint", "aiApiKey", "aiModel" }`. The web app calls this when the AI panel opens; the browser then talks to the endpoint directly.

### Email verification
- `POST /api/auth/verify-email` (public) `{ "token": "<64 hex>" }` → `{ "success": true }`; `400` if invalid/expired (24 h). Links look like `{APP_URL}/#verify=<token>` (URL fragment, so the token never reaches a server log).
- `POST /api/auth/resend-verification` (JWT) → `{ "success": true }`; `400` if there is no unverified email.

### Password reset
- `POST /api/auth/forgot-password` (public) `{ "email" }` → always `{ "success": true }` immediately; the email (if the address exists) is sent afterwards. Link: `{APP_URL}/#reset=<token>`, valid 1 hour; only a hash of the token is stored.
- `POST /api/auth/reset-password` (public) `{ "token": "<64 hex>", "newPassword": "…" }` → `{ "success": true }`; `400` for a weak password or invalid/expired/used token. Signs out all sessions.

---

## 📂 Vaults (web app routes, JWT)

A vault is a `group` in the database. The vault **id** and its **share code** are different values for vaults created since 1.2 (12 random characters each). Older vaults keep their 7-character id as their share code until the owner rotates it.

| Route | Who | Body / result |
|---|---|---|
| `GET /api/groups/:id` | member | `{ id, name, ownerId, memberCount }`, plus `joinCode`, `joinEnabled` **for the owner only**. Non-members get `404`. |
| `POST /api/groups` | any user | `{ name }` → `{ id, name, ownerId, joinCode, joinEnabled }`. Creates a "Vault Info" note. |
| `PUT /api/groups/:id` | owner | `{ name }` → `{ success }` |
| `PUT /api/groups/:id/sharing` | owner | `{ enabled?: boolean, rotate?: boolean }` → `{ joinCode, joinEnabled }`. Rotating invalidates the old code immediately; members keep access. |
| `POST /api/groups/join` | any user | `{ groupId: "<share code>" }` (also accepted as `joinCode`) → `{ id, name, ownerId }`. Joins **the caller**. A wrong, rotated or disabled code is an indistinguishable `404`. |
| `POST /api/groups/leave` | member | `{ groupId }` → `{ success }`; the owner cannot leave (`400`). |
| `DELETE /api/groups/:id` | owner | deletes the vault, its notes, memberships and API tokens |
| `GET /api/groups/:id/export` | member | portable backup (below) |
| `POST /api/groups/import` | any user | creates a **new** vault from an export |

### Export format
```json
{ "__netherite_export_version": 1, "exportedAt": 1713401234567, "vault": { "name": "Work" },
  "notes": [ { "id": "uuid", "title": "…", "content": "…", "createdAt": 1, "updatedAt": 2, "isBookmarked": false } ] }
```
Import returns `201 { id, name, ownerId, noteCount }`. Notes get fresh ids; nothing existing is overwritten. Limits: 25 MB body, `IMPORT_MAX_NOTES` (10,000) notes, 1,000,000 characters per note; the whole import is one transaction.

---

## 📝 Notes (web app routes, JWT, vault members)

| Route | Body / result |
|---|---|
| `GET /api/notes?groupId=…` | array of notes, newest first |
| `POST /api/notes` | `{ id, groupId, title, content, createdAt, updatedAt, isBookmarked }` → the note. `id` is client-chosen (`[A-Za-z0-9_-]{1,64}`), `409` if taken. |
| `PUT /api/notes/:id` | any of `title`, `content`, `updatedAt`, `isBookmarked` → `{ success }` |
| `DELETE /api/notes/:id` | `{ success }` |

Limits: title ≤ 500 characters, content ≤ 1,000,000, request body ≤ 1 MB, `MAX_NOTES_PER_VAULT` (50,000) → `413 QUOTA_EXCEEDED`.

---

## 🛡️ Admin (JWT + admin)

| Route | Notes |
|---|---|
| `GET /api/admin/users` | `{ users: [{ id, username, email, emailVerified, isAdmin, groups: [{id,name,ownerId}], noteCount }] }` |
| `PUT /api/admin/users/:id` | `{ username?, email?, newPassword? }` — `"email": null` clears it; an address set by an admin counts as verified; a new password signs the user out everywhere |
| `DELETE /api/admin/users/:id` | deletes the user and every vault they own (notes, tokens); not yourself |
| `GET /api/admin/audit?limit=100` | `{ events: [{ id, ts, action, target, ip, actorName, detail }] }` (max 500) |
| `POST /api/admin/invites` | `{ expiresInDays?: 1–365 }` → `201 { id, code, codePrefix, expiresAt }` — the full `code` is shown only now |
| `GET /api/admin/invites` | `{ invites: [{ id, codePrefix, createdAt, expiresAt, usedAt, usedByName }] }` |
| `DELETE /api/admin/invites/:id` | revoke an unused invite |

**Audit events recorded:** `register`, `login`, `login_failed`, `password_changed`, `password_reset_requested`, `password_reset`, `email_set`, `email_verified`, `api_token_created`, `api_token_revoked`, `vault_sharing_changed`, `vault_deleted`, `admin_update_user`, `admin_delete_user`, `invite_created`, `invite_revoked`. Entries never contain passwords, tokens or note content; they are pruned after `AUDIT_RETENTION_DAYS` (180).

---

## 🔑 Token management (vault owner)

Authenticated with the owner's **JWT** (not an API token). Non-owners and unknown vaults both get `403 INSUFFICIENT_PERMISSIONS`.

- `POST /api/v1/vaults/:id/tokens` — `{ "name"?: string ≤100, "permissions": ["read","write",…], "expiresAt"?: future unix ms }` → `201`
  ```json
  { "token": { "id": 1, "token": "nt_a3f8c2d1…", "tokenPrefix": "nt_a3f8c2d1", "name": "CI bot",
               "permissions": ["read","write"], "createdAt": 1713401234567, "expiresAt": null } }
  ```
  `permissions` defaults to `["read"]`; unknown values are dropped; at least one valid permission is required; `400 LIMIT_REACHED` past 50 active tokens.
- `GET /api/v1/vaults/:id/tokens` → `{ tokens: [{ id, tokenPrefix, name, permissions, createdAt, lastUsedAt, expiresAt, isActive }] }`
- `DELETE /api/v1/vaults/:id/tokens/:tokenId` → `{ success }` (soft revoke)

---

## 🔌 REST API v1 (API token)

Error codes: `400 VALIDATION_ERROR`, `401 UNAUTHORIZED | TOKEN_REVOKED | TOKEN_EXPIRED`, `403 INSUFFICIENT_PERMISSIONS`, `404 NOT_FOUND`, `409 DUPLICATE_LINK`, `413 QUOTA_EXCEEDED`, `429 RATE_LIMITED`, `500 INTERNAL_ERROR`.

### Vault and notes
| Route | Permission | Result |
|---|---|---|
| `GET /api/v1/vaults/:id` | `read` | `{ vault: { id, name, ownerId }, stats: { noteCount } }` |
| `GET /api/v1/vaults/:id/notes` | `read` | `{ notes: [...], pagination: { total, limit, offset, hasMore } }` — query: `limit` (≤200, default 50), `offset`, `sortBy` (`createdAt`/`updatedAt`/`title`), `sortOrder`, `search` (substring in title/content) |
| `GET /api/v1/notes/:id` | `read` | `{ note }` |
| `POST /api/v1/notes` | `write` | body `{ title, content?, isBookmarked? }` → `201 { note }` (title required, trimmed) |
| `PUT /api/v1/notes/:id` | `write` | any of `title`, `content`, `isBookmarked` → `{ note }` |
| `DELETE /api/v1/notes/:id` | `delete` | `{ success, deletedId }` |

A note: `{ id, groupId, title, content, createdAt, updatedAt, isBookmarked }`.

### Links and graph
Links are `[[Note Title]]` in note content, matched case-insensitively and exactly by title inside the vault; unknown titles and self-links are ignored.

| Route | Permission | Result |
|---|---|---|
| `GET /api/v1/notes/:id/links` | `read` | `{ noteId, outgoingLinks: [{targetId,targetTitle,linkText}], incomingLinks: [{sourceId,sourceTitle}] }` |
| `GET /api/v1/vaults/:id/links` | `read` | `{ links: [{sourceId,sourceTitle,targetId,targetTitle}], nodes: [{id,title,linkCount}] }` |
| `GET /api/v1/vaults/:id/notes/:noteId/connected` | `read` | breadth-first neighbours; `direction` = `both`/`outgoing`/`incoming`, `depth` 1–3 → `{ centerNote, connectedNotes: [{id,title,connectionType,distance}] }` |
| `POST /api/v1/links` | `write` | `{ sourceNoteId, targetNoteId, linkText? }` appends `\n[[linkText or target title]]` to the source → `201 { link, updatedNote }`; `409 DUPLICATE_LINK` |
| `DELETE /api/v1/links` | `write` | `{ sourceNoteId, targetNoteId }` removes lines of the source that consist solely of that link → `{ success, updatedNote }` |

### Bulk
- `POST /api/v1/vaults/:id/notes/bulk` (`write`) — `{ notes: [{ title, content? }, …] }` (≤ 500) → `201 { created: [{id,title,createdAt}], errors: [{index,error}] }` (`400` only if every item failed)
- `DELETE /api/v1/vaults/:id/notes/bulk` (`delete`) — `{ noteIds: [...] }` (≤ 500) → `{ deleted: [...], errors: [{noteId,error}] }`

### Example
```bash
TOKEN=nt_…   VAULT=abc123def456
curl -H "Authorization: Bearer $TOKEN" "http://localhost:20100/api/v1/vaults/$VAULT/notes?search=todo"
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"title":"Inbox","content":"- [ ] call Sam"}' http://localhost:20100/api/v1/notes
```

---

## 🔔 WebSocket (`/ws`)

Real-time presence and change relay inside a vault. Connect to `ws(s)://<host>/ws`; frames are JSON, max 1 MiB, at most 40 messages/second per socket. The server pings every 30 s and drops dead sockets.

**The first message must be a successful `JOIN` within 10 seconds**, otherwise the socket is closed with code `4401`.

| Client → server | Fields | Effect |
|---|---|---|
| `JOIN` | `groupId`, `token` (user JWT) | Verifies the JWT and vault membership. Identity (`userId`, `username`) always comes from the token. Replies `ROOM_STATE`; others get `PRESENCE_UPDATE`. Invalid → close `4401`. |
| `VIEWING` | `noteId` or `null` | updates presence |
| `UPDATE` / `CREATE` | `note` (must carry the joined `groupId`) | relayed to the *other* members (fields whitelisted) |
| `DELETE` | `id` | relayed to the other members |

Relayed events are **not persisted** — clients also call the REST routes. Server → client: `ROOM_STATE { users }`, `PRESENCE_UPDATE { user }` (or `{ userId, offline: true }`), and the relayed events.

Close codes: `4401` unauthorized, `4429` rate limited, `1009` message too big.

---

## 🧱 Limits and validation summary

| Item | Rule |
|---|---|
| Username | 3–32 chars `A–Z a–z 0–9 . _ -`, case-insensitively unique |
| Password | 10–72 bytes |
| Email | ≤ 254 chars, valid format, unique, lower-cased |
| Note title / content | ≤ 500 / ≤ 1,000,000 characters |
| JSON body | 1 MB (vault import 25 MB, authenticated only) |
| Notes per vault | 50,000 (`MAX_NOTES_PER_VAULT`) |
| Active API tokens per vault | 50 (`MAX_TOKENS_PER_VAULT`) |
| Bulk request | 500 items |

---

## 🔧 Environment variables

Loaded from `.env` (copy `.env.example`; change the path with `ENV_FILE`). `.env` is git-ignored.

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET`, `TOKEN_SECRET` | — (one required) | session signing / API-token HMAC key. Use two different 32+ char values. Changing `TOKEN_SECRET` invalidates all API tokens. |
| `DATA_ENCRYPTION_KEY` | derived from `JWT_SECRET` | 32-byte key (base64/hex) for stored AI keys |
| `NODE_ENV` | `production` | only `development` starts the Vite dev server |
| `PORT` / `HOST` | `20100` / `0.0.0.0` (prod), `127.0.0.1` (dev) | listener |
| `TRUST_PROXY` | off | number of reverse proxies in front (e.g. `1`) |
| `CORS_ORIGINS` | none | comma-separated allowed browser origins |
| `DB_PATH` / `BACKUP_DIR` | `./obsidian.db` / `backups/` next to the DB | database file and automatic pre-migration backups |
| `APP_URL` | `http://localhost:20100` | public base URL in emailed links |
| `ADMIN_EMAILS` | none | comma-separated admin addresses |
| `REGISTRATION` | `open` | `open` / `invite` / `closed` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | smtp2go / `2525` / — | outgoing mail |
| `SMTP_REQUIRE_TLS` | `true` | require STARTTLS |
| `RATE_LIMIT_*`, `MAX_TOKENS_PER_VAULT`, `IMPORT_MAX_NOTES`, `MAX_NOTES_PER_VAULT`, `AUDIT_RETENTION_DAYS` | see above | limits |

---

## 🛡️ Security notes

- Passwords are bcrypt (12 rounds). Reset and verification tokens are stored hashed; API tokens are stored as HMAC hashes; AI keys are AES-256-GCM encrypted.
- Production sends an enforced CSP (`script-src 'self'`), `nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'` and HSTS when `APP_URL` is https.
- The web client keeps its JWT in `localStorage` and a copy of the user's notes in IndexedDB; both are cleared on logout and whenever the server rejects the session.
- AI requests go **from the browser straight to the endpoint the user configured** (not through this server), so that endpoint must allow cross-origin requests from the app's origin. Model-proposed note edits require an explicit Apply.
- Vault membership is the authorization boundary: every note route resolves the note's vault and checks the caller's membership.
