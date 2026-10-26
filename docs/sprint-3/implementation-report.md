# Krevia — Sprint 3 implementation report

**Sprint:** Society Buildings, Units & Resident Directory · **Branch:** `sprint-2/secure-society-accounts` · **Date:** 26 Oct 2026
**Verdict: PASS WITH BLOCKERS**. All Sprint 3 acceptance and tenant-isolation tests pass against a real PostgreSQL database. The only open blocker is carried over from Sprint 2: no SMS/email provider is configured, so in production invitation links and password-reset codes are generated but not delivered (see [known-limitations.md](known-limitations.md) and [security-report.md](security-report.md) §8).

Related: [Test report](test-report.md) · [Security report](security-report.md) · [Known limitations](known-limitations.md) · [Sprint 2 report](../sprint-2/security-report.md)

---

## 1. Repository state before Sprint 3

| Item | State |
|---|---|
| Branch | `sprint-2/secure-society-accounts` (last commit `928e387`, Sprint 1) |
| Working tree | Sprint 2 and Sprint 3 changes are **uncommitted**; no Sprint 3 work was committed |
| Sprint 2 state | Implemented and verified; `PASS WITH BLOCKERS` (SMS/email provider not configured) |
| Baseline checks | `pnpm test:api` 128 passed; `pnpm typecheck` passed |
| Databases | `krevia_dev` (development data preserved), `krevia_test` (recreated per test run), `krevia_e2e_test` (Playwright) |

No existing table was dropped, truncated or recreated. The only destructive operation in the test pipeline is the intentional reset of the isolated `_test` schema by `scripts/prepare-test-db.js`.

## 2. What was built

### 2.1 Data model

Extends the existing entities rather than duplicating them:

| Entity | Purpose |
|---|---|
| `Building` | A tower / block. `Society.towers` remains the legacy label list; every tower now has a `Building` row. Unique `(societyId, name)`. |
| `Floor` | A floor inside a building. `level` 0 = ground; optional human `name`. Unique `(buildingId, level)`. |
| `Unit` (extended) | Gains required `buildingId`, optional `floorId`, `status` (`ACTIVE`/`ARCHIVED`), `archivedAt`, `updatedAt`. Legacy `tower` is kept and mirrored from `Building.name`. Unique `(buildingId, number)` added alongside the existing `(societyId, tower, number)`. |
| `Resident` | A person in the society directory, optionally linked to a `User` account. Unique `(societyId, phone)` and `(societyId, userId)`. Holds emergency contacts and vehicles. |
| `ResidentUnit` | Resident ↔ unit link with relationship (`OWNER`/`TENANT`/`HOUSEHOLD`), primary flag, dates and optional `assignmentId`. |
| `ResidentImportJob` | CSV preview/confirm state, row results, counts and errors. Unique `(societyId, fileHash)` makes retries idempotent. |

`OccupancyType` gains `HOUSEHOLD`; new enums `UnitStatus`, `ResidentStatus`, `ImportJobStatus`.

The existing `UnitAssignment` (authenticated resident ↔ unit) is **kept** and synchronised with `ResidentUnit` through `apps/api/src/residents/resident-sync.ts`, so Sprint 1/2 flows and the new directory stay consistent without a circular dependency.

### 2.2 Migration

`apps/api/prisma/migrations/20261026090000_sprint3_resident_directory/migration.sql`

* Creates the new tables, enums, indexes and constraints.
* Backfills a `Building` for every `Society.towers` label and for every legacy `Unit.tower` that was not listed.
* Sets `Unit.buildingId` from the matching building, canonicalises `Unit.tower`, then makes `buildingId` `NOT NULL`.
* Backfills `Resident` rows from `UnitAssignment` + `Membership` + `User`, and `ResidentUnit` rows from existing assignments.
* Adds tenant-integrity constraints that Prisma cannot express: composite foreign keys, partial unique indexes (one active link per resident/unit; one primary resident per unit), phone/number/date check constraints, and a trigger that a unit's floor belongs to the unit's building and society.

Rollback: `apps/api/prisma/rollback/20261026090000_sprint3_resident_directory.down.sql` (added and verified on a scratch database; see [test-report.md](test-report.md) §5). PostgreSQL cannot remove the `HOUSEHOLD` enum label, so the rollback leaves it in place; the Sprint 2 application never writes it.

**Applied to:**
* `krevia_test` — automatically by every `pnpm test:api` run.
* `krevia_dev` — via `prisma migrate deploy`, after a PostgreSQL 17 `pg_dump` backup at `backups/krevia_dev_pre_sprint3_20261026_171943.dump` (40 KB). `prisma migrate status` now reports *Database schema is up to date!*

### 2.3 API

All routes are under `/api/v1/societies/:societyId` and require an ACTIVE membership in that society. New permissions are `building.read`, `building.manage`, `resident.read`, `resident.manage`, `resident.import` (admin), and `household.read` (resident).

**Buildings / floors** (`buildings.controller.ts`)
* `GET /buildings` — list with unit/floor counts.
* `POST /buildings` — create a tower/block.
* `GET /buildings/:buildingId` — building, floors and units.
* `PATCH /buildings/:buildingId` — rename; units and `Society.towers` are updated in the same transaction.
* `POST /buildings/:buildingId/archive` — refuses while active units exist.
* `POST /buildings/:buildingId/floors`, `PATCH …/floors/:floorId`, `DELETE …/floors/:floorId` — floor management.

**Units** (`units.controller.ts`, rewritten)
* `GET /units` — filters by building, floor, status and search; paginated.
* `POST /units` — create on a building/floor; a legacy tower name is resolved or backfilled.
* `GET /units/:unitId`, `GET /my-units`.
* `PATCH /units/:unitId` — rename, move building/floor, change status.
* `POST /units/:unitId/archive` / `restore` — archive refuses while an active resident link exists.
* `POST /units/:unitId/assignments`, `DELETE …/assignments/:assignmentId` — authenticated assignment, now also synced to the directory.

**Resident directory** (`residents.controller.ts`, `residents.service.ts`)
* `GET /residents` — search/filter/paginate (admin).
* `POST /residents`, `PATCH /residents/:residentId`, `POST /residents/:residentId/archive`.
* `GET /residents/:residentId` — admin-only detail including emergency contacts.
* `POST/PATCH/DELETE /residents/:residentId/units…` — link, change and end resident-unit relationships.
* `GET /my-household` — the signed-in resident's own units and co-residents, with **masked** phone numbers and no emergency contacts.

**CSV import** (`resident-import.service.ts`)
* `GET /residents/import/template` — downloadable template (Tower/Block, Floor, Unit Number, Resident Name, Mobile Number, Email, Relationship, Primary, Emergency Contact Name/Phone, Vehicles).
* `GET /residents/imports`, `GET /residents/imports/:jobId`.
* `POST /residents/imports/preview` — accepts `text/csv` (max 2 MB, max 5000 rows), validates and returns a per-row preview without writing to the directory.
* `POST /residents/imports/:jobId/confirm` — imports valid rows in **one transaction**, re-validating units and residents; returns created/updated/skipped/rejected counts.
* `GET /residents/imports/:jobId/errors.csv` — downloadable rejected-row report.

**Import behaviour**
* Idempotent by SHA-256 file hash per society: re-uploading the same file returns the original preview; re-confirming a completed job returns the original result.
* A second concurrent confirm is rejected by an atomic `PREVIEWED → IMPORTING` claim.
* Conflicting phone/name is rejected, never silently overwritten. Non-empty resident fields are not overwritten by CSV data.
* Rows that reference another society are rejected (no cross-tenant lookup).
* The error report is formula-safe: cells beginning `=`, `+`, `-`, `@`, tab or CR are prefixed with `'`.

### 2.4 Web UI

| Route | What it does |
|---|---|
| `/admin/buildings` | Towers/blocks, floors, unit counts, rename, archive, add floor |
| `/admin/units` | Filters, create unit, move/rename, archive/restore, assign/remove resident |
| `/admin/residents` | Searchable directory, create resident, archive, open detail |
| `/admin/residents/[residentId]` | Profile, units and relationships, emergency contacts, vehicles |
| `/admin/residents/import` | Template download, file upload, validation preview, confirm, counts, error-report download |
| `/resident/household` | Read-only household view with masked co-resident phones |

Admin navigation gains **Buildings**, **Residents** and **Import residents**; the existing **Units** page is replaced.

### 2.5 Mobile UI

* New `HouseholdScreen` and `/household` route; the resident `family` nav item now opens it.
* Mobile shows the signed-in resident's units and household members (masked phones), matching the web resident view.
* No mobile admin directory UI was added; admin directory management remains web-only in this sprint.

### 2.6 Shared contracts

`packages/shared` gains the DTOs, Zod schemas, API-client methods, permission constants and navigation entry (`household`) used by web, mobile and the API tests. `HOUSEHOLD` was added to the occupancy label map.

### 2.7 Seed and test fixtures

* `apps/api/prisma/seed.ts` upserts a `Building` for each sample tower, so seeded societies have usable buildings.
* `apps/api/test/helpers.ts` resets the new tables between tests in the correct dependency order.

## 3. Verification performed

| Check | Result |
|---|---|
| `pnpm test:api` | **142 passed / 0 failed**, 7 suites |
| `pnpm test:shared` | **26 passed / 0 failed** |
| `pnpm test:web:unit` | **16 passed / 0 failed** |
| `pnpm test:mobile` | **38 passed / 0 failed** |
| `pnpm typecheck` | Passed (all 4 workspaces) |
| `pnpm lint` | Passed (all 4 workspaces) |
| `pnpm build` | Passed (API + web) |
| `prisma migrate status` (dev) | Database schema is up to date |
| Rollback script | Applied cleanly on a scratch database; schema returned to Sprint 2 shape |
| Playwright (`pnpm test:e2e`) | **18 passed / 0 failed**. The run caught one Sprint 2 helper regression caused by the Units page rewrite; the helper was fixed and the suite re-ran green. No Sprint 3 Playwright specs were added. |

## 4. Files added or changed (high level)

**API:** `src/buildings/`, `src/residents/`, `src/units/`, `src/authz/`, `src/audit/`, `src/members/`, `src/invitations/`, `src/messaging/`, `src/auth/password-reset.service.ts`, `src/app.module.ts`, `src/bootstrap.ts`, `prisma/schema.prisma`, `prisma/seed.ts`, `prisma/migrations/20261026090000_sprint3_resident_directory/`, `prisma/rollback/20261026090000_sprint3_resident_directory.down.sql`, `test/sprint3-directory.e2e-spec.ts`, `test/helpers.ts`.

**Web:** `app/(app)/admin/buildings/`, `admin/units/`, `admin/residents/`, `resident/household/`, `components/AdminSociety.tsx`, plus navigation/role updates.

**Mobile:** `app/(app)/household.tsx`, `src/screens/RoleScreens.tsx`, `src/lib/nav.ts`, `src/components/ui.tsx`.

**Shared:** `validation.ts`, `types.ts`, `api-client.ts`, `permissions.ts`, `navigation.ts`, `index.ts`, `brand.ts`, tests.

**Docs/infra:** `README.md`, `apps/api/.env.example`, `pnpm-lock.yaml`.

## 5. Verdict

**PASS WITH BLOCKERS.**

Sprint 3 scope is implemented and verified end to end: schema, migration and rollback; buildings/floors/units; the resident directory; CSV import with preview, confirm, counts, idempotency and a formula-safe error report; web and mobile UI; permission enforcement; tenant isolation; audit logging; and 14 Sprint 3 integration tests against PostgreSQL.

The blocker is not in Sprint 3 code: the Sprint 2 operational blocker remains. With `MESSAGE_DELIVERY=none` in production, invitation links and password-reset codes are generated but not delivered. Sprint 3's CSV import and directory do not depend on messaging, but the sprint cannot be called production-ready while onboarding invitations cannot reach residents. No Sprint 3-specific blocker was found.
