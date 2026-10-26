# Krevia — Sprint 4 implementation report

**Sprint:** Visitor & Gate Workflow · **Branch:** `sprint-2/secure-society-accounts` · **Date:** 26 Oct 2026
**Verdict: PASS WITH BLOCKERS**. The Sprint 4 lifecycle, tenant isolation, audit trail, web and mobile screens and all automated checks pass against a real PostgreSQL database. The only release blocker is inherited from Sprint 2: no SMS/email provider is configured, so visitor approval SMS is not delivered in production (the in-app request still works). See [known-limitations.md](known-limitations.md).

Related: [Test report](test-report.md) · [Security report](security-report.md) · [Known limitations](known-limitations.md) · [Sprint 3 report](../sprint-3/implementation-report.md)

---

## 1. Repository state before Sprint 4

| Item | State |
|---|---|
| Branch | `sprint-2/secure-society-accounts` (last commit `928e387`, Sprint 1) |
| Working tree | Sprint 2, 3 and 4 changes are **uncommitted** |
| Sprint 2 state | Implemented and verified; `PASS WITH BLOCKERS` (no messaging provider) |
| Sprint 3 state | Implemented and verified; `PASS WITH BLOCKERS` (same inherited blocker) |
| Visitor/gate backend | **None.** No visitor model, table, route, service or permission existed |
| Visitor/gate UI | Only placeholder menu entries and a "Coming soon" gate console |

The repository was inspected before any change: PRD, `BUILD_ORDER`, the Sprint 1–3 code, the permission matrix, the audit service, the messaging abstraction, the resident/unit directory and the web/mobile navigation contracts. Nothing in Sprint 4 assumes a capability that was not already present.

### 1.1 Sprint 2/3 capabilities verified before starting

| Capability | Verified state | Reused in Sprint 4 |
|---|---|---|
| Argon2id accounts, sessions, logout-everywhere | Implemented, 51 Sprint 2 API tests + browser flows | Session guard on every route |
| Invitations and memberships (active/suspended/revoked) | Implemented; invite acceptance links a user to a society | Resident identity for approvals |
| Central permission policy and `ADMIN_ONLY` set | Implemented with unit tests | Six visitor permissions added in place |
| Tenant isolation on every society endpoint | Implemented and tested with two societies | Same access resolver and `SocietyContext` |
| Buildings, floors, units, archival | Implemented, 14 Sprint 3 API tests | Destination flat picker and unit FK |
| Resident/household directory with `ResidentUnit` links | Implemented, including active-link semantics | Resident visibility scope and notification recipients |
| Append-only audit trail | Implemented, transaction-aware | Eight visitor actions |
| Messaging abstraction (`MessageSender`, dev outbox) | Implemented; **no production provider** | Visitor notification attempts and honest status |
| Web/mobile shells, navigation, role gates, states | Implemented | Visitor screens and nav entries |

### 1.2 Precise Sprint 4 gaps found

| Gap | Consequence |
|---|---|
| No visitor model, table, enum, route, service or permission | Entire backend had to be added |
| No QR-pass model, token, scanner or expiry | QR scenarios are N/A; only manual gate entry is implementable |
| No visitor UI beyond a "Coming soon" guard console and placeholder menu items | Guard, admin and resident screens had to be built |
| No background job/queue | Timeout is enforced lazily on reads/actions and in the approval condition |
| No production SMS/email provider | Visitor SMS cannot be delivered; in-app approval is the working channel |
| Invited residents have an ACTIVE membership but no membership *request* | Resident screens fall back to the active membership in `user.memberships` |
| No visitor CSV export or analytics | Not required; not added |

## 2. What was built

### 2.1 Data model

Two new tables, no changes to existing tables:

**`Visitor`** — one row per request, carrying the whole lifecycle:

| Field group | Fields |
|---|---|
| Identity | `id`, `societyId`, `unitId`, `name`, `phone` (optional, E.164), `category` (`VISITOR` / `DELIVERY` / `CAB` / `OTHER`), `purpose` |
| Lifecycle | `status` (`PENDING` / `APPROVED` / `REJECTED` / `TIMED_OUT` / `CANCELLED` / `ENTERED` / `EXITED`), `approvalExpiresAt` |
| Decision | `decidedById`, `decidedAt`, `decisionNote` |
| Cancellation | `cancelledById`, `cancelledAt`, `cancelReason` |
| Gate | `entryAt`, `entryById`, `entryMethod` (`MANUAL` / `OVERRIDE`), `exitAt`, `exitById` |
| Override | `overrideReason`, `overriddenById`, `overriddenAt` |
| Idempotency | `idempotencyKey` (unique per society) |
| Provenance | `createdById`, `createdAt`, `updatedAt` |

**`VisitorNotification`** — one row per delivery attempt: `societyId`, `visitorId`, `recipientUserId`, `recipientPhone` (masked), `kind` (`APPROVAL_REQUEST` / `DECISION` / `STATUS_CHANGE`), `channel`, `delivered`, `createdAt`.

Database-level business constraints keep rows internally consistent: non-blank name/purpose, an E.164 phone when present, a decision timestamp for `APPROVED`/`REJECTED`, a cancellation timestamp for `CANCELLED`, entry/exit timestamps for `ENTERED`/`EXITED`, and an override reason whenever `entryMethod = 'OVERRIDE'`.

Actor columns intentionally have no `User` foreign key, matching the existing audit convention: a deleted staff account must not erase gate history. Names are resolved through a batched user lookup in the mapper.

### 2.2 Migration

`apps/api/prisma/migrations/20261026120000_sprint4_visitor_gate/migration.sql` creates four enums, two tables, the indexes used by the register (society + created date, status + expiry, unit + date) and the composite foreign keys that make cross-society references impossible. It was applied to `krevia_dev` after a backup (`backups/krevia_dev_pre_sprint4_20261026_180440.dump`); `prisma migrate status` reports the database up to date.

Rollback: `apps/api/prisma/rollback/20261026120000_sprint4_visitor_gate.down.sql`. Verified on a scratch database: after running it, 0 `Visitor`/`VisitorNotification` tables and 0 Sprint 4 enum types remain.

### 2.3 API

Base path: `/api/v1/societies/:societyId/visitors`. Every route is guarded by a society permission and the existing tenant-scoped access service.

| Method | Route | Permission | Behaviour |
|---|---|---|---|
| `GET` | `/visitors` | `visitor.read` | Searchable register; filters `q`, `dateFrom`, `dateTo`, `unitId`, `category`, `status`, pagination |
| `GET` | `/visitors/summary` | `visitor.read` | Today/current counts, scoped to staff or the resident's units |
| `GET` | `/visitors/destinations` | `visitor.create` | Minimal active-unit picker; no resident names or contacts |
| `POST` | `/visitors` | `visitor.create` | Register a visitor; optional `idempotencyKey` |
| `GET` | `/visitors/:visitorId` | `visitor.read` | Full lifecycle detail |
| `POST` | `/visitors/:visitorId/approve` | `visitor.approve` | `PENDING → APPROVED` |
| `POST` | `/visitors/:visitorId/reject` | `visitor.approve` | `PENDING → REJECTED` |
| `POST` | `/visitors/:visitorId/cancel` | `visitor.manage` | `PENDING`/`APPROVED → CANCELLED`, reason required |
| `POST` | `/visitors/:visitorId/entry` | `visitor.entry` | `APPROVED → ENTERED`, manual |
| `POST` | `/visitors/:visitorId/exit` | `visitor.entry` | `ENTERED → EXITED` |
| `POST` | `/visitors/:visitorId/override` | `visitor.override` | `PENDING`/`APPROVED`/`TIMED_OUT → ENTERED`, reason required |

**Lifecycle enforcement.** Every transition is a conditional `updateMany` with the expected status in the `WHERE` clause, inside a transaction with its audit event. A second concurrent action claims zero rows and receives `409`, so two guards cannot both admit the same visitor and a double-tap cannot double-record entry or exit. Approval additionally requires `approvalExpiresAt > now`, so a request cannot be approved after its window even if a lazy sweep has not run yet.

**Timeout.** Pending requests become `TIMED_OUT` after `VISITOR_APPROVAL_TTL_MINUTES` (default 30). The sweep is lazy: it runs before every read and action, claims only still-expired rows and writes a `visitor.timed_out` audit event with a null actor. There is no background scheduler.

**Duplicate and idempotent registration.** A supplied `idempotencyKey` returns the original visitor with `created: false` instead of creating a second row. Without a key, an identical open request (same flat, category and phone or name) inside `VISITOR_DUPLICATE_WINDOW_MINUTES` (default 10) is refused with `409`.

**Destinations.** Registration is refused when the flat has no active resident with an app account, because nobody could approve the request. This is a validation error with a clear remedy, not a silent pending row.

### 2.4 Notifications

The resident's pending list is the in-app channel and always works. For each linked resident with a phone, the existing `MessageSender` is called with the new `visitor` message kind, and the attempt is recorded in `VisitorNotification`. With the production-default `MESSAGE_DELIVERY=none`, the sender reports failure, the API returns `delivered: false` and the UI says "SMS delivery unavailable" rather than pretending delivery. A messaging failure never blocks registration or a lifecycle transition.

### 2.5 Web UI

| Screen | Contents |
|---|---|
| `/guard` (rewritten) | Today tiles, gate registration form with idempotent retry, live queue (pending / approved / inside) with entry, exit and cancel, and a searchable visitor history |
| `/admin/visitors` (new tab) | Society-wide counts, searchable register, entry/exit, cancel and the admin-only emergency override |
| `/resident/visitors` (new) | Pending approvals for the resident's own flat(s), approve/reject, and the flat's visitor history |
| `/admin/*` navigation | "Visitors" tab added to the existing admin sub-navigation |

The shared `apps/web/components/Visitors.tsx` holds the status badge, visitor card, register and registration form. Phone numbers are shown in full to staff and masked for residents by the API; the UI does not re-expand them. `Visitors.tsx` reports notification delivery honestly and never hides the channel.

### 2.6 Mobile UI

`apps/mobile/src/screens/VisitorScreens.tsx` (route `app/(app)/visitors.tsx`, registered in the authenticated stack) shows the resident's pending approvals with native confirmation, approve/reject actions, delivery status, and the flat's recent visitor history with entry/exit timestamps. The screen works from the resident's active membership when they were invited rather than joining through a request.

### 2.7 Shared contracts

* Six permissions and the role matrix: `ADMIN` all six; `GUARD` read/create/entry/manage; `RESIDENT` read/approve. `visitor.override` is admin-only.
* Visitor types, labels, statuses and categories in `types.ts`.
* Zod schemas for creation, decision, cancellation, override, listing and the destination picker. A date-only `dateTo` is expanded to `23:59:59.999Z` so same-day records are included.
* API-client methods for all eleven routes.
* Navigation: the `visitors` screen is now real; guard and resident menu items point at it instead of the coming-soon page.

### 2.8 Configuration and documentation

`VISITOR_APPROVAL_TTL_MINUTES` and `VISITOR_DUPLICATE_WINDOW_MINUTES` were added to config and `.env.example`; the README now documents Sprint 4, the new variables, the migration and rollback, and moves visitors out of the deferred list (QR passes remain deferred).

## 3. Capabilities reused, not duplicated

| Need | Reused |
|---|---|
| Authentication and sessions | Existing auth guard, session cookies/bearer tokens |
| Authorisation | Existing society access service and permission guard; no new auth mechanism |
| Tenant isolation | Existing `SocietyContext` resolution on every route |
| Residents and flats | Existing `Unit`, `Resident`, `ResidentUnit` records; no parallel directory |
| Audit | Existing append-only `AuditService`, transaction-aware |
| Messaging | Existing `MessageSender` abstraction and `DevOutboxSender`/`UnconfiguredSender` |
| UI shell and states | Existing `AppShell`, `RoleGate`, `AdminSocietyFrame`, `Field`, `States`, `Pager`, design tokens |
| Mobile patterns | Existing `Screen`, `Card`, `Button`, `useQuery`, `useSession` |
| Navigation | Existing module/screen contract extended in place |

No payments, complaints, amenities, staff management or other unrelated feature was added.

## 4. Files added or changed (high level)

**Added**

* `apps/api/src/visitors/{visitors.service.ts,visitors.controller.ts,visitor.mapper.ts}`
* `apps/api/prisma/migrations/20261026120000_sprint4_visitor_gate/migration.sql`
* `apps/api/prisma/rollback/20261026120000_sprint4_visitor_gate.down.sql`
* `apps/api/test/sprint4-visitors.e2e-spec.ts`
* `apps/web/components/Visitors.tsx`
* `apps/web/app/(app)/admin/visitors/page.tsx`
* `apps/web/app/(app)/resident/visitors/page.tsx`
* `apps/web/e2e/visitors.spec.ts`
* `apps/mobile/src/screens/VisitorScreens.tsx`
* `apps/mobile/app/(app)/visitors.tsx`
* `apps/mobile/__tests__/visitors.test.tsx`
* `docs/sprint-4/{implementation-report.md,test-report.md,security-report.md,known-limitations.md}`

**Changed**

* `apps/api/prisma/schema.prisma`, `app.module.ts`, `config.ts`, `audit/audit.service.ts`, `messaging/message-sender.ts`, `test/helpers.ts`, `.env.example`
* `packages/shared/src/{permissions.ts,permissions.test.ts,types.ts,validation.ts,validation.test.ts,api-client.ts,navigation.ts}`
* `apps/web/app/(app)/guard/page.tsx`, `app/globals.css`, `components/AdminSociety.tsx`, `lib/roles.ts`, `lib/web.test.ts`, `e2e/roles.spec.ts`
* `apps/mobile/app/(app)/_layout.tsx`, `src/lib/nav.ts`, `jest.setup.js`
* `README.md`

## 5. Definition of Done

| Requirement | Status |
|---|---|
| Guard registration | Done |
| Resident approval / rejection | Done |
| Entry / exit | Done |
| Timeout / cancellation / emergency override with reason | Done |
| Searchable visitor register | Done |
| Resident notifications | In-app done; SMS honest but undelivered (inherited blocker) |
| Web and mobile UI | Done |
| Server-side authorisation and tenant isolation | Done and tested |
| Migration, backup and verified rollback | Done |
| ≥ 20 scripted scenarios with real DB, API and audit checks | 24 scenarios |
| Existing tests not weakened | Full regression passes |
| Documentation with real counts and exact verdict | This report set |

## 6. Verdict

**PASS WITH BLOCKERS.** Every Sprint 4 requirement that can be exercised in this environment is implemented and verified. The single blocker is the inherited Sprint 2 messaging provider: production SMS for visitor requests is not delivered. In-app approval works, so the gate workflow itself is complete; the blocker prevents an unqualified PASS and must be closed before production.
