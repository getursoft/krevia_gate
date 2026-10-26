-- Sprint 2: secure society accounts.
-- Memberships (with roles and statuses), unit assignments, invitations,
-- password-reset codes, an append-only audit trail and per-session active society.
-- Existing SocietyRole rows and APPROVED membership requests are migrated into
-- Membership / UnitAssignment before SocietyRole is dropped.
-- Rollback: prisma/rollback/20261021090000_sprint2_secure_accounts.down.sql

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('RESIDENT', 'ADMIN', 'GUARD');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- AlterEnum
ALTER TYPE "MembershipStatus" ADD VALUE 'REVOKED';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "activeSocietyId" UUID;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordChangedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "societyId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitationId" UUID,
    "statusChangedAt" TIMESTAMPTZ(3),
    "statusChangedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitAssignment" (
    "id" UUID NOT NULL,
    "societyId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "occupancy" "OccupancyType" NOT NULL,
    "assignedById" UUID,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "endedById" UUID,

CONSTRAINT "UnitAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "societyId" UUID NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "role" "MemberRole" NOT NULL,
    "unitId" UUID,
    "occupancy" "OccupancyType",
    "tokenHash" CHAR(64) NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "acceptedById" UUID,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedById" UUID,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "PasswordResetCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" VARCHAR(64),
    "actorUserId" UUID,
    "action" VARCHAR(64) NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "societyId" UUID,
    "targetType" VARCHAR(32),
    "targetId" VARCHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',

CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Membership_invitationId_key" ON "Membership"("invitationId");

-- CreateIndex
CREATE INDEX "Membership_societyId_role_status_idx" ON "Membership"("societyId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_societyId_role_key" ON "Membership"("userId", "societyId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_id_societyId_key" ON "Membership"("id", "societyId");

-- CreateIndex
CREATE INDEX "UnitAssignment_societyId_unitId_idx" ON "UnitAssignment"("societyId", "unitId");

-- CreateIndex
CREATE INDEX "UnitAssignment_membershipId_idx" ON "UnitAssignment"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_societyId_status_idx" ON "Invitation"("societyId", "status");

-- CreateIndex
CREATE INDEX "Invitation_phone_idx" ON "Invitation"("phone");

-- CreateIndex
CREATE INDEX "PasswordResetCode_userId_createdAt_idx" ON "PasswordResetCode"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_societyId_createdAt_idx" ON "AuditEvent"("societyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_id_societyId_key" ON "Unit"("id", "societyId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_activeSocietyId_fkey" FOREIGN KEY ("activeSocietyId") REFERENCES "Society"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "Society"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitAssignment" ADD CONSTRAINT "UnitAssignment_unitId_societyId_fkey" FOREIGN KEY ("unitId", "societyId") REFERENCES "Unit"("id", "societyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitAssignment" ADD CONSTRAINT "UnitAssignment_membershipId_societyId_fkey" FOREIGN KEY ("membershipId", "societyId") REFERENCES "Membership"("id", "societyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "Society"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_unitId_societyId_fkey" FOREIGN KEY ("unitId", "societyId") REFERENCES "Unit"("id", "societyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetCode" ADD CONSTRAINT "PasswordResetCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Tenant-integrity constraints not expressible in the Prisma schema
-- ---------------------------------------------------------------------------

-- At most one open invitation per phone, society and role.
CREATE UNIQUE INDEX "Invitation_one_pending_per_phone_role"
  ON "Invitation" ("societyId", "phone", "role")
  WHERE "status" = 'PENDING';

-- A resident holds a unit at most once at a time.
CREATE UNIQUE INDEX "UnitAssignment_one_active_per_member_unit"
  ON "UnitAssignment" ("membershipId", "unitId")
  WHERE "endedAt" IS NULL;

ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_phone_e164_check" CHECK ("phone" ~ '^\+91[6-9][0-9]{9}$');
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_resident_unit_check"
  CHECK (("role" = 'RESIDENT' AND "unitId" IS NOT NULL AND "occupancy" IS NOT NULL)
      OR ("role" <> 'RESIDENT' AND "unitId" IS NULL AND "occupancy" IS NULL));
ALTER TABLE "PasswordResetCode" ADD CONSTRAINT "PasswordResetCode_attempts_check" CHECK ("attempts" >= 0);
ALTER TABLE "UnitAssignment" ADD CONSTRAINT "UnitAssignment_dates_check" CHECK ("endedAt" IS NULL OR "endedAt" >= "assignedAt");

-- ---------------------------------------------------------------------------
-- Append-only audit trail: application roles cannot change or delete events.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "audit_event_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent rows are append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_no_update_delete"
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "audit_event_immutable"();

-- ---------------------------------------------------------------------------
-- Data migration from Sprint 1
-- ---------------------------------------------------------------------------

-- Staff roles → ACTIVE memberships.
INSERT INTO "Membership" ("id", "userId", "societyId", "role", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "userId", "societyId", "role"::text::"MemberRole", 'ACTIVE', "createdAt", CURRENT_TIMESTAMP
FROM "SocietyRole";

-- Approved join requests → ACTIVE resident memberships + unit assignments.
INSERT INTO "Membership" ("id", "userId", "societyId", "role", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), r."userId", r."societyId", 'RESIDENT', 'ACTIVE', COALESCE(r."reviewedAt", r."createdAt"), CURRENT_TIMESTAMP
FROM "MembershipRequest" r
WHERE r."status" = 'APPROVED'
ON CONFLICT ("userId", "societyId", "role") DO NOTHING;

INSERT INTO "UnitAssignment" ("id", "societyId", "unitId", "membershipId", "occupancy", "assignedById", "assignedAt")
SELECT gen_random_uuid(), r."societyId", r."unitId", m."id", r."occupancy", r."reviewedById", COALESCE(r."reviewedAt", r."createdAt")
FROM "MembershipRequest" r
JOIN "Membership" m ON m."userId" = r."userId" AND m."societyId" = r."societyId" AND m."role" = 'RESIDENT'
WHERE r."status" = 'APPROVED';

-- SocietyRole is superseded by Membership.
DROP TABLE "SocietyRole";
DROP TYPE "SocietyRoleType";
