-- Rollback for migration 20261021090000_sprint2_secure_accounts.
-- Restores the Sprint 1 schema. Run with the API stopped, after a backup:
--   pg_dump "$DATABASE_URL" > krevia-before-rollback.sql
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261021090000_sprint2_secure_accounts.down.sql
-- then deploy the Sprint 1 build. See docs/sprint-2/migrations.md.
--
-- Data that Sprint 1 cannot represent is lost: invitations, password-reset codes,
-- audit events, suspended/revoked/invited memberships, extra unit assignments and
-- second staff roles in the same society (ADMIN is kept over GUARD).

BEGIN;

CREATE TYPE "SocietyRoleType" AS ENUM ('ADMIN', 'GUARD');

CREATE TABLE "SocietyRole" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "societyId" UUID NOT NULL,
    "role" "SocietyRoleType" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SocietyRole_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SocietyRole_societyId_idx" ON "SocietyRole"("societyId");
CREATE UNIQUE INDEX "SocietyRole_userId_societyId_key" ON "SocietyRole"("userId", "societyId");
ALTER TABLE "SocietyRole" ADD CONSTRAINT "SocietyRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocietyRole" ADD CONSTRAINT "SocietyRole_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "Society"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "SocietyRole" ("id", "userId", "societyId", "role", "createdAt")
SELECT DISTINCT ON ("userId", "societyId") gen_random_uuid(), "userId", "societyId", "role"::text::"SocietyRoleType", "createdAt"
FROM "Membership"
WHERE "status" = 'ACTIVE' AND "role" IN ('ADMIN', 'GUARD')
ORDER BY "userId", "societyId", CASE "role" WHEN 'ADMIN' THEN 0 ELSE 1 END;

DROP TRIGGER "AuditEvent_no_update_delete" ON "AuditEvent";
DROP FUNCTION "audit_event_immutable"();

DROP TABLE "UnitAssignment";
DROP TABLE "Membership";
DROP TABLE "Invitation";
DROP TABLE "PasswordResetCode";
DROP TABLE "AuditEvent";

DROP TYPE "MemberRole";
DROP TYPE "MemberStatus";
DROP TYPE "InvitationStatus";
DROP TYPE "AuditOutcome";

ALTER TABLE "Session" DROP COLUMN "activeSocietyId";
ALTER TABLE "User" DROP COLUMN "passwordChangedAt";
DROP INDEX "Unit_id_societyId_key";

-- MembershipStatus loses REVOKED (Sprint 1 knows only CANCELLED for ended requests).
DROP INDEX "MembershipRequest_one_active_per_user";
DROP INDEX "MembershipRequest_societyId_status_idx";
UPDATE "MembershipRequest" SET "status" = 'CANCELLED' WHERE "status" = 'REVOKED';
ALTER TYPE "MembershipStatus" RENAME TO "MembershipStatus_sprint2";
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
ALTER TABLE "MembershipRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "MembershipRequest" ALTER COLUMN "status" TYPE "MembershipStatus" USING "status"::text::"MembershipStatus";
ALTER TABLE "MembershipRequest" ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "MembershipStatus_sprint2";
CREATE INDEX "MembershipRequest_societyId_status_idx" ON "MembershipRequest"("societyId", "status");
CREATE UNIQUE INDEX "MembershipRequest_one_active_per_user"
  ON "MembershipRequest" ("userId")
  WHERE "status" IN ('PENDING', 'APPROVED');

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261021090000_sprint2_secure_accounts';

COMMIT;
