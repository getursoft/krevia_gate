-- Sprint 3: resident & unit directory.
-- Buildings and floors, unit archival, an explicit resident directory
-- (people can exist before they have an account), and idempotent CSV imports.
-- Rollback: prisma/rollback/20261026090000_sprint3_resident_directory.down.sql

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ResidentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('PREVIEWED', 'IMPORTING', 'COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "OccupancyType" ADD VALUE 'HOUSEHOLD';

-- CreateTable
CREATE TABLE "Building" (
    "id" UUID NOT NULL,
    "societyId" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Floor" (
    "id" UUID NOT NULL,
    "societyId" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "name" VARCHAR(40),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Floor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resident" (
    "id" UUID NOT NULL,
    "societyId" UUID NOT NULL,
    "userId" UUID,
    "fullName" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(16),
    "email" VARCHAR(254),
    "status" "ResidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "emergencyContactName" VARCHAR(80),
    "emergencyContactPhone" VARCHAR(16),
    "vehicles" JSONB NOT NULL DEFAULT '[]',
    "createdById" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Resident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidentUnit" (
    "id" UUID NOT NULL,
    "societyId" UUID NOT NULL,
    "residentId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "relationship" "OccupancyType" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "assignmentId" UUID,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "createdById" UUID,

    CONSTRAINT "ResidentUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidentImportJob" (
    "id" UUID NOT NULL,
    "societyId" UUID NOT NULL,
    "createdById" UUID,
    "fileName" VARCHAR(120) NOT NULL,
    "fileHash" CHAR(64) NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'PREVIEWED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "updatedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "rejectedRows" INTEGER NOT NULL DEFAULT 0,
    "rows" JSONB NOT NULL DEFAULT '[]',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "failureReason" VARCHAR(280),
    "confirmedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResidentImportJob_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add nullable first, backfill from the legacy tower labels, then tighten.
ALTER TABLE "Unit"
  ADD COLUMN "archivedAt" TIMESTAMPTZ(3),
  ADD COLUMN "buildingId" UUID,
  ADD COLUMN "floorId" UUID,
  ADD COLUMN "status" "UnitStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Unit" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Building_societyId_archivedAt_idx" ON "Building"("societyId", "archivedAt");
CREATE UNIQUE INDEX "Building_societyId_name_key" ON "Building"("societyId", "name");
CREATE UNIQUE INDEX "Building_id_societyId_key" ON "Building"("id", "societyId");

CREATE INDEX "Floor_societyId_idx" ON "Floor"("societyId");
CREATE UNIQUE INDEX "Floor_buildingId_level_key" ON "Floor"("buildingId", "level");
CREATE UNIQUE INDEX "Floor_id_societyId_key" ON "Floor"("id", "societyId");

CREATE INDEX "Resident_societyId_status_idx" ON "Resident"("societyId", "status");
CREATE INDEX "Resident_societyId_fullName_idx" ON "Resident"("societyId", "fullName");
CREATE UNIQUE INDEX "Resident_societyId_phone_key" ON "Resident"("societyId", "phone");
CREATE UNIQUE INDEX "Resident_societyId_userId_key" ON "Resident"("societyId", "userId");
CREATE UNIQUE INDEX "Resident_id_societyId_key" ON "Resident"("id", "societyId");

CREATE UNIQUE INDEX "ResidentUnit_assignmentId_key" ON "ResidentUnit"("assignmentId");
CREATE INDEX "ResidentUnit_societyId_unitId_endedAt_idx" ON "ResidentUnit"("societyId", "unitId", "endedAt");
CREATE INDEX "ResidentUnit_residentId_endedAt_idx" ON "ResidentUnit"("residentId", "endedAt");

CREATE INDEX "ResidentImportJob_societyId_createdAt_idx" ON "ResidentImportJob"("societyId", "createdAt");
CREATE UNIQUE INDEX "ResidentImportJob_societyId_fileHash_key" ON "ResidentImportJob"("societyId", "fileHash");

CREATE INDEX "Unit_societyId_status_idx" ON "Unit"("societyId", "status");
CREATE INDEX "Unit_societyId_buildingId_floorId_idx" ON "Unit"("societyId", "buildingId", "floorId");
CREATE UNIQUE INDEX "Unit_buildingId_number_key" ON "Unit"("buildingId", "number");

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "Society"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Floor" ADD CONSTRAINT "Floor_buildingId_societyId_fkey" FOREIGN KEY ("buildingId", "societyId") REFERENCES "Building"("id", "societyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "Society"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResidentUnit" ADD CONSTRAINT "ResidentUnit_residentId_societyId_fkey" FOREIGN KEY ("residentId", "societyId") REFERENCES "Resident"("id", "societyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResidentUnit" ADD CONSTRAINT "ResidentUnit_unitId_societyId_fkey" FOREIGN KEY ("unitId", "societyId") REFERENCES "Unit"("id", "societyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResidentUnit" ADD CONSTRAINT "ResidentUnit_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "UnitAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResidentImportJob" ADD CONSTRAINT "ResidentImportJob_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "Society"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data migration: legacy tower labels and unit assignments become buildings,
-- resident records and resident-unit links.
-- ---------------------------------------------------------------------------

INSERT INTO "Building" ("id", "societyId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid(), s."id", btrim(t."tower"), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Society" s
CROSS JOIN LATERAL unnest(s."towers") AS t("tower")
WHERE btrim(t."tower") <> ''
ON CONFLICT ("societyId", "name") DO NOTHING;

-- Units may reference a tower that was not in Society.towers (older data).
INSERT INTO "Building" ("id", "societyId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u."societyId", u."tower", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Unit" u
WHERE NOT EXISTS (
  SELECT 1 FROM "Building" b WHERE b."societyId" = u."societyId" AND lower(b."name") = lower(u."tower")
)
ON CONFLICT ("societyId", "name") DO NOTHING;

-- Canonicalise the legacy tower label to the Building name and set buildingId.
UPDATE "Unit" u
SET "buildingId" = b."id", "tower" = b."name"
FROM "Building" b
WHERE b."societyId" = u."societyId" AND lower(b."name") = lower(u."tower");

ALTER TABLE "Unit" ALTER COLUMN "buildingId" SET NOT NULL;
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_buildingId_societyId_fkey" FOREIGN KEY ("buildingId", "societyId") REFERENCES "Building"("id", "societyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_floorId_societyId_fkey" FOREIGN KEY ("floorId", "societyId") REFERENCES "Floor"("id", "societyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One Resident per (society, account). One person can hold several unit links.
INSERT INTO "Resident" ("id", "societyId", "userId", "fullName", "phone", "email", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), x."societyId", x."userId", x."fullName", x."phone", x."email", 'ACTIVE', x."firstAssigned", CURRENT_TIMESTAMP
FROM (
  SELECT m."societyId", m."userId", u."fullName", u."phone", u."email", MIN(a."assignedAt") AS "firstAssigned"
  FROM "UnitAssignment" a
  JOIN "Membership" m ON m."id" = a."membershipId"
  JOIN "User" u ON u."id" = m."userId"
  GROUP BY m."societyId", m."userId", u."fullName", u."phone", u."email"
) x
ON CONFLICT ("societyId", "userId") DO NOTHING;

INSERT INTO "ResidentUnit" ("id", "societyId", "residentId", "unitId", "relationship", "isPrimary", "assignmentId", "startedAt", "endedAt", "createdById")
SELECT gen_random_uuid(), a."societyId", r."id", a."unitId", a."occupancy", false, a."id", a."assignedAt", a."endedAt", a."assignedById"
FROM "UnitAssignment" a
JOIN "Membership" m ON m."id" = a."membershipId"
JOIN "Resident" r ON r."societyId" = a."societyId" AND r."userId" = m."userId"
ON CONFLICT ("assignmentId") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Tenant-integrity and business constraints not expressible in Prisma.
-- ---------------------------------------------------------------------------

-- A resident holds the same unit at most once at a time.
CREATE UNIQUE INDEX "ResidentUnit_one_active_per_resident_unit"
  ON "ResidentUnit" ("residentId", "unitId")
  WHERE "endedAt" IS NULL;

-- At most one primary resident per unit.
CREATE UNIQUE INDEX "ResidentUnit_one_primary_per_unit"
  ON "ResidentUnit" ("unitId")
  WHERE "endedAt" IS NULL AND "isPrimary" = true;

ALTER TABLE "Building" ADD CONSTRAINT "Building_name_check" CHECK (btrim("name") <> '');
ALTER TABLE "Floor" ADD CONSTRAINT "Floor_level_check" CHECK ("level" >= 0 AND "level" <= 200);
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_number_check" CHECK ("number" ~ '^[A-Z0-9][A-Z0-9/-]*$');
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_name_check" CHECK (btrim("fullName") <> '');
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_phone_check" CHECK ("phone" IS NULL OR "phone" ~ '^\+91[6-9][0-9]{9}$');
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_emergency_phone_check" CHECK ("emergencyContactPhone" IS NULL OR "emergencyContactPhone" ~ '^\+91[6-9][0-9]{9}$');
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_vehicles_array_check" CHECK (jsonb_typeof("vehicles") = 'array');
ALTER TABLE "ResidentUnit" ADD CONSTRAINT "ResidentUnit_dates_check" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");
ALTER TABLE "ResidentImportJob" ADD CONSTRAINT "ResidentImportJob_counts_check" CHECK (
  "totalRows" >= 0 AND "validRows" >= 0 AND "invalidRows" >= 0 AND "duplicateRows" >= 0
  AND "createdRows" >= 0 AND "updatedRows" >= 0 AND "skippedRows" >= 0 AND "rejectedRows" >= 0
);

-- A unit's floor must belong to the unit's building and society.
CREATE FUNCTION "unit_floor_building_check"() RETURNS trigger AS $$
BEGIN
  IF NEW."floorId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "Floor" f
      WHERE f."id" = NEW."floorId"
        AND f."buildingId" = NEW."buildingId"
        AND f."societyId" = NEW."societyId"
    ) THEN
      RAISE EXCEPTION 'Unit floor must belong to the unit building and society' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Unit_floor_building_guard"
  BEFORE INSERT OR UPDATE OF "floorId", "buildingId", "societyId" ON "Unit"
  FOR EACH ROW EXECUTE FUNCTION "unit_floor_building_check"();
