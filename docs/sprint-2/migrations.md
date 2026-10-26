# Sprint 2 — database migration and rollback

Migration: `apps/api/prisma/migrations/20261021090000_sprint2_secure_accounts/migration.sql`
Rollback: `apps/api/prisma/rollback/20261021090000_sprint2_secure_accounts.down.sql`

## What the migration does

| Change | Detail |
|---|---|
| New enums | `MemberRole` (RESIDENT, ADMIN, GUARD), `MemberStatus` (ACTIVE, SUSPENDED, REVOKED), `InvitationStatus` (PENDING, ACCEPTED, REVOKED, EXPIRED), `AuditOutcome` (SUCCESS, FAILURE, DENIED) |
| `MembershipStatus` | gains `REVOKED` (a join request whose membership was later revoked) |
| `Membership` | user ↔ society ↔ role, with status. Unique `(userId, societyId, role)`; unique `(id, societyId)` as a composite-FK target; index `(societyId, role, status)` |
| `UnitAssignment` | resident ↔ unit. **Composite foreign keys** `(unitId, societyId) → Unit(id, societyId)` and `(membershipId, societyId) → Membership(id, societyId)`: the database rejects any assignment that mixes societies. Partial unique index: one open assignment per (membership, unit). Check: `endedAt ≥ assignedAt` |
| `Invitation` | phone-bound invitation; only `tokenHash` (SHA-256) is stored. Composite FK to the unit's society. Partial unique index: one PENDING invitation per (society, phone, role). Checks: E.164 phone; residents need unit + occupancy, staff must not have them |
| `PasswordResetCode` | HMAC of the code (keyed with `AUTH_PEPPER`), expiry, attempt counter (`attempts ≥ 0` check), consumption time |
| `AuditEvent` | append-only trail with indexes on `(societyId, createdAt)`, `(actorUserId, createdAt)`, `(action, createdAt)`. No foreign keys, so events outlive users and societies. **Trigger** `AuditEvent_no_update_delete` rejects every `UPDATE` and `DELETE` |
| `Session.activeSocietyId` | per-session active society (FK, `ON DELETE SET NULL`) |
| `User.passwordChangedAt` | set by password reset |
| `Unit` | unique `(id, societyId)` for the composite keys |
| Data migration | every `SocietyRole` row → `Membership` (ACTIVE, same role); every APPROVED `MembershipRequest` → RESIDENT `Membership` + `UnitAssignment` for its unit |
| Removed | `SocietyRole` table and `SocietyRoleType` enum (superseded by `Membership`) |

The migration runs in one transaction (`prisma migrate deploy`). It was verified on a scratch database seeded with Sprint 1 data (an admin, a guard and an approved resident): all three became ACTIVE memberships, and the resident got their unit assignment. On the migrated data the audit trigger blocked `DELETE`, the composite key rejected a cross-society assignment, and the rollback restored the Sprint 1 schema with the admin and guard roles and the APPROVED request intact.

## Apply

```bash
pg_dump "$DATABASE_URL" > krevia-before-sprint2.sql   # backup first
pnpm db:migrate                                          # prisma migrate deploy
```

Production also needs `AUTH_PEPPER` (32+ random characters, e.g. `openssl rand -hex 32`) before the new API starts. The API refuses to boot without it.

Existing passwords keep working: Sprint 1 scrypt hashes are verified and replaced with Argon2id at each user's next successful login.

## Roll back

Prisma has no down migrations, so the rollback is a reviewed SQL script:

```bash
# 1. stop the API, 2. back up, 3. run the script, 4. deploy the Sprint 1 build
pg_dump "$DATABASE_URL" > krevia-before-rollback.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/rollback/20261021090000_sprint2_secure_accounts.down.sql
```

The script runs in a transaction. It:

* recreates `SocietyRole` from ACTIVE ADMIN/GUARD memberships (ADMIN wins if a user held both in one society);
* drops the Sprint 2 tables, enums, columns and trigger;
* turns `REVOKED` join requests into `CANCELLED`;
* removes the migration row from `_prisma_migrations`.

**Data that Sprint 1 cannot represent is lost**: invitations, reset codes, audit events, suspended/revoked memberships, assignments beyond the approved request, and a second staff role in the same society. Keep the pre-rollback dump if any of it matters.

Argon2id password hashes written after the upgrade are **not** readable by the Sprint 1 build (scrypt only). After a rollback those users must be given new passwords, or the Sprint 1 build must be patched to verify Argon2id. Plan a rollback window accordingly.
