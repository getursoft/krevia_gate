-- Rollback for 20261026090000_sprint3_resident_directory.
--
-- This reverses the Sprint 3 directory migration. It restores the Sprint 2
-- schema (Unit.tower/number only) and removes buildings, floors, the resident
-- directory and CSV import jobs.
--
-- WARNING: dropping these tables discards directory data that has no Sprint 2
-- equivalent. Take a backup before running this in any environment that holds
-- real data.
--
-- PostgreSQL cannot remove a value from an existing enum. `OccupancyType`
-- keeps the extra 'HOUSEHOLD' label after rollback; the Sprint 2 application
-- never writes it, so leaving it in place is safe and non-breaking.
--
-- This script changes the schema only. Prisma still records the migration as
-- applied, so an operator who rolls back must also remove its row from
-- `_prisma_migrations` (or run `prisma migrate resolve --rolled-back
-- 20261026090000_sprint3_resident_directory`) before re-applying it.

BEGIN;

-- Trigger and function that keep a unit's floor inside its building.
DROP TRIGGER IF EXISTS "Unit_floor_building_guard" ON "Unit";
DROP FUNCTION IF EXISTS "unit_floor_building_check"();

-- Foreign keys that pin units to buildings/floors and residents to units.
ALTER TABLE "Unit" DROP CONSTRAINT IF EXISTS "Unit_floorId_societyId_fkey";
ALTER TABLE "Unit" DROP CONSTRAINT IF EXISTS "Unit_buildingId_societyId_fkey";

-- Directory tables (children first).
DROP TABLE IF EXISTS "ResidentUnit";
DROP TABLE IF EXISTS "ResidentImportJob";
DROP TABLE IF EXISTS "Resident";

-- Unit columns and constraints added in Sprint 3.
DROP INDEX IF EXISTS "Unit_societyId_status_idx";
DROP INDEX IF EXISTS "Unit_societyId_buildingId_floorId_idx";
DROP INDEX IF EXISTS "Unit_buildingId_number_key";
ALTER TABLE "Unit" DROP CONSTRAINT IF EXISTS "Unit_number_check";
ALTER TABLE "Unit"
  DROP COLUMN IF EXISTS "status",
  DROP COLUMN IF EXISTS "floorId",
  DROP COLUMN IF EXISTS "buildingId",
  DROP COLUMN IF EXISTS "archivedAt",
  DROP COLUMN IF EXISTS "updatedAt";

-- Building/floor tables (Floor references Building).
DROP TABLE IF EXISTS "Floor";
DROP TABLE IF EXISTS "Building";

-- Enums introduced by this migration.
DROP TYPE IF EXISTS "ImportJobStatus";
DROP TYPE IF EXISTS "ResidentStatus";
DROP TYPE IF EXISTS "UnitStatus";

COMMIT;
