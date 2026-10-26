-- Rollback for 20261026120000_sprint4_visitor_gate.
--
-- WARNING: drops the visitor register and its notification history. Export any
-- data you need before running this. This changes the schema only; Prisma still
-- records the migration as applied, so also mark it rolled back:
--   prisma migrate resolve --rolled-back 20261026120000_sprint4_visitor_gate

BEGIN;

DROP TABLE IF EXISTS "VisitorNotification";
DROP TABLE IF EXISTS "Visitor";

DROP TYPE IF EXISTS "VisitorNotificationKind";
DROP TYPE IF EXISTS "VisitorEntryMethod";
DROP TYPE IF EXISTS "VisitorStatus";
DROP TYPE IF EXISTS "VisitorCategory";

COMMIT;
