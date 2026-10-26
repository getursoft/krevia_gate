# Krevia — Sprint 3 security report

**Sprint:** Society Buildings, Units & Resident Directory · **Date:** 26 Oct 2026
**Verdict: PASS WITH BLOCKERS**. No critical or high security finding was introduced by Sprint 3. All cross-society read/write, CSV preview/confirm and error-report isolation tests pass against a real PostgreSQL database. The release blocker is operational and inherited from Sprint 2: no SMS/email provider is configured, so in production invitation links and password-reset codes are not delivered.

Related: [Implementation report](implementation-report.md) · [Test report](test-report.md) · [Known limitations](known-limitations.md) · [Sprint 2 security report](../sprint-2/security-report.md)

---

## 1. Security model in one page

* **Identity** comes only from the server-validated session cookie (opaque token, SHA-256 hash stored). No identity is read from a body, query or client claim.
* **Society role** comes from `Membership` rows with `status = ACTIVE` for `(userId, societyId)`, read from the database on **every** request. Suspension/revocation applies immediately.
* **Permission** comes from the central matrix in `packages/shared/src/permissions.ts`, enforced by `PermissionGuard` → `SocietyAccessService.authorize()`.
* **Platform administrators** hold platform permissions only; they have no implicit access to any society's data.
* **Tenant scoping** is applied twice: every query includes `societyId` (from the URL, never from the body), and composite foreign keys in PostgreSQL make cross-society rows impossible to insert even via direct SQL.
* **Denials and sensitive actions** are written to the append-only `AuditEvent` table.

## 2. Role–permission matrix (Sprint 3 additions in bold)

| Permission | Resident | Guard | Society admin | Platform admin |
|---|:-:|:-:|:-:|:-:|
| `society.read` | ✓ | – | ✓ | – |
| `household.read` | ✓ | – | – | – |
| `security.access` | – | ✓ | – | – |
| **`building.read`** | – | – | ✓ | – |
| **`building.manage`** | – | – | ✓ | – |
| `unit.read` | – | – | ✓ | – |
| `unit.create` / `unit.assign` | – | – | ✓ | – |
| **`resident.read`** | – | – | ✓ | – |
| **`resident.manage`** | – | – | ✓ | – |
| **`resident.import`** | – | – | ✓ | – |
| `audit.read` / `data.export` | – | – | ✓ | – |
| `membership.*` | – | – | ✓ | – |
| Platform permissions | – | – | – | ✓ |

Key negative cases, covered by tests:

* A resident cannot list buildings, units or residents, cannot import, and cannot read another resident's detail (`403`).
* A guard has no directory, building, unit-admin or resident permission (`403`).
* A platform administrator with no membership in a society gets `403` on that society's directory routes.

## 3. Tenant isolation

### 3.1 Application layer

Every Sprint 3 route is mounted under `societies/:societyId` and resolves `SocietyContext` from the session + database membership. Resource lookups always add the society predicate, e.g.:

* `unit.findFirst({ where: { id, societyId } })`
* `resident.findFirst({ where: { id, societyId } })`
* `residentImportJob.findFirst({ where: { id, societyId } })`
* building/floor lookups include `societyId`.

Substituting a Society B id under a Society A URL therefore returns **404**, not another society's data. This is tested for reads and writes, including CSV preview/confirm and the error report.

### 3.2 Database layer

The migration adds defence in depth that survives an application bug:

| Control | Effect |
|---|---|
| Composite FK `Unit(buildingId, societyId) → Building(id, societyId)` | A unit cannot point at another society's building. |
| Composite FK `Unit(floorId, societyId) → Floor(id, societyId)` | A unit cannot point at another society's floor. |
| Trigger `Unit_floor_building_guard` | A unit's floor must belong to the unit's building and society. |
| Composite FKs `ResidentUnit(residentId, societyId)` and `(unitId, societyId)` | A resident-unit link cannot mix societies. |
| Composite FK `Floor(buildingId, societyId)` | A floor cannot belong to another society's building. |
| Unique `(societyId, phone)` / `(societyId, userId)` on `Resident` | No duplicate person within a society; the same phone can exist in two societies without leaking. |
| Unique `(societyId, fileHash)` on `ResidentImportJob` | Import idempotency is per tenant; one society cannot collide with another's job. |
| Partial unique indexes | One active link per resident/unit; at most one primary resident per unit. |
| Check constraints | Phone format, unit-number format, floor range, date order, non-negative counts. |

### 3.3 CSV import isolation

* The file hash is scoped by `societyId`, so an identical file uploaded to Society B creates a separate job.
* Rows are resolved to units and residents **only** with `societyId` in the `where` clause. A row naming a unit in another society is rejected.
* A Society A admin cannot read, confirm or download the error report of a Society B job (`404`), even with the job id.
* Confirm re-validates the unit and resident inside the transaction, so a unit archived or moved between preview and confirm is rejected rather than imported.

## 4. CSV-specific controls

| Risk | Control |
|---|---|
| Oversized upload / memory exhaustion | `text/csv` body parser limited to **2 MB**; service also checks UTF-8 byte length; max **5000** data rows. |
| Formula injection in exported reports | `csvCell` prefixes `'` when a cell starts with `=`, `+`, `-`, `@`, tab or CR. Applied to every exported cell, including the error report. |
| CSV parsing ambiguity | RFC-4180-style parser with quoted fields, escaped quotes and CRLF/LF handling; malformed quoting is a validation error. |
| Silent data overwrite | A conflicting phone/name is rejected; non-empty resident fields are never overwritten. |
| Duplicate imports / retries | SHA-256 `(societyId, fileHash)` idempotency; atomic `PREVIEWED → IMPORTING` claim; a completed job returns its original result. |
| Partial import | Valid rows import in **one transaction**; a failure rolls the whole confirm back and marks the job `FAILED`. |
| Cross-tenant probing via ids | All job/unit/resident lookups are tenant-scoped; foreign ids return `404`. |
| Abuse / brute force | Global throttler (600 requests/min per IP); import requires an authenticated ACTIVE admin membership. |

The error report contains the rejected row's data (name, phone, unit) by design, so it is restricted to `resident.import` holders and tenant-scoped.

## 5. PII exposure

| Surface | Who | What is exposed |
|---|---|---|
| `GET /residents/:residentId` | Society admin (`resident.read`) | Full profile, emergency contacts, vehicles, units |
| `GET /residents` | Society admin | Directory fields; emergency contacts included in the admin DTO |
| `GET /my-household` | The resident themself (`household.read`) | Own profile; co-residents' names and **masked** phones (`+91••••••1234`); **no** emergency contacts, email or vehicles of others |
| CSV error report | Society admin (`resident.import`) | Rejected rows for that society only |
| Audit log | Society admin (`audit.read`) | Action metadata; not a bulk PII export |

A resident who is not linked to a unit gets `{ resident: null, units: [] }` rather than another person's record.

## 6. Audit coverage

Sprint 3 actions written to the append-only audit log:

`building.created`, `building.updated`, `building.archived`, `floor.created`, `floor.updated`, `floor.deleted`, `unit.created`, `unit.updated`, `unit.archived`, `unit.restored`, `unit.assigned`, `unit.unassigned`, `resident.created`, `resident.updated`, `resident.archived`, `resident.unit_linked`, `resident.unit_updated`, `resident.unit_unlinked`, `resident.import.previewed`, `resident.import.completed`, `resident.import.failed`.

Denied attempts are recorded as `authz.denied` with `outcome = DENIED`, rate-limited to avoid log flooding. Existing Sprint 2 actions (auth, invitations, memberships, exports) are unchanged.

## 7. Findings

| Severity | Finding | Status |
|---|---|---|
| **Blocker (operational, inherited)** | No SMS/email provider is configured. In production (`MESSAGE_DELIVERY=none`) invitation links and password-reset codes are generated but not delivered. | Open. Needs provider credentials + DLT template registration (TRAI). Sprint 3 does not change this. |
| Low | No dedicated per-admin rate limit on CSV preview/confirm beyond the global 600 req/min per IP. A malicious admin could create many import jobs. | Accepted. Impact is bounded by the 2 MB / 5000-row limits and admin-only permission; jobs are tenant-scoped. |
| Low | The CSV error report intentionally includes rejected PII for the importing society. | Accepted. Restricted to `resident.import`; documented for admins. |
| Low | `Resident` stores vehicles as JSONB with only an "is array" check. | Accepted. Values are validated by the Zod schema on write; no query depends on their shape. |
| Info | A handled Prisma `P2002` is logged at `error` level for expected duplicate conflicts. | Accepted. Does not affect security; noted in the test report. |
| Info | PostgreSQL cannot remove the `HOUSEHOLD` enum label during rollback. | Accepted. Sprint 2 code never writes it; documented in the rollback header. |

No critical or high finding is open. No authentication, authorisation, tenant-isolation or audit control was weakened in this sprint.

## 8. Sprint 2 blocker carried forward

The Sprint 2 verdict was **PASS WITH BLOCKERS** because `MESSAGE_DELIVERY` has no real provider in production. Sprint 3 adds CSV import, so an admin can onboard a directory without invitations, but residents still cannot receive an invitation link or reset their password in production. This remains a release blocker and is not silently resolved. It is repeated in [known-limitations.md](known-limitations.md) and the implementation report.

## 9. Verdict

**PASS WITH BLOCKERS.**

Sprint 3's security-relevant requirements are met and tested: central permission enforcement, resident/guard denial, cross-society read/write isolation, CSV tenant isolation, idempotent imports, formula-safe exports, PII minimisation for residents, and audit logging. The unqualified PASS is withheld only because the inherited production messaging gap is still open.
