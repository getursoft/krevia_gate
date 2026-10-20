# Krevia — Authentication & Security (Sprint 1)

## Authentication model

| Aspect | Implementation | Where |
|---|---|---|
| Identity | Indian mobile number (normalised to E.164 `+91XXXXXXXXXX`) + password | `packages/shared/src/validation.ts` |
| Password storage | scrypt (N=2¹⁵, r=8, p=1, 64-byte key, 16-byte random salt), timing-safe comparison | `apps/api/src/auth/password.ts` |
| Password policy | 8–128 chars, at least one letter and one digit | shared `passwordSchema` |
| Login timing | A dummy hash is verified when the number is unknown, so response time does not reveal registration | `auth.controller.ts` |
| Login errors | Always `Incorrect mobile number or password.` | `auth.controller.ts` |
| Sessions | 256-bit random opaque token; only its SHA-256 hash is stored (`Session.tokenHash`) | `session.service.ts` |
| Expiry | `SESSION_TTL_HOURS` (default 720 h = 30 days); expired sessions are rejected | `session.service.ts` |
| Revocation | `POST /auth/logout` sets `revokedAt`; revoked sessions are rejected | `auth.controller.ts` |
| Web transport | `krevia_session` cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production or when `COOKIE_SECURE=true`. The website proxies `/api/v1/*` to the API so the cookie is first-party. Token is never exposed to JavaScript. | `auth.controller.ts`, `apps/web/next.config.ts` |
| Mobile transport | `Authorization: Bearer <token>`; token returned only when the request has `X-Krevia-Client: mobile` | `auth.controller.ts` |
| Mobile storage | `expo-secure-store` (iOS Keychain `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, Android Keystore-backed). Never AsyncStorage. | `apps/mobile/src/lib/token-store.ts` |
| Session restoration | Mobile validates the stored token with `GET /auth/me` on launch; 401 → token deleted; network failure → offline state with retry | `apps/mobile/src/lib/session.tsx` |
| Web route protection | Middleware redirects when the cookie is absent; the `(app)` layout validates the cookie against `/auth/me` on every protected render (a forged cookie is rejected) | `apps/web/middleware.ts`, `apps/web/app/(app)/layout.tsx` |
| Open-redirect protection | `?next=` only accepts same-site relative paths | `apps/web/lib/safe-next.ts` |

## Authorization and society isolation

* Every API route requires a valid session unless explicitly marked `@Public()` (only health, readiness, register, login).
* Resident data (`/profile`, `/membership-requests/me`, cancel) is always scoped by the session's user id; ids from the client are never trusted for ownership. Another user's request returns 404 (indistinguishable from non-existent).
* Society-scoped data goes through `MembershipAccessService`:
  * `requireSocietyAdmin(user, societyId)` — list/approve/reject requests of **that** society only.
  * `requireMemberOrAdmin(user, societyId)` — member-only resources (e.g. `/societies/:id/overview`). A `PENDING` request grants nothing.
* Roles: every account is a resident. `SocietyRole` grants `ADMIN` or `GUARD` for one society. Dashboards are chosen on the client from `/auth/me`, but every staff action is authorised on the server. A guard is rejected (403) by all admin endpoints and by member-only resources, and web/mobile staff dashboards hide themselves from users without that role.
* Membership requests are always created as `PENDING`; a `status` sent by the client is ignored.
* Applicants cannot review their own request; reviews use a conditional update (`WHERE status = 'PENDING'`) so concurrent reviews cannot both succeed.
* Duplicate protection: application check **plus** a partial unique index (`one PENDING/APPROVED request per user`) that holds under concurrency.

## Request hardening

| Control | Detail |
|---|---|
| Input validation | Shared zod schemas on every body/query/param; malformed ids → 400; unknown fields on profile update → 400 |
| Body limits | JSON only, 32 KB max |
| CSRF | `SameSite=Lax` + Origin check: cookie-authenticated state-changing requests must carry an allow-listed `Origin`; any request with a disallowed `Origin` is rejected |
| CORS | Allow-list from `CORS_ORIGINS`, credentials enabled only for those origins |
| Rate limiting | `@nestjs/throttler`: register/login limited to `AUTH_RATE_LIMIT` (default 10) per `AUTH_RATE_TTL_SECONDS` (default 60) per client IP; 600/min global ceiling. Set `TRUST_PROXY=true` behind a load balancer / the Next.js proxy in production so limits apply per real client IP. |
| Headers | Helmet on the API; `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` on the website; `X-Powered-By` removed |
| Health | `/api/v1/health` (liveness, no dependencies) and `/api/v1/ready` (PostgreSQL, 2 s timeout, 503 when down). Neither exposes hosts, credentials or error details. |
| Errors | Uniform `{ error: { code, message, details?, requestId } }`; no stack traces, SQL or Prisma messages reach clients |
| Logging | Structured JSON (one object per line: `time, level, service, env, msg, requestId, method, route, status, durationMs, errorCode`). One line per request, using the route *pattern*. 5xx details (redacted message, stack outside production) go on that same line, so each error is logged once. Bodies, query strings, headers, cookies, tokens and passwords are never logged. Sensitive keys and connection-string/bearer credentials are masked by `packages/shared/src/redact.ts`, covered by unit and integration tests. Prisma query logging is disabled; Prisma warnings and errors go through the same logger. |
| Secrets | None in source. `.env` files are git-ignored; `.env.example` files contain placeholders only. The seed admin password is read from env and the seed refuses to run in production. |
| API docs | Swagger UI at `/api/docs` is disabled when `NODE_ENV=production` |

## Development-only mechanisms

There is **no** development authentication bypass. The only development-only component is the seed script (`apps/api/prisma/seed.ts`), which creates fictional sample societies and an optional demo society admin from `SEED_ADMIN_PHONE` / `SEED_ADMIN_PASSWORD`, and exits with an error when `NODE_ENV=production`.

## Unconfigured integration boundaries

| Integration | Status |
|---|---|
| SMS / WhatsApp OTP (verification, password reset) | **Not configured.** `OtpProvider` interface + `UnconfiguredOtpProvider` exist in `apps/api/src/auth/otp/otp-provider.ts`; no OTP endpoints are exposed and no OTP is ever generated. A provider (e.g. MSG91, Twilio Verify, AWS SNS) needs credentials, DLT template registration (TRAI) and an implementation of the interface. |
| Email delivery | Not configured. Email is stored as an optional, unverified profile field. |
| Password reset | Not available (depends on OTP). The login screens state this. |

## Known limitations

* Registration reveals whether a mobile number is already registered (409). Mitigated by rate limiting; revisit once OTP verification exists.
* Mobile numbers are not verified by OTP in Sprint 1, so a user could register a number they do not own. Society admin verification is the control for society access.
* Rate-limit state is in-memory per API instance; use a shared store (Redis) when running more than one instance.
