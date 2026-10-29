# Upgrading

This guide covers moving an existing installation from **1.0.x** (the original `server.js` monolith) to **1.2.x**, and is the pattern for later releases. Your database file, `.env` and API tokens carry over unchanged.

## What stays the same

- `node server.js` still starts the app (it is now a one-line shim), so existing systemd/pm2 units keep working.
- The database stays where it is (`./obsidian.db` unless you set `DB_PATH`). Users, vaults, notes, passwords, API tokens and share codes are preserved.
- Your `.env` works as-is. New settings are optional.
- REST API v1 requests and responses are unchanged (see the one tightening below).
- Existing 7-day login sessions stay valid.

## Procedure

```bash
cd /path/to/netherite-notes
npm run db:backup                      # (1.0.x has no such script: `cp obsidian.db obsidian.db.manual-$(date +%F)`)
git fetch --tags && git checkout v1.2.0
npm ci                                 # rebuilds native modules for this machine/OS
npm run build                          # compiles the client
sudo systemctl restart netherite       # or: pm2 restart …   (a Docker setup: rebuild and `up -d`)
npm run health                         # expect status ok
npm run doctor                         # read-only report; address anything it flags
```

On first start the server applies seven migrations in order, **after writing an automatic backup** to `backups/pre-migrate-v7-<timestamp>.db` (next to the database). Read the startup log: it prints each migration and any warnings.

### Before you restart (2 minutes)

1. **Production mode.** The server now defaults to production. If you previously ran `npm run dev`/`npm start` on a public host, make sure you launch the new version with `npm start` or plain `node server.js`.
2. **Admin account.** Admins now need a *verified* email. If your admin account already exists with its email in `ADMIN_EMAILS`, the migration marks it verified automatically. For an `ADMIN_EMAILS` address that has **no account**, create it once: `npm run admin:create -- --email you@example.com --username you`.
3. **Reverse proxy?** Add `TRUST_PROXY=1` (one proxy) so rate limits see real client IPs, and make sure `APP_URL` is your public https URL.
4. **SMTP.** Mail now requires STARTTLS by default. If your relay has no TLS, set `SMTP_REQUIRE_TLS=false` (only for a trusted local relay).
5. **Secrets.** If the startup log warns that `JWT_SECRET`/`TOKEN_SECRET` are short, identical or only one is set, generate two fresh values. Changing `TOKEN_SECRET` invalidates all API tokens; changing `JWT_SECRET` logs everyone out and makes stored AI keys unreadable unless you set `DATA_ENCRYPTION_KEY` first.

## What the migrations do

| # | Change | Effect on existing data |
|---|---|---|
| 001 | Baseline schema, vault-owner backfill, hash any plaintext passwords | none for healthy databases |
| 002 | Case-insensitive unique usernames | skipped (and logged) if two accounts differ only by case, e.g. `Sam` and `sam`; both keep working |
| 003 | `token_version` for revocable sessions | existing sessions continue |
| 004 | Indexes, audit log, invites | none |
| 005 | Email verification columns; hash in-flight reset tokens | admin emails marked verified; other users start unverified and see a banner — login is not blocked |
| 006 | **AI API keys encrypted**; plaintext column cleared | users keep their saved key |
| 007 | Share codes: `join_code` = current vault id | every existing share code keeps working until the owner rotates it |

## Behaviour changes to expect

- Passwords for **new** accounts and password changes need 10+ characters (existing passwords are unaffected). Usernames for new accounts are limited to letters, digits, `.`, `_`, `-`.
- Changing or resetting a password signs out the user's other sessions.
- Vault members no longer see the share code; only the owner does (and can rotate or disable it).
- API tokens now need the `read` permission to call `GET /api/v1/vaults/:id` and `GET /api/v1/vaults/:id/notes`. At startup the server lists any active tokens that lack `read`.
- Cross-origin browser calls are refused unless the origin is in `CORS_ORIGINS`.
- Open WebSocket tabs from before the upgrade will be told to reconnect; a page reload picks up the new app.
- AI-suggested note edits are previewed and applied with a click (with Undo).

## Rolling back

Migrations only add things, with two exceptions that matter on rollback:

- **006:** older code looks for the AI key in the plaintext column, which is now empty — affected users re-enter their key. (Or restore the pre-migration backup.)
- **005:** reset links requested within the last hour before the upgrade stop working.

```bash
git checkout v1.1.0 && npm ci && npm run build && sudo systemctl restart netherite    # any earlier release tag works
# full data restore (only if needed): stop the app, then copy backups/pre-migrate-v7-….db over obsidian.db
```

If you came from the original unversioned copy of the app, restore that folder from your own backup instead, together with the database copy you took before upgrading.

## Verifying an upgrade on a copy first

```bash
mkdir /tmp/try && cp obsidian.db /tmp/try/
ENV_FILE=/dev/null DB_PATH=/tmp/try/obsidian.db PORT=20199 HOST=127.0.0.1 \
  JWT_SECRET=$(openssl rand -hex 32) TOKEN_SECRET=$(openssl rand -hex 32) node server.js
npm run health -- --url=http://127.0.0.1:20199
```
