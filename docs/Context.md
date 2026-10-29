# 📓 Product Scope & Context

Netherite Notes is a self-hosted, multi-user, vault-based note-taking web app: private by default, offline-capable, extensible through a scoped REST API, and small enough to run on a single machine.

## 🌟 Features

### Vaults and sharing
- Notes live in **vaults** (`groups` in the database). A vault has an owner and any number of members; members read and edit, the owner also renames, deletes, shares and issues API tokens.
- **Share codes** are separate from vault ids, random, and can be rotated or switched off by the owner. Export a vault to JSON and import it as a new vault.

### Notes
- **Live-preview block editor**: markdown renders in place; the focused block becomes raw text. Split/merge blocks with configurable keys (default `Enter` / `Shift+Enter`), toggle GFM checkboxes in the preview, or switch to a plain raw view.
- **Wiki-links** `[[Note Title]]` with autocomplete, an interactive **D3 graph view**, bookmarks, split view (two notes side by side) and a **command palette** (`Ctrl/Cmd+K`).

### Offline, sync and collaboration
- Installable **PWA**; notes and vaults are cached in IndexedDB (Dexie) and offline writes are queued and replayed in order.
- **Real-time presence**: authenticated members see who is in a vault and which note they have open, and edits are relayed live (WebSocket `/ws`).

### Accounts and administration
- Registration (open, invite-only or closed), login by username or email, password reset and email verification by emailed link, profile and keybinding settings.
- **Admin panel** (verified `ADMIN_EMAILS` accounts): manage users, issue/revoke invite codes, review the security **audit log**.

### AI assistant (bring your own compute)
- Users configure any OpenAI-compatible endpoint, API key and model (model list can be fetched from `GET {endpoint}/v1/models`). The key is stored **encrypted** and fetched only when the AI panel opens.
- The browser calls `POST {endpoint}/v1/chat/completions` directly with streaming (SSE), folds `<think>…</think>` reasoning into an expandable bubble, and renders replies as markdown.
- The assistant can propose note edits through an `update_note` tool. Proposals are **previewed and applied with a click**, and can be undone.

### REST API v1
Scoped tokens (`read`/`write`/`delete`) for scripts and integrations: notes CRUD, search, links, graph, connected notes, bulk operations — see [API_REFERENCE.md](API_REFERENCE.md).

## 🏗️ Technical stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite 7 |
| Styling | Tailwind CSS 3 (compiled at build time, typography plugin), `lucide-react` icons |
| Markdown / graph | `react-markdown` + `remark-gfm`; `d3` |
| Offline | `dexie` (IndexedDB), Workbox-generated service worker |
| Backend | Node.js 22+, Express 5, `sqlite3` (WAL), `ws` |
| Security | `bcrypt`, `jsonwebtoken`, `helmet`, `express-rate-limit`, Node `crypto` (HMAC, AES-GCM) |
| Email | `nodemailer` (SMTP with STARTTLS) |
| Serving | `vite-express`: Vite in development, `dist/` in production — one process, one port |
| Quality | ESLint, `tsc`, `node:test` integration suites, GitHub Actions CI, Dependabot |

## 🧭 Principles

1. **The database file is the source of truth.** Schema changes are additive migrations that back the database up first.
2. **Secure by default.** Production mode unless explicitly told otherwise; authorization is membership/ownership-based and re-checked in the database; secrets are hashed or encrypted at rest.
3. **API first.** New capability should be reachable through the versioned `/api/v1` where it makes sense, with scoped tokens.
4. **Docs and tests move with the code.** A route, table or setting changes → update [API_REFERENCE.md](API_REFERENCE.md), [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) and the tests in the same change.

## 🤖 For AI agents working on this repo
- Start with [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) for the layout and [API_REFERENCE.md](API_REFERENCE.md) for behaviour.
- Run `npm test`, `npm run lint` and `npm run typecheck` before finishing; the tests boot real servers, so they cover wiring errors.
- Never read, print or commit `.env` or `*.db`.
