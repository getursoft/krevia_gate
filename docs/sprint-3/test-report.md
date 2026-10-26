# Krevia — Sprint 3 test report

**Sprint:** Society Buildings, Units & Resident Directory · **Date:** 26 Oct 2026
**Verdict: PASS WITH BLOCKERS** — all automated checks pass; the only blocker is the Sprint 2 messaging provider (see [known-limitations.md](known-limitations.md)).

Related: [Implementation report](implementation-report.md) · [Security report](security-report.md)

---

## 1. Environment

| Item | Value |
|---|---|
| OS | macOS (darwin) |
| Database | PostgreSQL 17.10, localhost:5432 |
| API test DB | `krevia_test` — dropped and recreated from migrations on every run |
| Dev DB | `krevia_dev` — migration applied after a backup; no data reset |
| Node / package manager | Node per repo `.nvmrc`; pnpm workspace |
| Test runner | Jest (API/shared/mobile/web unit), Playwright (web e2e) |

`scripts/prepare-test-db.js` refuses a database name that does not end in `_test`, so the test run cannot touch `krevia_dev`.

## 2. Automated suites

| Command | Suites | Tests | Result |
|---|---|---|---|
| `pnpm test:api` | 7 | 142 | **PASS** (0 failed) |
| `pnpm test:shared` | 2 | 26 | **PASS** |
| `pnpm test:web:unit` | 1 | 16 | **PASS** |
| `pnpm test:mobile` | 5 | 38 | **PASS** |
| **Total** | **15** | **222** | **PASS** |

Static and build checks:

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS (4 workspaces) |
| `pnpm lint` | PASS (4 workspaces) |
| `pnpm build` | PASS (shared, API, web) |
| `prisma migrate status` (dev) | PASS — schema up to date |

### API suite breakdown

| Suite | Tests |
|---|---|
| `sprint3-directory.e2e-spec.ts` | 14 |
| `sprint2-security.e2e-spec.ts` | 26 |
| `auth.e2e-spec.ts` | 30 |
| `resident.e2e-spec.ts` | 14 |
| `observability.e2e-spec.ts` | 12 |
| `logger.spec.ts` (unit) | 4 |
| `password.spec.ts` (unit) | 6 |
| **Total** | **142** |

## 3. Sprint 3 acceptance coverage

`apps/api/test/sprint3-directory.e2e-spec.ts` — 14 tests against a real PostgreSQL database, using two societies (A and B) and real sessions for admin, resident and guard.

### Buildings, floors and units (4)

1. Creates a building and floor, rejects a duplicate floor, and creates a unit on it.
2. Renames and moves a unit, then archives and restores it.
3. Refuses to archive an occupied unit.
4. Refuses to archive a building with active units, then succeeds after archiving them.

### Resident directory (3)

5. Creates a household member, enforces unique phones, and returns admin-only details (emergency contacts).
6. Returns only the resident's own profile and **masked** household contacts; no emergency contacts.
7. Ends a resident-unit link together with its authenticated assignment.

### CSV import (4)

8. Serves the template and rejects a malformed header.
9. Imports **100 rows**, then treats the same file and confirmation as idempotent (same job, same counts, no duplicates).
10. Marks duplicate and invalid rows and produces a **formula-safe** error report.
11. Does not import a row that references another society.

### Tenant isolation and roles (3)

12. Denies residents and guards the admin directory (403).
13. Answers **404** when a Society A admin substitutes Society B ids under the A URL (reads and writes).
14. Cannot read or confirm another society's CSV import or its error report (404).

The 100-row test asserts the exact created/skipped/rejected counts and that a second confirm returns the original job rather than re-inserting rows.

## 4. Browser end-to-end tests

`pnpm test:e2e` runs the existing Playwright suite (Sprint 1/2) against the real API and website using the isolated `krevia_e2e_test` database. It covers registration, login, password reset, invitations, role dashboards, responsive layout, profile and logout.

**Result: 18 passed / 0 failed** (1.3 min), including the Sprint 2 invitation flow that uses the rewritten `/admin/units` page.

```text
Running 18 tests using 1 worker
  ✓  1  account-security › password reset with a one-time code signs in with the new password
  ✓  2  account-security › an invited resident registers through the invite link, accepts, and the admin manages the membership
  ✓  3  account-security › a signed-in user with a different number cannot accept someone else's invitation
  ✓  4  account-security › guards and residents cannot open resident management; the API refuses them too
  ✓  5–7  roles › society admin / guard / resident dashboards and menus
  ✓  8–13 website › landing page and authentication
  ✓  14–16 website › resident journey
  ✓  17 website › profile and logout
  ✓  18 responsive › landing page and dashboard at phone width
18 passed (1.3m)
```

The first full run exposed a **real regression**: the Sprint 2 helper selected the tower by value (`'T2'`) and expected the old success text `Unit T2-<flat> added.`, but the rewritten Units page now uses building ids as option values and reports `Unit <number> added.`. The helper was updated to select by label and assert the new message; the affected spec then passed, and the full suite passed. This is exactly the kind of breakage the regression suite exists to catch.

No Sprint 3-specific Playwright spec was added. Sprint 3 browser flows (buildings, units, resident directory, CSV import, household page) were exercised manually through the web build; the automated coverage for Sprint 3 is the API integration suite above plus the web unit tests. This is recorded as a coverage limitation, not a failure.

## 5. Migration and rollback verification

| Check | Result |
|---|---|
| Apply migration to fresh `krevia_test` | PASS — all 4 migrations applied |
| Apply migration to existing `krevia_dev` | PASS — `migrate deploy` applied only Sprint 3 |
| `prisma migrate status` after deploy | PASS — up to date |
| Backup before dev migration | PASS — `backups/krevia_dev_pre_sprint3_20261026_171943.dump` (PG 17.10 `pg_dump -Fc`) |
| Rollback on scratch DB `krevia_rollback_check` | PASS — all 4 migrations applied, rollback ran with `ON_ERROR_STOP=1`, directory tables removed, `Unit` returned to Sprint 2 columns |
| Scratch DB cleanup | PASS — dropped after the check |

The rollback is schema-only; `_prisma_migrations` still records the migration, so an operator must also mark it rolled back. This is documented in the rollback file header.

`prisma migrate diff --from-url … --to-schema-datamodel … --exit-code` exits `2` because the database has two **pre-existing** GIN trigram indexes (`Society_name_trgm_idx`, `Society_city_trgm_idx`) created by the `init` migration in raw SQL and intentionally not modelled in `schema.prisma`. No Sprint 3 table, column, index or constraint is missing from the schema. This is not new drift.

## 6. Benign log noise observed

During the API run the logger prints two handled Prisma `P2002` errors:

* duplicate floor creation (the test expects `409`);
* duplicate resident phone (the test expects `409`).

Both are caught and mapped to conflict responses; the tests pass. They are logged at `error` level by the global Prisma error hook, which makes a passing run look noisier than it is. No action was taken in this sprint.

## 7. Checks that were not run

| Check | Reason |
|---|---|
| Sprint 3 Playwright specs | None exist; adding them was out of scope for this sprint |
| Mobile device/emulator run | Unit tests and typecheck pass; no simulator session was part of this verification |
| Production deployment | No deployment target in this environment |
| SMS/email delivery | No provider configured (Sprint 2 blocker) |

## 8. Conclusion

Every runnable automated check passes: **222 Jest tests + 18 Playwright tests**, typecheck, lint, build and migration status. Sprint 3's acceptance scenarios — including 100-row import, idempotency, malformed CSV, formula-safe error report and cross-society isolation — pass against a real database. The verdict remains **PASS WITH BLOCKERS** solely because of the inherited Sprint 2 messaging provider gap.
