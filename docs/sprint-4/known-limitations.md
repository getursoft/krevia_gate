# Krevia — Sprint 4 known limitations

**Sprint:** Visitor & Gate Workflow · **Date:** 26 Oct 2026
**Verdict: PASS WITH BLOCKERS**

Related: [Implementation report](implementation-report.md) · [Test report](test-report.md) · [Security report](security-report.md)

---

## 1. Release blocker (inherited from Sprint 2)

**No SMS/email provider is configured.** In production `MESSAGE_DELIVERY=none`, so:

* A visitor approval request is stored and appears in the resident's in-app pending list, but no SMS is sent.
* The API reports `delivered: false` and the UI says "SMS delivery unavailable" — it never claims delivery.
* Invitation links and password-reset codes from Sprint 2 have the same limitation.

The gate workflow itself is not blocked: a resident who opens the app can approve or reject. The blocker matters when a resident does not open the app, which is the normal case for a visitor waiting at the gate. Closing it requires a real SMS provider (or push notifications) and a production credential; that is outside Sprint 4.

## 2. QR passes are not implemented

There is no QR-pass system in the repository: no pass model, token, generator, scanner or expiry. Sprint 4 therefore implements **manual** gate entry and exit only. Scenarios for expired, reused or forged QR passes are **N/A** and were not counted as passing. The guard menu items "Scan QR Code" and "Pre-Approved" still point at the gate console or the coming-soon page; they do not pretend to scan.

## 3. Timeout is lazy, not scheduled

`VISITOR_APPROVAL_TTL_MINUTES` (default 30) is enforced in two places:

1. Before every read or action, `sweepExpired()` marks stale `PENDING` rows `TIMED_OUT` and audits each one.
2. Approval and rejection additionally require `approvalExpiresAt > now` in the `UPDATE`.

Consequences:

* A request can sit in the database as `PENDING` past its expiry until someone reads or acts on it. The next read shows the correct `TIMED_OUT` status.
* No background job or queue exists, so there is no notification at the moment of expiry.
* No late approval is possible, because the conditional update rejects it.

## 4. Notifications

* Only one channel is attempted per recipient: the configured `MessageSender` (SMS in a configured deployment). There is no push notification, email fallback or retry queue.
* `VisitorNotification.recipientPhone` stores a masked number, so the delivery log cannot be used to re-send to the original number without reading the resident record again.
* Delivery attempts are recorded for the approval request, the decision and each status change; the UI surfaces only the approval-request line.
* In-app delivery means "present in the pending list". There is no unread badge or push alert.

## 5. Visitor lifecycle scope

* Categories are `VISITOR`, `DELIVERY`, `CAB`, `OTHER`. There is no separate delivery, staff or vehicle register, and no parcel workflow.
* A visitor request must target an active flat that has at least one active resident with an app account. Registration is refused otherwise, because nobody could approve it. Flats with no app user need an administrator to link a resident first.
* One visitor row carries one visit. A repeat visitor is a new row; there is no recurring visitor or pre-approval schedule.
* Emergency override is admin-only and requires a reason. Guards cannot override, by design.
* There is no visitor blacklist, watchlist or ID-document capture.
* Visitor records are retained indefinitely. There is no archival or retention policy yet.

## 6. Search, export and reporting

* The register supports free text (name, phone, purpose), date range, unit, category and status, with pagination up to 100 rows per page.
* There is no CSV/PDF export. None existed before Sprint 4 and none was required; the API and UI do not offer a disabled button for it.
* Counts are "today" and current-state counts, not an analytics report. `Reports` remains a coming-soon module.

## 7. Web and mobile UI

* The guard console, admin register and resident screen refresh after an action and on page load; there is no websocket or polling, so a second guard's screen does not update live.
* The resident web screen resolves the society from an active resident membership when the resident was invited rather than joining through a request. A user with only a pending join request sees the "join a society first" state.
* The mobile screen covers resident approval, status and history. Guard registration and gate entry remain web-only in this sprint.
* Cancel and override reasons are collected with the browser `prompt()` on web and a native confirmation on mobile. This is functional but not a polished form; a reason of fewer than 5 characters is rejected by the API for override.
* The mobile app was typechecked and unit-tested under Jest; it was not run on a physical device or simulator in this sprint.

## 8. Data, migration and operations

* The Sprint 4 migration was applied to `krevia_dev` after a backup (`backups/krevia_dev_pre_sprint4_20261026_180440.dump`). The rollback was verified on a scratch database, not by rolling back `krevia_dev`.
* `prisma migrate diff` reports a difference caused only by the pre-existing trigram indexes (`Society_name_trgm_idx`, `Society_city_trgm_idx`), which are intentionally not in `schema.prisma`. This predates Sprint 4.
* There is no production deployment. All checks run on localhost against PostgreSQL 17.
* The browser suite runs locally with installed Google Chrome (`PW_CHANNEL=chrome`); CI uses bundled Chromium. The suite is serial (`workers: 1`) and resets an isolated `krevia_e2e_test` database.

## 9. Security follow-ups

* Actor ids on visitor rows have no `User` foreign key, matching the audit convention. A deleted user's name resolves as absent; the historical action and id remain.
* Admins can approve on a resident's behalf. This is intentional for operational recovery and is audited, but it means "resident approval" is not cryptographically restricted to the resident.
* There is no per-visitor rate limit beyond the existing per-IP authentication rate limit. A guard account could create many requests; the duplicate window and idempotency key reduce accidental duplicates, not deliberate volume.
* Phone masking is server-side for residents; staff see the full number, which is required to call a visitor at the gate.

## 10. Explicitly deferred beyond Sprint 4

QR visitor passes and QR gate entry, push notifications, delivery/parcel management, staff and vehicle entry, visitor pre-approval schedules, blacklists, CSV export, visitor analytics, and a background timeout scheduler. Payments, complaints, amenities and other unrelated modules remain out of scope.

## 11. Summary

Sprint 4 delivers the complete manual visitor lifecycle with honest notification reporting, strong tenant isolation and a full audit trail. The inherited messaging blocker is the only reason the verdict is not an unqualified PASS. QR-specific requirements could not be tested because no QR system exists, and they are reported as N/A rather than silently claimed.
