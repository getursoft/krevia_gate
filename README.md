# Krevia

**Secured. Transparent. Trust.**

Krevia is a residential society management platform for India. Sprint 1 delivered verified resident onboarding (accounts, society search, membership requests, society-admin review, profile) and role-based dashboards for **Residents**, **Society Admins / AOA** and **Security Guards**, on the web, iOS and Android. Sprint 2 adds secure society accounts: Argon2id passwords, password reset by one-time code, invitations, memberships with statuses, unit assignment, a central permission policy, tenant isolation and an append-only audit trail (see [docs/sprint-2/security-report.md](docs/sprint-2/security-report.md)). Sprint 3 adds buildings and floors, an archival-aware unit directory, a resident and household directory, and a validated, idempotent CSV import with a downloadable error report (see [docs/sprint-3/implementation-report.md](docs/sprint-3/implementation-report.md)).

This README is the developer guide. Everything runs on **localhost**; no cloud account, deployment or paid service is needed.

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 22 (CI uses `.nvmrc` → 24; also tested on 26.5) | `nvm use` picks up `.nvmrc` |
| pnpm | 11.10.0 (pinned in `package.json` → `packageManager`) | `corepack enable` or `brew install pnpm` |
| PostgreSQL | 14+ (tested on 17) | must provide the `pg_trgm` extension (standard builds do) |
| Google Chrome | any current | used by Playwright locally; CI uses Playwright's bundled Chromium |
| iOS (optional) | Xcode 26+, a simulator runtime, CocoaPods | `brew install cocoapods` |
| Android (optional) | JDK 17 + Android SDK + emulator | **not installed on the Sprint 1 build machine**; see §15 |

## 2. Repository structure

```
packages/shared   @krevia/shared: zod validation, DTO types, API client, brand tokens, role navigation, log redaction
apps/api          @krevia/api: NestJS 11 + Prisma 6 REST API under /api/v1 (port 4100)
apps/web          @krevia/web: Next.js 15 website (port 3100)
apps/mobile       @krevia/mobile: Expo SDK 58 / React Native app for iOS and Android
scripts/          smoke.mjs (pnpm smoke), ci-local.sh (pnpm ci:local)
.github/workflows CI pipeline (ci.yml)
docs/sprint-1/    assessment, plan, security model, API reference, acceptance and gap-closure reports
design/           brand assets (krevia-mark.png) and the supplied reference artwork
```

The workspace is defined in `pnpm-workspace.yaml` (`apps/*`, `packages/*`, hoisted `node_modules` for Expo/Metro). Every app depends on `@krevia/shared` via `workspace:*`, so it must be built first (`pnpm build:shared`). The aggregate commands below do that for you.

## 3. Install dependencies

```bash
pnpm install            # also runs `prisma generate` for the API (postinstall)
```

CI uses `pnpm install --frozen-lockfile`; use it locally too if you want to be sure the lockfile is respected.

## 4. Environment configuration

Copy the examples (placeholders only; real `.env` files are git-ignored and must never be committed):

```bash
cp apps/api/.env.example       apps/api/.env
cp apps/api/.env.test.example  apps/api/.env.test
cp apps/web/.env.example       apps/web/.env.local
cp apps/mobile/.env.example    apps/mobile/.env          # optional
```

| App | Variable | Required | Default | Purpose |
|---|---|---|---|---|
| API | `DATABASE_URL` | **yes** | — | `postgresql://…` URL. Dev: `krevia_dev`. In `.env.test`: a database ending in `_test` |
| API | `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| API | `PORT` | no | `4100` | HTTP port |
| API | `CORS_ORIGINS` | no | `http://localhost:3100` | comma-separated browser origins (CORS + CSRF check) |
| API | `SESSION_TTL_HOURS` | no | `720` | session lifetime |
| API | `COOKIE_SECURE` | no | `false` | Secure cookie flag (always on in production) |
| API | `TRUST_PROXY` | no | `false` | trust one proxy hop for client IPs |
| API | `AUTH_RATE_LIMIT` / `AUTH_RATE_TTL_SECONDS` | no | `10` / `60` | login/register attempts per IP per window |
| API | `AUTH_PEPPER` | **production** | random per process outside production | secret key (32+ chars) for hashing password-reset codes |
| API | `MESSAGE_DELIVERY` | no | `dev-outbox` (`none` in production) | where invitation links and reset codes go; `dev-outbox` is refused in production |
| API | `PUBLIC_WEB_URL` | no | first `CORS_ORIGINS` entry | website origin used in invitation links |
| API | `INVITE_TTL_HOURS` / `RESET_CODE_TTL_MINUTES` | no | `168` / `10` | invitation and reset-code lifetimes |
| API | `LOG_LEVEL` | no | `info` (`error` in tests) | `error` \| `warn` \| `info` \| `debug` |
| API | `LOG_FORMAT` | no | `json` | `json` \| `pretty` |
| API | `SEED_ADMIN_PHONE` / `SEED_ADMIN_PASSWORD` | no | — | demo society admin created by `pnpm db:seed` |
| API | `SEED_GUARD_PHONE` / `SEED_GUARD_PASSWORD` | no | — | demo security guard created by `pnpm db:seed` |
| API | `SEED_PLATFORM_ADMIN_PHONE` / `SEED_PLATFORM_ADMIN_PASSWORD` | no | — | demo platform administrator (creates societies, invites their first admin; no society data access) |
| Web | `API_URL` | no | `http://localhost:4100` | API origin (no path); `/api/v1/*` is proxied to it |
| Web | `LOG_LEVEL` / `LOG_FORMAT` | no | `info` / `json` | server-side web logs |
| Mobile | `EXPO_PUBLIC_API_URL` | no | simulator: `http://localhost:4100`, emulator: `http://10.0.2.2:4100` | API origin baked into the build; must be HTTPS in production |
| E2E | `E2E_DATABASE_URL` | no | `postgresql://$USER@localhost:5432/krevia_e2e_test` | Playwright database (name must end in `_test`) |
| E2E | `PW_CHANNEL` | no | `chrome` locally, `bundled` in CI | browser for Playwright |

**Startup validation.** The API validates its environment at boot and exits with a list of every missing or invalid variable, without echoing values. For example:

```
[krevia-api] Invalid environment configuration:
  - DATABASE_URL: is required (PostgreSQL connection URL)
Set these in apps/api/.env (see .env.example) or the process environment.
```

The website does the same for a malformed `API_URL` when `next dev` / `next build` starts.

## 5. Local database setup and migrations

```bash
createdb krevia_dev
createdb krevia_test           # API integration tests (reset on every run)
createdb krevia_e2e_test       # Playwright tests (reset on every run)
pnpm db:migrate                # prisma migrate deploy → krevia_dev
```

* Migrations live in `apps/api/prisma/migrations/` (`init`, `guard_role`, `sprint2_secure_accounts`, `sprint3_resident_directory`). Rollback for Sprint 2: [docs/sprint-2/migrations.md](docs/sprint-2/migrations.md); Sprint 3: `apps/api/prisma/rollback/20261026090000_sprint3_resident_directory.down.sql`. Never edit an applied migration; add a new one with `pnpm --filter @krevia/api prisma:migrate:dev --name <change>` against the dev database.
* **Test isolation.** `pnpm test:api` drops and recreates the schema of the database in `apps/api/.env.test`, then applies all migrations, so every run starts from a clean database. Its safety rails:
  * The test URL is read from `.env.test`, overriding any `DATABASE_URL` exported in your shell.
  * The database name must end in `_test`.
  * It refuses to run if the test database is the same as the development database in `apps/api/.env`.
  * It prints only the target, e.g. `Test database: krevia_test on localhost:5432`, never credentials.

  Playwright applies the same `_test` rule to `krevia_e2e_test`.

## 6. Seeding

```bash
pnpm db:seed     # idempotent; refuses to run when NODE_ENV=production
```

Creates six **fictional** societies (e.g. "Green Valley Residency, Pune"). When their variables are set, it also creates a demo **society admin** and a demo **security guard** for Green Valley Residency, and a demo **platform administrator**. A password left empty skips that account.

**Invitations and reset codes in development.** No SMS provider is configured. With `MESSAGE_DELIVERY=dev-outbox` (the default outside production) the API keeps the messages it would send in memory; read them with `curl 'http://localhost:4100/api/v1/dev/outbox?to=%2B919876543210'`. Admins also see each invitation link once on the Invitations page, to share themselves.

## 7. Start the API and website

**One terminal** (both servers, logs interleaved, Ctrl-C stops both):

```bash
pnpm dev
```

**Or two terminals:**

```bash
pnpm dev:api     # terminal 1: http://localhost:4100/api/v1
pnpm dev:web     # terminal 2: http://localhost:3100
```

Stop with Ctrl-C. To find a stray server: `lsof -nP -iTCP:3100 -iTCP:4100 -sTCP:LISTEN`. Ports 3000/4000 are deliberately not used, because other local projects often hold them.

Production-style: `pnpm build`, then `pnpm --filter @krevia/api start` and `pnpm --filter @krevia/web start`.

## 8. Mobile development

```bash
pnpm dev:mobile                # Expo dev server; press i for the iOS simulator
cd apps/mobile && pnpm ios     # native iOS build + run (Xcode + CocoaPods)
pnpm export:android            # Android JS bundle (works without the Android SDK)
```

Building iOS without the Expo CLI:

```bash
cd apps/mobile && npx expo prebuild --platform ios && (cd ios && pod install)
cd ios && xcodebuild -workspace Krevia.xcworkspace -scheme Krevia -configuration Release \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath build build
xcrun simctl install booted build/Build/Products/Release-iphonesimulator/Krevia.app && xcrun simctl launch booted com.krevia.app
```

Keep Xcode's default simulator signing. Do not pass `CODE_SIGNING_ALLOWED=NO`, or the Keychain that stores the session token is unavailable.

## 9. Local URLs and ports

| Service | URL |
|---|---|
| Website | http://localhost:3100 |
| API base | http://localhost:4100/api/v1 |
| API liveness | http://localhost:4100/api/v1/health |
| API readiness (database) | http://localhost:4100/api/v1/ready |
| API docs (OpenAPI, non-production only) | http://localhost:4100/api/docs |
| Expo / Metro | http://localhost:8081 |
| Playwright test servers | API :4110, web :3110 (started and stopped by the test run) |

## 10. Health endpoints

| Endpoint | Meaning | Healthy | Unhealthy |
|---|---|---|---|
| `GET /api/v1/health` | **Liveness**: the process is up. Never checks dependencies, so a database outage does not get a working process restarted. | `200 {"status":"ok","service":"krevia-api","version":"0.1.0","time":"…"}` | no response |
| `GET /api/v1/ready` | **Readiness**: PostgreSQL answers `SELECT 1` within 2 s | `200 {"status":"ready","service":"krevia-api","checks":{"database":"up"}}` | `503 {"status":"not_ready","service":"krevia-api","checks":{"database":"down"}}` |

Neither response includes hosts, credentials or error details. When readiness fails, the reason is logged at `warn` with credentials masked. The website proxies both endpoints (`http://localhost:3100/api/v1/health`).

## 11. Test, lint, typecheck and build

| Command | What it runs |
|---|---|
| `pnpm lint` | ESLint (flat config `eslint.config.mjs`) in every package |
| `pnpm typecheck` | builds shared, then `tsc --noEmit` in every package |
| `pnpm test` | shared + API (unit + integration on `krevia_test`) + web unit + mobile unit tests |
| `pnpm test:shared` / `test:api` / `test:web:unit` / `test:mobile` | one suite each |
| `pnpm test:e2e` (alias `test:web`) | Playwright: resets and seeds `krevia_e2e_test`, starts API :4110 and web :3110, runs desktop and phone-viewport tests, then stops them |
| `KREVIA_API_URL=http://localhost:4100 pnpm --filter @krevia/mobile test:contract` | mobile API client against a running API |
| `pnpm build` | shared + API + website production builds |
| `pnpm export:android` | Android JS bundle |
| `pnpm ci:local` | everything CI runs, in the same order, locally (§14) |

Every aggregate command stops at the first failure and exits non-zero.

## 12. Smoke test

With the API and website running (§7):

```bash
pnpm smoke
```

It checks five things:
1. API liveness.
2. Database readiness.
3. The website returns 200 with the Krevia wordmark and the exact tagline.
4. The website → API proxy works.
5. Protected endpoints return 401 without a session.

Each failure names the service and the next troubleshooting step, and the command exits 1 if any check fails. It never starts or stops servers. Point it elsewhere with `SMOKE_API_URL` / `SMOKE_WEB_URL` (defaults are localhost only) and set the per-request timeout with `SMOKE_TIMEOUT_MS`.

## 13. Logging

API and server-side web logs are **structured JSON, one object per line**:

```json
{"time":"2026-10-20T09:15:02.112Z","level":"warn","service":"krevia-api","env":"development","msg":"GET /api/v1/societies/:id 401","context":"HTTP","requestId":"5f0c…","method":"GET","route":"/api/v1/societies/:id","status":401,"durationMs":3.41,"errorCode":"UNAUTHENTICATED"}
```

* **One line per request:** request ID, method, route *pattern* (no ids, no query string), status, duration. Levels are `info` (2xx/3xx), `warn` (4xx) and `error` (5xx); health probes log at `debug`.
* **Correlation:** every response carries `X-Request-Id`, which also appears in error bodies (`error.requestId`) and on the log line. A well-formed incoming `X-Request-Id` is reused. The website sends its own ID with each session check.
* **Errors are logged once:** a 5xx adds `errorCode`, `errorName` and a redacted `errorMessage` (and the stack outside production) to that request's line, instead of a separate log entry. Errors outside requests (`unhandledRejection` / `uncaughtException`) and Prisma warnings and errors use the same format.
* **Never logged:** request bodies, query strings, headers, cookies, tokens, passwords or OTPs. Keys such as `password`, `token`, `authorization`, `cookie`, `secret` and `DATABASE_URL` are replaced with `[REDACTED]` at any depth. Credentials inside connection strings and `Bearer …` values are masked in free text. The rules live in `packages/shared/src/redact.ts` and are shared by the API and the website.
* **Readable locally:** `LOG_FORMAT=pretty` prints single lines (`2026-… INFO  GET /api/v1/health 200 requestId=…`). Set `LOG_LEVEL=debug` for more detail.

## 14. CI

`.github/workflows/ci.yml` runs on pushes to `main`, on pull requests and on demand. On `ubuntu-latest` with an isolated PostgreSQL 17 service container, it runs:

1. Frozen-lockfile install.
2. Build shared.
3. Lint.
4. Typecheck.
5. Shared, API, web unit and mobile tests.
6. Web production build.
7. Playwright e2e (bundled Chromium).
8. Android JS export.

On failure it uploads the Playwright report and traces, and it always writes a results table to the job summary. Any failing step fails the workflow. It uses no secrets; the database password is a CI-only value for the throwaway container.

`pnpm ci:local` (`scripts/ci-local.sh`) runs the same steps locally against your `_test` databases. It builds the website into `.next-ci`, so a running `pnpm dev:web` is not disturbed.

## 15. Android toolchain limitation

The Android **native** build and emulator run have **not** been executed: the Sprint 1 machine has no JDK or Android SDK. The Android **JavaScript bundle** is built and checked (`pnpm export:android`, also in CI). To unblock:

```bash
brew install --cask zulu@17 android-commandlinetools
export ANDROID_HOME="$HOME/Library/Android/sdk"
sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-36" "build-tools;36.0.0" \
  "emulator" "system-images;android-36;google_apis;arm64-v8a"
avdmanager create avd -n krevia -k "system-images;android-36;google_apis;arm64-v8a"
emulator -avd krevia &
cd apps/mobile && pnpm android
```

## 16. Common errors and recovery

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid environment configuration: - DATABASE_URL …` | missing or invalid `apps/api/.env` | copy `.env.example`, set `DATABASE_URL` |
| `/api/v1/ready` → 503, smoke "Database readiness" fails | PostgreSQL stopped or wrong URL | `brew services start postgresql@17`; check `DATABASE_URL`; `pnpm db:migrate` |
| `P1001: Can't reach database server` at API start | API started before PostgreSQL | start PostgreSQL, then restart the API |
| `Refusing to reset "…": test database names must end with _test` | `.env.test` points at a non-test database | fix `apps/api/.env.test` |
| `relation "Society" does not exist` | migrations not applied | `pnpm db:migrate` |
| `Cannot find module '@krevia/shared'` / missing types | shared not built | `pnpm build:shared` |
| `@prisma/client did not initialize yet` | client not generated | `pnpm db:generate` |
| `EADDRINUSE :::4100` / `:3100` | another process on the port | `lsof -nP -iTCP:4100 -sTCP:LISTEN`, stop it |
| Smoke "Website → API proxy" fails | web `API_URL` wrong or API down | fix `apps/web/.env.local`, restart `pnpm dev:web` |
| Playwright: `Chromium distribution 'chrome' is not found` | Chrome not installed | install Chrome, or `PW_CHANNEL=bundled` + `npx playwright install chromium` |
| `pnpm install` very slow or `ERR_PNPM_IGNORED_BUILDS` | slow registry / new native dependency | retry (`fetchTimeout`/`fetchRetries` are set); approve with `pnpm approve-builds` |
| iOS app stuck on splash or Keychain errors | built with `CODE_SIGNING_ALLOWED=NO` | rebuild with default signing |
| Xcode `No space left on device` | system disk full | free space, or prefix builds with `TMPDIR=$PWD/.tmp` |

## 17. Implemented vs. deferred

**Implemented:**
* Accounts and sessions (mobile number + password, Argon2id), sign-out everywhere, password reset by one-time code (Sprint 2).
* Invitations, memberships (active / suspended / revoked), units and resident assignment, multiple societies with an active-society selection, resident management pages and an audit log for admins (Sprint 2).
* Central permission policy and tenant isolation on every society endpoint (Sprint 2).
* Buildings, floors and an archival-aware unit directory; a resident and household directory with emergency contacts and vehicles; CSV import with template, validation preview, one-transaction confirm, counts, idempotent retries and a formula-safe error report; a resident household view on web and mobile (Sprint 3).
* Society search.
* Membership requests and status.
* Society-admin approvals (web and mobile).
* Profile.
* Resident, Admin and Guard dashboards and menus, with a view switcher.
* Health and readiness endpoints, structured logging, smoke test and CI workflow.

**Deferred (menus show "Coming soon"):** SMS delivery (no provider; see the dev outbox above), phone-number verification at registration, visitors and QR gate entry, deliveries, staff and vehicle entry, payments, amenities, complaints, notices, events, the public business directory, buy & sell, documents, polls, reports, and role assignment UI. There is also no public deployment; the test environment is localhost.

Roles: a `Membership` grants `RESIDENT`, `ADMIN` (`/admin`) or `GUARD` (`/guard`) in one society; only `ACTIVE` memberships grant permissions, defined once in `packages/shared/src/permissions.ts`. `/home` sends each user to their primary role's dashboard. Menus come from `packages/shared/src/navigation.ts`, following `design/reference/Krevia Multi-Role Community App Showcase.png`.

Brand: the official "K" house mark (`design/krevia-mark.png`, white variant for dark backgrounds) is used for the app icon, splash and favicon. Colour tokens are in `packages/shared/src/brand.ts`.
