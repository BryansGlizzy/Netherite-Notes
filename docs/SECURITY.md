# Security

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private vulnerability reporting ("Security" tab → "Report a vulnerability") or contact the maintainer directly. Include steps to reproduce and the version (`GET /api/v1/health` reports it). You will get an acknowledgement and a fix timeline; please allow time for a patch before disclosing.

## Security model in brief

- **Accounts:** bcrypt (12 rounds); passwords 10–72 bytes; sessions are JWTs that the server re-checks against the database on every request, so password changes, resets and deletions end sessions immediately.
- **Admin:** requires an address in `ADMIN_EMAILS` that is *verified* (email link or created by an operator with shell access). Admin addresses cannot be claimed through sign-up.
- **Vault access:** every note, export and WebSocket join requires membership; owner-only actions (rename, delete, sharing, API tokens) check ownership. Share codes are random, rotatable and can be disabled.
- **API tokens:** random 128-bit, stored only as HMAC-SHA256, scoped to one vault, per-permission, expirable, revocable, rate-limited.
- **Secrets at rest:** reset and verification tokens are stored hashed; users' AI API keys are AES-256-GCM encrypted and never included in profile responses.
- **Transport & browser hardening:** enforced Content-Security-Policy (`script-src 'self'`), `nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`, HSTS over https, bearer-token auth (no cookies, hence no CSRF surface), no third-party scripts.
- **Abuse controls:** rate limits on sign-in, sign-up, password reset, API and tokens; request-size limits; per-vault quotas; audit log of security events.
- **Production by default:** the server runs in production mode unless `NODE_ENV=development` is set explicitly; the development server refuses to serve the database or secrets.

## Operator checklist

1. Two different random 32+ character values for `JWT_SECRET` and `TOKEN_SECRET`.
2. Serve over HTTPS and set `APP_URL` to the public https URL; set `TRUST_PROXY=1` behind one reverse proxy.
3. Keep `.env` and `*.db` out of version control and backups out of the web root (the repository's `.gitignore` already excludes them).
4. Run `npm run doctor` after upgrades and `npm audit --omit=dev` regularly (CI does this on every push).
5. Back up with `npm run db:backup` and copy the files off the machine.
6. Choose `REGISTRATION=invite` or `closed` if the instance is not meant for the public.

## Known trade-offs

- The session token lives in `localStorage` (not an HttpOnly cookie). The strict CSP and absence of third-party scripts are the mitigation; moving to cookies would add CSRF handling.
- The AI panel calls the user's chosen endpoint **directly from the browser**, which is why `connect-src` allows any http(s) origin. The server never fetches user-supplied URLs.
- Real-time updates over WebSocket are relayed between authenticated members but are not themselves persisted or signed; the REST routes remain the source of truth.
