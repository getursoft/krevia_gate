# Krevia — Sprint 3 known limitations

**Sprint:** Society Buildings, Units & Resident Directory · **Date:** 26 Oct 2026

This file records what Sprint 3 does **not** do, what is intentionally deferred, and what an operator must know before relying on it. Nothing here is silently marked as done.

Related: [Implementation report](implementation-report.md) · [Test report](test-report.md) · [Security report](security-report.md)

---

## 1. Release blocker (inherited from Sprint 2)

**No SMS/email provider is configured.** In production the API refuses `MESSAGE_DELIVERY=dev-outbox` and defaults to `none`. Invitation links and password-reset codes are generated and stored, but no message is delivered.

* Impact: an invited resident cannot receive the invite link by SMS; a resident cannot self-serve a password reset in production. Admins can still copy the one-time invitation link from the Invitations page and share it manually.
* Why it is still open: it needs provider credentials and, in India, DLT template registration (TRAI).
* Integration point: `MessageSender` (`apps/api/src/messaging/`). Development uses the in-memory dev outbox at `GET /api/v1/dev/outbox`.
* Sprint 3 does not depend on messaging for CSV import or the directory, but this blocker keeps the sprint verdict at **PASS WITH BLOCKERS**.

## 2. CSV import

* **Synchronous, in-request processing.** Preview and confirm run inside the API request. There is no background worker or queue. A 5000-row file can take noticeable time; clients should keep the request open and not retry blindly.
* **Limits:** 2 MB per file and 5000 data rows. Larger societies must split files. These limits are enforced server-side and cannot be raised from the client.
* **Raw `text/csv` body, not multipart.** The API accepts the file as the request body with `Content-Type: text/csv`. A browser form posting `multipart/form-data` will be rejected; the web UI and API client use `fetch` with the raw body.
* **Preview is a snapshot.** Confirm re-validates units, floors and residents. If a unit is archived, moved, or a resident's name changes between preview and confirm, the affected row is rejected or skipped and reported in the final counts. This is deliberate, but it means preview counts can differ from confirm counts.
* **No unit/floor import.** The CSV imports residents and their unit links. Buildings, floors and units themselves are created through the UI/API one at a time; there is no bulk unit generator or unit CSV.
* **Conflict policy is conservative.** A row whose phone belongs to a resident with a different name is rejected, not merged. Non-empty resident fields (email, emergency contact, vehicles) are never overwritten by the CSV. Fixing data requires editing the resident or using a new file.
* **Idempotency is per exact file content.** Re-uploading the same bytes returns the original job. Editing one cell produces a new hash and therefore a new job; it does not update the previous job.
* **Error report contains PII.** The downloadable rejected-row report includes the name, phone and unit from the file. It is restricted to `resident.import` holders in that society; operators should treat it as personal data.
* **Formula-safe export is prefix-based.** Cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'`. This protects spreadsheet formula injection; it also means a legitimate value beginning with `-` or `+` will display with a leading apostrophe.

## 3. Directory and units

* **No bulk unit creation.** Units are created individually (`POST /units`) or via the admin Units page. A 100-unit tower requires 100 creates; the 100-row test exercises resident import, not unit creation.
* **Building rename is a label change.** Renaming a building updates `Building.name`, every unit's legacy `tower` field and `Society.towers` in one transaction. It does not change unit numbers or floor levels. External systems that cached the old tower label must refresh.
* **`Society.towers` is still the legacy label list.** It is kept in sync for Sprint 1/2 clients. `Building` is the source of truth for floors and units. If a `Building` is created through the API, it is also added to `Society.towers`; direct SQL edits to `Society.towers` do not create buildings.
* **Archiving is soft.** Buildings and units are archived, not deleted. Archived units keep their history and can be restored. A building cannot be archived while it has active units; a unit cannot be archived while it has an active resident link.
* **No hard delete for residents.** `POST /residents/:residentId/archive` sets status/archivedAt. There is no purge endpoint. Ending a resident-unit link keeps the historical row with `endedAt`; the API returns it in resident detail, and the current UI focuses on active links.
* **One primary resident per unit.** Enforced by a partial unique index. Setting a new primary clears the previous one in the same transaction. A unit may have zero primary residents.
* **One active link per resident per unit.** Enforced by a partial unique index; re-adding an existing active link is skipped rather than duplicated.
* **Household members without accounts.** A `Resident` can exist without a `User`. If a `User` with the same phone later registers, the import links the existing resident to that account only when the phone matches exactly; there is no automatic merge of two pre-existing resident rows.
* **Vehicles are JSONB.** They are validated on write and returned as a list, but there is no per-vehicle table, expiry or parking-slot link.

## 4. Web and mobile UI

* **Mobile has no admin directory.** Buildings, units, resident management and CSV import are web-only. The mobile app adds a read-only **Household** screen for residents.
* **Mobile household is read-only.** Residents can view their units and co-residents (masked phones) but cannot edit their profile, add household members or change the primary contact.
* **No Sprint 3 Playwright specs.** The existing Playwright suite covers Sprint 1/2 flows. Sprint 3 browser pages were exercised manually and through the API integration suite, but there is no automated browser regression for the new admin pages. Adding specs is the main test-coverage gap.
* **No bulk actions in the UI.** No multi-select archive, move or assign. Each action is per row.
* **No import history detail page beyond the job list/preview.** The API exposes job detail and the error CSV; the UI surfaces the latest job result and the error download.

## 5. Data, migration and operations

* **Rollback discards Sprint 3 directory data.** The down migration drops `Building`, `Floor`, `Resident`, `ResidentUnit` and `ResidentImportJob`. There is no automatic export of that data. Take a backup first.
* **Enum label remains after rollback.** PostgreSQL cannot remove `HOUSEHOLD` from `OccupancyType`; the Sprint 2 application never writes it, so it is harmless.
* **`_prisma_migrations` is not updated by the down script.** After a manual rollback, mark the migration rolled back (`prisma migrate resolve --rolled-back 20261026090000_sprint3_resident_directory`) before re-applying.
* **Dev backup format.** The pre-migration backup is a custom-format dump made with PostgreSQL 17 `pg_dump` (`backups/krevia_dev_pre_sprint3_20261026_171943.dump`). The system `pg_dump` 14.x cannot read a 17.x server; use `/opt/homebrew/opt/postgresql@17/bin/pg_dump` / `pg_restore`.
* **Work is uncommitted.** All Sprint 2 and Sprint 3 changes are on `sprint-2/secure-society-accounts` in the working tree, based on Sprint 1 commit `928e387`. Nothing has been committed or pushed.
* **No production deployment.** Verification is local (localhost PostgreSQL, API, web). No cloud environment, HTTPS termination, backup schedule or monitoring was exercised.

## 6. Security and privacy follow-ups

* **No data-retention or erasure automation.** Archived residents and import jobs remain in the database indefinitely. A retention policy and an erasure workflow are not implemented.
* **Import jobs store row data as JSONB.** This duplicates PII from the file in `ResidentImportJob.rows` and `errors`. Jobs are tenant-scoped and admin-only, but there is no automatic purge of old jobs.
* **Global rate limit only.** CSV endpoints rely on the global 600 requests/min per IP throttle plus the admin permission. There is no per-admin import quota.
* **Masked phones, not field-level ACLs.** `my-household` masks co-resident phones. A resident still sees co-residents' full names and unit numbers, which is intended for a household view.
* **No email verification.** Email addresses are optional contact data; they are not verified and cannot be used to sign in.

## 7. Explicitly deferred beyond Sprint 3

Visitors and QR gate entry, deliveries, staff and vehicle entry, payments, amenities, complaints, notices, events, the public directory, buy & sell, documents, polls, reports, role-assignment UI, phone-number verification at registration, and real SMS/email delivery. These remain "Coming soon" or absent.

## 8. Summary

Sprint 3 is functionally complete for the stated scope. The material limitations are: the inherited messaging blocker, synchronous CSV import with size caps, web-only admin directory, no Sprint 3 browser automation, and soft-delete/retention behaviour. None of these is hidden in the implementation or security reports.
