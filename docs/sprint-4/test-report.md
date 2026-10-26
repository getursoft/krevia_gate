# Krevia — Sprint 4 test report

**Sprint:** Visitor & Gate Workflow · **Date:** 26 Oct 2026
**Verdict: PASS WITH BLOCKERS** — all automated checks pass; the only blocker is the inherited Sprint 2 messaging provider (see [known-limitations.md](known-limitations.md)).

Related: [Implementation report](implementation-report.md) · [Security report](security-report.md)

---

## 1. Environment

| Item | Value |
|---|---|
| OS | macOS (darwin) |
| Database | PostgreSQL 17.10, localhost:5432 |
| API test DB | `krevia_test` — dropped and recreated from all 5 migrations on every run |
| E2E DB | `krevia_e2e_test` — reset and seeded by Playwright `global-setup` |
| Dev DB | `krevia_dev` — Sprint 4 migration applied after a backup; no data reset |
| Node / package manager | Node ≥ 22; pnpm workspace |
| Test runners | Jest (API, shared, web unit, mobile), Playwright (web e2e) |

`scripts/prepare-test-db.js` refuses a database name that does not end in `_test`, so the API test run cannot touch `krevia_dev`. The Playwright setup has the same guard.

## 2. Automated suites

| Command | Suites | Tests | Result |
|---|---|---|---|
| `pnpm test:api` | 8 | 166 | **PASS** (0 failed) |
| `pnpm test:shared` | 2 | 30 | **PASS** (0 failed) |
| `pnpm test:web:unit` | 1 | 16 | **PASS** (0 failed) |
| `pnpm test:mobile` | 6 | 43 | **PASS** (0 failed) |
| `pnpm test:e2e` (Playwright) | 5 files | 20 | **PASS** (0 failed) |
| `pnpm typecheck` | 4 workspaces | — | **PASS** |
| `pnpm lint` | 4 workspaces | — | **PASS** (0 errors) |
| `pnpm build` | shared + API + web | — | **PASS** |

Sprint 4 adds **24 API scenarios**, **4 shared validation tests**, **5 mobile tests**, **2 Playwright tests**, and updates the existing role-routing and guard-console tests. No existing test was deleted or weakened; the Sprint 1–3 counts (142 API, 26 shared, 16 web unit, 38 mobile) still pass inside the new totals.

### API suite breakdown

| Suite | Tests | Scope |
|---|---:|---|
| `sprint4-visitors.e2e-spec.ts` | **24** | Visitor lifecycle, isolation, audit, concurrency |
| `sprint2-security.e2e-spec.ts` | 51 | Accounts, invitations, memberships, permissions |
| `auth.e2e-spec.ts` | 29 | Sprint 1 auth and sessions |
| `resident.e2e-spec.ts` | 25 | Sprint 1 resident onboarding |
| `sprint3-directory.e2e-spec.ts` | 14 | Buildings, units, residents, CSV import |
| `observability.e2e-spec.ts` | 12 | Health, readiness, request ids, logs |
| `logger.spec.ts` | 8 | Structured logging and redaction |
| `password.spec.ts` | 3 | Hashing and verification |
| **Total** | **166** | |

## 3. Sprint 4 acceptance coverage — 24 scripted scenarios

Every scenario runs against real PostgreSQL rows and asserts both the API result and the persisted state; most also assert the audit event.

| # | Scenario | API / DB evidence | Audit |
|---:|---|---|---|
| 01 | Guard registers a visitor; unconfigured provider reported honestly | `201`, `created=true`, status `PENDING`, phone normalised to E.164, `Visitor` row + 1 `VisitorNotification` with `channel='none'`, `delivered=false` | `visitor.created` |
| 02 | Destination resident sees the pending request, phone masked, approves | List contains the row; `phone='+91******3210'`; `200`, status `APPROVED`, `decidedBy` = resident, note stored | `visitor.approved` |
| 03 | Resident rejects with a note | `200`, status `REJECTED`, `decisionNote='Not known'` | `visitor.rejected` |
| 04 | Duplicate approval refused; one audit transition only | Second call `409`; status stays `APPROVED`; exactly one `visitor.approved` event | single event |
| 05 | Retry with the same idempotency key returns the original | Second `201`, `created=false`, same visitor id, exactly 1 row for the key | — |
| 06 | Identical open registration without a key is refused | Second `409 CONFLICT`; exactly 1 row for the phone | — |
| 07 | Entry before approval refused; manual entry after approval | Entry on `PENDING` `409`; after approval `200`, status `ENTERED`, `entryMethod='MANUAL'`, `entryBy` = guard | `visitor.entered` |
| 08 | Duplicate entry scan refused | Second entry `409`; exactly one `visitor.entered` event | single event |
| 09 | Exit before entry refused | `409`; status remains `APPROVED` | — |
| 10 | Exit recorded on the same row; duplicate exit refused | `200`, status `EXITED`, `exitAt`, `exitBy`; second exit `409`; one `visitor.exited` | single event |
| 11 | Cancel with reason; later approval/entry refused | `200`, status `CANCELLED`, reason stored; approve `409`; entry `409` | `visitor.cancelled` |
| 12 | Unanswered request times out; approval refused | Expiry forced into the past; lazy sweep returns it under `status=TIMED_OUT`; approve `409` | `visitor.timed_out` |
| 13 | Resident cannot decide for another unit | `404`; status remains `PENDING` | — |
| 14 | Resident of another unit cannot list or fetch the visitor | Not in list; detail `404` | — |
| 15 | Foreign-society guard denied under foreign URL and by id substitution; foreign resident denied | `403` under society A; `404` under society B for GET and entry; foreign resident `403` | — |
| 16 | Guard cannot approve or override | Both `403`; status remains `PENDING` | — |
| 17 | Signed-in user with no society membership denied | `403` | — |
| 18 | Override requires a reason of at least 5 characters | `400`; status remains `PENDING` | — |
| 19 | Authorised override records reason, actor and audit; exit still works | `200`, status `ENTERED`, `entryMethod='OVERRIDE'`, `overrideReason`, `overriddenBy`; audit metadata reason matches; exit `200` → `EXITED` | `visitor.overridden` |
| 20 | Concurrent approvals: one success, one conflict | Two parallel calls return `200` and `409`; status `APPROVED`; exactly one `visitor.approved` | single event |
| 21 | Register filters by unit, category, status and date | Unit+category+status returns the delivery and excludes the other flat; same-day `dateFrom`/`dateTo` returns rows | — |
| 22 | Entry on rejected and exit on cancelled refused | Reject then entry `409`; cancel then exit `409` | — |
| 23 | Full lifecycle audit and gate destination picker | Audit contains created → approved → entered → exited; picker returns both units and **only** `id`, `tower`, `number`, `buildingName` (no resident PII) | 4 events |
| 24 | In-app request survives an unavailable provider | `delivered=false`, `channel='none'`; the request is still in the resident's pending list; notification row says undelivered | — |

**Result: 24/24 passed.**

### What is not covered because the capability does not exist

QR-pass scenarios (expired pass, reused pass, forged pass, scan-to-enter) are **N/A**. The repository has no QR-pass model, token, scanner or expiry, and Sprint 4 did not invent one. Gate entry is manual and is covered by scenarios 07–10, 19 and 22. Visitor CSV export is also not implemented and was not required.

## 4. Browser end-to-end tests

`apps/web/e2e/visitors.spec.ts` runs the real API and the real Next.js site against `krevia_e2e_test`:

| Test | Flow |
|---|---|
| Guard registers → resident approves → guard entry/exit → admin history | Guard registers in the browser, sees the live queue; resident signs in, approves; guard records entry then exit; admin searches the register, sees `Exited` / `Entered` / `manual entry`, and the API audit query finds `visitor.exited` for that visitor id |
| Admin emergency override | Guard creates a request through the API; admin searches it, accepts the mandatory-reason dialog, and sees `emergency override`, the reason and `Entered` |

The existing `roles.spec.ts` guard test was updated for the real gate console: it now asserts the "Live Gate Entry" heading, the live queue's empty state, the guard sidebar and the `Security` society chip, and still asserts that `/admin` is denied.

**Full Playwright run: 20/20 passed** across `account-security`, `roles`, `visitors`, `website` and `responsive`.

The e2e setup creates its own tower, flat, resident account and invitation through the API, so it does not depend on demo resident data. Tests run serially (`workers: 1`) because they share the seeded database.

## 5. Migration and rollback verification

| Check | Result |
|---|---|
| Backup before applying to `krevia_dev` | `backups/krevia_dev_pre_sprint4_20261026_180440.dump` (62 KB, custom format) |
| `prisma migrate deploy` on `krevia_dev` | Applied `20261026120000_sprint4_visitor_gate` |
| `prisma migrate status` | **Database schema is up to date** (5 migrations) |
| Test database | All 5 migrations applied from scratch on every `pnpm test:api` run |
| Rollback on scratch DB `krevia_rollback_s4` | 0 `Visitor`/`VisitorNotification` tables and 0 Sprint 4 enum types after the down script; scratch DB dropped |
| `prisma migrate diff` | Exit 2 only for the pre-existing trigram indexes (`Society_name_trgm_idx`, `Society_city_trgm_idx`) that are intentionally absent from `schema.prisma`; unrelated to Sprint 4 |

The rollback was not run against `krevia_dev`; the scratch-database exercise proves the down script is valid without risking development data.

## 6. Benign log noise observed

The API test log contains `Unique constraint failed` lines from `floor.create` and `resident.create` in the Sprint 3 suites. These are expected: those tests deliberately exercise duplicate handling and assert the API's `409`. They are not failures and do not affect Sprint 4.

## 7. Failures found and fixed during Sprint 4 verification

These were found by the new tests and fixed before the final run. They are recorded so the report does not hide the path to green.

| Failure | Root cause | Fix | Final evidence |
|---|---|---|---|
| Scenario 21 returned no rows for `dateFrom=dateTo=today` | A date-only `dateTo` was coerced to midnight, excluding the rest of the day | `visitorListSchema` expands a bare `YYYY-MM-DD` `dateTo` to `T23:59:59.999Z`; a shared unit test covers it | Scenario 21 and the shared validation suite pass |
| Visitor e2e setup returned `400` at registration | The fixture full name `E2E Resident 123456` contained digits, which the existing name validator correctly rejects | Fixture changed to a letters-only name | Visitor e2e passes |
| Visitor e2e admin step timed out on "Search visitors" | The test navigated to `/admin/visitors` before the admin login POST completed, so the session cookie was not set and the page redirected to login | Added `await expect(page).toHaveURL(/\/admin$/)` after login | Visitor e2e passes |
| Early API run failed to compile the test helper | The helper's default argument inferred `{}` instead of the visitor body | Typed the helper return as `Record<string, unknown>` and used `body()` as the default | API suite 166/166 |

No product behaviour was changed to make a test pass except the `dateTo` correction, which is a genuine bug fix for same-day filtering.

## 8. Checks that were not run

| Check | Reason |
|---|---|
| QR pass scenarios | No QR system exists (reported N/A) |
| Physical iOS/Android device or simulator | Mobile verified by TypeScript and Jest only in this sprint |
| CI pipeline | All runs are local; CI config exists but was not executed here |
| Production deployment | No deployment target; localhost only |
| Load / soak testing | Not required for Sprint 4; concurrency is covered by scenario 20 |

## 9. Conclusion

All executable Sprint 4 checks pass: 24 API scenarios, 2 browser workflows, 30 shared, 16 web unit and 43 mobile tests, plus typecheck, lint and production build. Tenant isolation, lifecycle concurrency, audit coverage and honest notification reporting are verified. The inherited messaging blocker keeps the verdict at **PASS WITH BLOCKERS**.
