-- Sprint 4: visitor and gate workflow.
-- One Visitor row carries the whole lifecycle (registration → decision → entry
-- → exit, plus cancellation and emergency override). VisitorNotification
-- records delivery attempts so an unconfigured SMS/email provider is visible.
-- Rollback: prisma/rollback/20261026120000_sprint4_visitor_gate.down.sql

-- CreateEnum
CREATE TYPE "VisitorCategory" AS ENUM ('VISITOR', 'DELIVERY', 'CAB', 'OTHER');
CREATE TYPE "VisitorStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'TIMED_OUT', 'CANCELLED', 'ENTERED', 'EXITED');
CREATE TYPE "VisitorEntryMethod" AS ENUM ('MANUAL', 'OVERRIDE');
CREATE TYPE "VisitorNotificationKind" AS ENUM ('APPROVAL_REQUEST', 'DECISION', 'STATUS_CHANGE');

-- CreateTable
CREATE TABLE "Visitor" (
    "id" UUID NOT NULL,
    "societyId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(16),
    "category" "VisitorCategory" NOT NULL,
    "purpose" VARCHAR(160) NOT NULL,
    "status" "VisitorStatus" NOT NULL DEFAULT 'PENDING',
    "approvalExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" VARCHAR(280),
    "cancelledById" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" VARCHAR(280),
    "entryAt" TIMESTAMPTZ(3),
    "entryById" UUID,
    "entryMethod" "VisitorEntryMethod",
    "exitAt" TIMESTAMPTZ(3),
    "exitById" UUID,
    "overrideReason" VARCHAR(280),
    "overriddenById" UUID,
    "overriddenAt" TIMESTAMPTZ(3),
    "idempotencyKey" VARCHAR(64),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisitorNotification" (
    "id" UUID NOT NULL,
    "societyId" UUID NOT NULL,
    "visitorId" UUID NOT NULL,
    "recipientUserId" UUID,
    "recipientPhone" VARCHAR(16),
    "kind" "VisitorNotificationKind" NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitorNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Visitor_societyId_idempotencyKey_key" ON "Visitor"("societyId", "idempotencyKey");
CREATE UNIQUE INDEX "Visitor_id_societyId_key" ON "Visitor"("id", "societyId");
CREATE INDEX "Visitor_societyId_createdAt_idx" ON "Visitor"("societyId", "createdAt");
CREATE INDEX "Visitor_societyId_status_approvalExpiresAt_idx" ON "Visitor"("societyId", "status", "approvalExpiresAt");
CREATE INDEX "Visitor_societyId_unitId_createdAt_idx" ON "Visitor"("societyId", "unitId", "createdAt");

CREATE INDEX "VisitorNotification_visitorId_createdAt_idx" ON "VisitorNotification"("visitorId", "createdAt");
CREATE INDEX "VisitorNotification_societyId_createdAt_idx" ON "VisitorNotification"("societyId", "createdAt");

-- AddForeignKey
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "Society"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_unitId_societyId_fkey" FOREIGN KEY ("unitId", "societyId") REFERENCES "Unit"("id", "societyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitorNotification" ADD CONSTRAINT "VisitorNotification_visitorId_societyId_fkey" FOREIGN KEY ("visitorId", "societyId") REFERENCES "Visitor"("id", "societyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Business constraints that keep lifecycle rows internally consistent.
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_name_check" CHECK (btrim("name") <> '');
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_purpose_check" CHECK (btrim("purpose") <> '');
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_phone_check" CHECK ("phone" IS NULL OR "phone" ~ '^\+91[6-9][0-9]{9}$');
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_decided_check" CHECK ("status" NOT IN ('APPROVED', 'REJECTED') OR "decidedAt" IS NOT NULL);
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_cancelled_check" CHECK ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL);
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_entry_check" CHECK (
  ("status" NOT IN ('ENTERED', 'EXITED') OR "entryAt" IS NOT NULL)
  AND ("status" <> 'EXITED' OR "exitAt" IS NOT NULL)
  AND ("entryMethod" IS NULL OR "status" IN ('ENTERED', 'EXITED'))
  AND ("entryMethod" <> 'OVERRIDE' OR "overrideReason" IS NOT NULL)
);
