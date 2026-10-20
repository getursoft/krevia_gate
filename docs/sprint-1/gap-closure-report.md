# Krevia — Sprint 1 Gap Closure: Development Infrastructure & Test Readiness

Date: 2026-10-20 · Scope: Sprint 1 gap closure (no new product modules) · Test environment: **localhost**
Evidence: [`evidence/`](evidence/) (`ci-local.log` is the authoritative full run).

## Result summary

| Area | Outcome | Status |
|---|---|---|
| A. Monorepo setup and root commands | Root `dev`, `build`, `test`, `test:e2e`, `typecheck`, `lint`, `smoke`, `ci:local` added or verified; ports 3100/4100 confirmed in config | **PASS** |
| B. Local environment configuration | `.env.example` files document every variable (required vs optional); actionable startup validation; test-DB safety rails | **PASS** |
| C. CI pipeline | `.github/workflows/ci.yml` validated with actionlint 1.7.12 (0 errors); every step passes locally via `pnpm ci:local` | **PASS (local)** · **NOT RUN on GitHub** (see below) |
| D. Health endpoint | Existing `/api/v1/health` (liveness) and `/api/v1/ready` (readiness) kept; readiness gained a 2 s timeout and a safe `service` field; API now stays live when the DB is down at startup; healthy and unhealthy paths tested | **PASS** |
| E. Structured logging | JSON logger for API (incl. Nest and Prisma messages) and server-side web; request IDs; one line per request; redaction; configurable level and format | **PASS** |
| F. Smoke command | `pnpm smoke`: 5 checks, root-cause reporting, next steps, exits non-zero on failure | **PASS** |
| G. Tests and static checks | 162 automated tests passed, 0 failed; lint, typecheck, web build, migrations and Android JS export pass | **PASS** |
| H. Developer documentation | README rewritten as the developer guide (17 sections) | **PASS** |
| Android native build | JDK / Android SDK still not installed | **BLOCKED** (unchanged) |

**Remote CI status: unverified.** The repository has no Git commits and no GitHub remote, so the workflow has never run on GitHub Actions. It is syntax-checked (actionlint), and each of its steps passed locally in the same order. The first push to `main` (or a pull request) will be its first real run.

## Inspection findings (before changes)

* Git: repository initialised, **no commits**, no remote. No `.github/` directory existed.
* Root scripts existed for `build:shared`, `dev:api`, `dev:web`, `dev:mobile`, `db:migrate`, `db:seed`, per-package tests, `typecheck` and `lint`. **Missing:** `dev`, `build`, `test`, `smoke`, CI.
* Health: `/api/v1/health` (liveness) and `/api/v1/ready` (DB readiness, 503 on failure) **already existed**, contrary to the closure report's "not confirmed". They were reused, not duplicated. Gaps: no test for the unhealthy path, no timeout, and the API **crashed at startup** (Prisma `P1001`) when PostgreSQL was down, so readiness could never report it.
* Logging: plain-text Nest `Logger` lines with a request ID; Nest bootstrap and Prisma messages unstructured; no level or format configuration; no redaction layer; no logging tests.
* Config: zod validation existed but the error only listed variable names. `DATABASE_URL` format was not checked, and the website did not validate `API_URL`.
* Tests: no website unit tests. The test runner honoured a shell-exported `DATABASE_URL` over `.env.test`, guarded only by the `_test` name check.
* Ports: API `PORT` default 4100 (`apps/api/src/config.ts`) and web `next dev -p 3100` (`apps/web/package.json`) match the docs.

## What changed

### A. Root commands (`package.json`)

| Command | Does |
|---|---|
| `pnpm dev` | build shared, then API + web in parallel (Ctrl-C stops both) |
| `pnpm build` | shared → API → web production builds |
| `pnpm test` | shared + API + web unit + mobile tests |
| `pnpm test:e2e` (`test:web` kept as alias) | Playwright suite |
| `pnpm test:web:unit` | new website unit tests |
| `pnpm db:generate` | Prisma client generation (also runs automatically on install via the API's `postinstall`) |
| `pnpm export:android` | Android JS bundle |
| `pnpm smoke` | smoke test |
| `pnpm ci:local` | local equivalent of the CI workflow |

All aggregate scripts chain with `&&`, so the first failure exits non-zero. A shim-induced lint failure stopped `pnpm ci:local` with exit 1 (`evidence/ci-local-failure-demo.log`).

> Note: the local pipeline is `ci:local`, not `ci`. `pnpm ci` is a **built-in pnpm command** (clean install). It ran once by mistake during this work and reinstalled `node_modules` from the local store; no data or source was affected, and that run is not counted as a pass.

### B. Environment
* `apps/api/.env.example`, `.env.test.example`, `apps/web/.env.example` updated: every variable, required or optional, defaults, logging variables. Placeholders only.
* API startup validation lists each bad variable once, with a value-free rule (e.g. `- DATABASE_URL: must be a postgresql:// connection URL`, `- LOG_LEVEL: must be one of: error, warn, info, debug`), points at the right `.env` file, and exits 1 without a stack trace. The website validates `API_URL` the same way.
* Test-DB safety (`apps/api/scripts/prepare-test-db.js`, `test/setup-env.ts`):
  * `.env.test` now overrides any shell `DATABASE_URL`.
  * The `_test` suffix is required.
  * It refuses to run if the target equals the development database in `apps/api/.env`.
  * It prints only `Test database: krevia_test on localhost:5432`.
* The API startup log reports `database: "krevia_dev on localhost:5432"` (no credentials).
* The website's Playwright and `ci:local` builds use separate build dirs (`.next-e2e`, `.next-ci`), so a running `pnpm dev:web` keeps working.

### C. CI (`.github/workflows/ci.yml`)
* Runs on push to `main`, pull requests and manual dispatch, on `ubuntu-latest`.
* Throwaway **PostgreSQL 17 service container**, Node from `.nvmrc` (24), pnpm from `packageManager` (11.10.0), `pnpm install --frozen-lockfile`.
* Steps: build shared → lint → typecheck → shared, API, web unit and mobile tests → web build → Playwright e2e (bundled Chromium) → Android JS export.
* On failure it uploads the Playwright report and traces; it always writes a job-summary results table. It needs no secrets: the DB password is a CI-only value for the throwaway container.
* Validation: `actionlint -verbose` → 0 errors (`evidence/actionlint.log`). `shellcheck` is not installed, so inline `run:` scripts were not shellchecked.

### D. Health
* `GET /api/v1/health`: liveness, `200 {status:"ok", service:"krevia-api", version, time}`, no dependency checks.
* `GET /api/v1/ready`: readiness, `200 {status:"ready", service, checks:{database:"up"}}` or `503 {status:"not_ready", …, database:"down"}` on failure **or a hang over 2 s**. Failure reasons go to the log, redacted.
* `PrismaService` no longer crashes the process when the DB is unavailable at startup: it logs a warning and readiness reports 503 until the DB recovers. Verified live: an API pointed at a dead DB port answered health **200** and ready **503**.

### E. Logging
* `apps/api/src/common/logger.ts`: `AppLogger` implements Nest's `LoggerService`, so framework messages are JSON too. Prisma warn and error events go through it. `LOG_LEVEL` (`error|warn|info|debug`) and `LOG_FORMAT` (`json|pretty`) are configurable.
* `request-context.middleware.ts`: one access line per request with `requestId, method, route` (pattern, e.g. `/api/v1/societies/:id`), `status, durationMs`, plus `errorCode`. Levels follow status; health probes log at `debug`.
* `http-exception.filter.ts` no longer logs separately. It attaches `errorCode`, `errorName`, a redacted `errorMessage` and the stack (outside production) to the request's line, so **each error is logged once**.
* `main.ts`: `unhandledRejection` / `uncaughtException` are logged in the same format.
* `packages/shared/src/redact.ts`: shared redaction (sensitive keys at any depth; credentials in URLs; `Bearer` tokens; Error objects reduced to a redacted name and message).
* Website: `apps/web/lib/log.ts` (same line shape, `service:"krevia-web"`). The session check now sends its own `X-Request-Id` to the API and logs failures with it, so both logs can be correlated.
* Live sample (`krevia_dev`): `{"level":"warn","service":"krevia-api","env":"development","msg":"GET /api/v1/auth/me 401","context":"HTTP","requestId":"demo-req-0001","method":"GET","route":"/api/v1/auth/me","status":401,"durationMs":23.56,"errorCode":"UNAUTHENTICATED"}`. The bearer token sent with that request appears 0 times in the log.

### F. Smoke (`scripts/smoke.mjs`)
Checks API liveness, DB readiness, website (200 + "Krevia" + exact tagline), web→API proxy, and 401 on a protected endpoint. URLs are configurable (`SMOKE_API_URL`, `SMOKE_WEB_URL`, localhost defaults) and so is the timeout. Dependent checks are reported as *skipped* when their prerequisite fails, so the advice points at the root cause. It never starts or stops servers.

| Scenario | Result | Exit |
|---|---|---|
| All services healthy | 5/5 passed (`evidence/smoke-pass.log`) | 0 |
| Database unavailable (API on :4198 with a dead DB port) | readiness ✗ with DB recovery steps | 1 |
| API stopped (:4197) | liveness ✗; readiness and auth *skipped* | 1 |
| Website stopped (:3197) | website ✗; proxy *skipped* | 1 |

(`evidence/smoke-failures.log`. The temporary API on :4198 was stopped afterwards; no orphan processes remain.)

## G. Verification results (final code, `pnpm ci:local`, `evidence/ci-local.log`)

| Check | Status | Result |
|---|---|---|
| Frozen-lockfile install | PASS | |
| Lint | PASS | 0 problems (3 findings in new test code fixed first) |
| Typecheck | PASS | all 4 packages |
| Shared tests | PASS | 19 / 19 |
| API unit + integration (`krevia_test`, recreated and migrated) | PASS | **75 / 75**: 56 existing + 8 logger unit + 11 health/logging/config integration |
| Web unit tests (new) | PASS | **16 / 16**: redirect guard, role routing, web logger redaction |
| Mobile unit tests | PASS | 38 / 38 |
| Web production build | PASS | compiled successfully |
| Web e2e (Playwright, `krevia_e2e_test`) | PASS | 14 / 14 |
| Android JS export | PASS | Hermes bundle exported |
| Database migrations on a clean DB | PASS | both migrations applied to a freshly dropped schema each API run |
| Health endpoint tests | PASS | liveness 200; liveness stays 200 with DB down; readiness 200; 503 on DB error (no leak); 503 within 4 s on DB hang |
| Logging and redaction tests | PASS | JSON fields; levels; Nest contract; pretty format; deep key redaction; URL and bearer masking; request-ID correlation; incoming ID reuse and validation; no passwords/tokens/cookies/bodies/query strings in logs; 5xx logged exactly once, redacted |
| Smoke tests | PASS | see table above |
| Workflow syntax | PASS | actionlint 0 errors |
| GitHub Actions run | **NOT RUN** | no remote / no commits |
| Mobile ↔ live API contract test | NOT RUN | unchanged since its last pass (5/5); not part of CI |
| iOS native build | NOT RUN | mobile code unchanged since the last successful build (`evidence/ios-build.log`) |
| Android native build | **BLOCKED** | no JDK / Android SDK |

**Total automated tests in the final state: 162 passed, 0 failed.**

Assertion changes: one existing assertion was **extended**, not weakened. The readiness body now includes `service: "krevia-api"`, so `auth.e2e-spec.ts` expects that field too. No tests were deleted or skipped.

Data safety: development data was verified intact after all runs (`krevia_dev`: 6 societies, 8 users, 6 membership requests, 2 migrations). Destructive steps touched only `krevia_test` and `krevia_e2e_test`.

## Tools installed on the build machine
* `actionlint` 1.7.12 (Homebrew), used to validate the workflow.

## Remaining blockers and limitations
* **Remote CI unverified.** To activate: create the GitHub repository, add it as `origin`, commit and push `main`. No secrets are needed.
* **Android native build blocked.** Install steps are in README §15. CI covers the Android JS bundle only.
* Workflow `run:` blocks not shellchecked (`shellcheck` not installed).
* The original task brief was truncated at "3. Local test environment definition"; this work follows sections 1–2 and treats localhost as the test environment, as the rules require.
* Deferred product modules (OTP/SMS, visitors, payments, etc.) are intentionally untouched.
