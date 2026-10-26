# Krevia — Sprint 2 security verification report

**Sprint:** Secure Society Accounts · **Branch:** `sprint-2/secure-society-accounts` · **Date:** 21 Oct 2026
**Verdict: PASS WITH BLOCKERS**. Every mandatory acceptance scenario passes against a real PostgreSQL database, and no critical or high findings are open. The release blocker is operational: no SMS/email provider is configured, so in production password-reset codes cannot be delivered (invitations still work, because admins can share the one-time link). See §8.

Related: [API changes](api.md) · [Migration and rollback](migrations.md) · [Sprint 1 auth model](../sprint-1/auth-and-security.md)

---

## 1. Implemented features and user-visible workflows

| Workflow | Website | API |
|---|---|---|
| Sign in / sign out | `/login`, user menu | `POST /auth/login`, `/auth/logout` |
| Sign out on all devices | Settings → *Sign out on all devices* | `POST /auth/logout-all` |
| Password reset by 6-digit code | `/login` → *Forgot password?* → `/forgot-password` | `POST /auth/password-reset/request`, `/confirm` |
| Invite a resident (with flat), guard or co-admin | Admin → Resident management → **Invitations** (link shown once, copy button) | `POST /societies/:id/invitations` |
| Accept an invitation (sign in or register first) | `/invite?token=…` → *Accept invitation* | `POST /invitations/preview`, `/invitations/accept` |
| Revoke a pending invitation | Invitations list → *Revoke* | `POST …/invitations/:id/revoke` |
| Roster, suspend, reactivate, revoke | Admin → **Members** (filters, search, *Export CSV*) | `GET/PATCH /societies/:id/members…`, `GET …/members/export` |
| Units and resident assignment | Admin → **Units** (add flat, assign/remove resident) | `…/units`, `…/units/:id/assignments` |
| Self-service join request (Sprint 1), approval now creates a membership and a unit assignment | `/society/join`, Admin → **Join requests** | unchanged routes |
| Audit log | Admin → **Audit log** (filter by outcome) | `GET /societies/:id/audit-events` |
| Multiple societies, active society | Settings → *Your societies* → *Make active* | `GET /me/memberships`, `POST /me/active-society` |
| Create a society and invite its first admin | API only (platform administrators) | `POST /societies`, `POST /platform/societies/:id/admin-invitations` |

Mobile compatibility: the shared API client and DTOs gained fields only (`/auth/me` still returns `user`). The mobile unit tests (38) and the mobile contract test against a live API (5) pass unchanged.

## 2. Database schema changes and migrations

One migration: `20261021090000_sprint2_secure_accounts`. It adds `Membership`, `UnitAssignment`, `Invitation`, `PasswordResetCode` and `AuditEvent`, plus `Session.activeSocietyId` and `User.passwordChangedAt`. It migrates `SocietyRole` rows and approved join requests into memberships and unit assignments, then drops `SocietyRole`. Tenant integrity is enforced in the database too:

* **Composite foreign keys** pin every `UnitAssignment` (and every resident `Invitation`) to a unit and membership of the **same** society. A direct SQL insert that mixes societies fails (tested).
* Unique `(userId, societyId, role)` prevents duplicate memberships. Partial unique indexes allow one PENDING invitation per (society, phone, role), one open assignment per (membership, unit), and (Sprint 1) one open join request per user.
* Check constraints cover the phone format, resident invitations (unit and occupancy required) and assignment dates.
* A trigger makes `AuditEvent` append-only.

Details, verification and the rollback procedure are in [migrations.md](migrations.md).

## 3. API endpoints added or modified

Full list in [api.md](api.md). **Added (26, including the development-only outbox):** password-reset request and confirm, logout-all, me/memberships, me/active-society, create and update society, members list/patch/export, units list/create/detail/my-units, assign and unassign, invitations create/list/revoke/preview/accept, platform admin-invitation, society and platform audit events, platform societies, and the dev outbox (non-production only). **Modified:**
* `/auth/me` adds `activeSocietyId` and `memberships`.
* Login and registration are audited and use Argon2id.
* Overview counts ACTIVE memberships.
* `/admin/societies` no longer lists every society for platform admins.
* `membership-requests` routes go through the central policy.

## 4. Role–permission matrix

Defined once in `packages/shared/src/permissions.ts` and enforced by `PermissionGuard` → `SocietyAccessService` (`apps/api/src/authz`). Society permissions come only from **ACTIVE** memberships in the society named in the URL, read from the database on every request. Platform permissions come from `User.platformRole` and include **no** society permission.

| Permission | Resident | Security guard | Society admin | Platform admin |
|---|:-:|:-:|:-:|:-:|
| `society.read` (overview) | ✓ | – | ✓ | – |
| `household.read` (my units) | ✓ | – | – ¹ | – |
| `security.access` (gate) | – | ✓ | – | – |
| `society.update` | – | – | ✓ | – |
| `membership.read` / `membership.review` / `membership.invite` / `membership.manage` | – | – | ✓ | – |
| `unit.read` / `unit.create` / `unit.assign` | – | – | ✓ | – |
| `audit.read` (own society) | – | – | ✓ | – |
| `data.export` | – | – | ✓ | – |
| `society.create` | – | – | – | ✓ |
| `platform.society.read` (list + counts, no personal data) | – | – | – | ✓ |
| `platform.admin.assign` (invite a society's admin) | – | – | – | ✓ |
| `platform.audit.read` | – | – | – | ✓ |

¹ An admin who also lives in the society holds a separate RESIDENT membership; permissions are the union of the person's ACTIVE roles.

Guardrails beyond the matrix:
* Admins cannot change their own membership.
* The last ACTIVE admin cannot be suspended or revoked.
* REVOKED is terminal.
* Roles are granted only by invitations (or join-request approval for residents) and never read from a request body. Status updates use strict schemas, so a `role` field is rejected with 400.

## 5. Automated test results

Final run on the branch head, local PostgreSQL 17, Node 26:

| Suite | Command | Result |
|---|---|---|
| Shared (validation, permission matrix) | `pnpm test:shared` | **26 passed, 0 failed** |
| API unit + integration (real `krevia_test` DB) | `pnpm test:api` | **128 passed, 0 failed** (75 Sprint 1 + 53 Sprint 2) |
| Web unit | `pnpm test:web:unit` | **16 passed, 0 failed** |
| Mobile unit | `pnpm test:mobile` | **38 passed, 0 failed** |
| Mobile contract vs. live API | `pnpm --filter @krevia/mobile test:contract` | **5 passed, 0 failed** |
| Browser e2e (Playwright, real API + website + `krevia_e2e_test`) | `pnpm test:e2e` | **18 tests, all passing.** The final full run reported 15 passed / 3 failed. All 3 failures were 60 s timeouts (e.g. `browserContext.newPage` timeout) while the machine's load average was ~34 from an unrelated iOS Simulator. Re-run on the same code: **3 passed** in 27 s. In the run just before (code unchanged since), the 4 new Sprint 2 tests and the 14 Sprint 1 tests all passed |
| Typecheck | `pnpm typecheck` | pass (all 5 workspaces) |
| Lint | `pnpm lint` | pass, 0 problems |
| Build | `pnpm build` | pass (shared, API, website) |

**Total automated tests:** 231 (26 + 128 + 16 + 38 + 5 + 18). **0 failing after the rerun.**

Existing tests that were changed, and why (none was weakened or skipped):
* `auth.e2e-spec.ts` and `password.spec.ts` asserted the *scrypt* prefix of new hashes. The sprint requires Argon2id, so they now assert `$argon2id$`. The response-leak check was extended to also forbid `argon2`, and a test was added that Sprint 1 scrypt hashes still verify and are upgraded.
* `observability.e2e-spec.ts` built a production config without `AUTH_PEPPER`, which production now requires. The fixture now supplies one, with the assertion unchanged, and a new test checks that production refuses a missing pepper and the dev outbox.
* `test/helpers.ts` creates staff roles as `Membership` rows (the `SocietyRole` table no longer exists) and truncates the new tables.

## 6. Cross-tenant attack scenarios executed

All scenarios are in `apps/api/test/sprint2-security.e2e-spec.ts` and run against the real database with Society A and Society B. Every one passes.

| # | Scenario (sprint brief) | Attack performed | Result |
|---|---|---|---|
| 1 | Unauthenticated access | 14 protected society/membership routes with no session | 401 each |
| 2 | A resident reads own society | overview, my-units | 200, only own unit |
| 3 | Resident reads Society B by changing the id | 8 B routes (overview, my-units, members, units, unit detail, invitations, audit, export) | 403 each, no B data in body |
| 4 | Resident updates/deletes a B resource | PATCH B member, DELETE B assignment, revoke B invitation, PATCH B society | 403. **And:** A admin putting B ids under the A URL gets 404, and the DB shows nothing changed |
| 5 | Lists/search leak B | members, units, invitations, audit lists; search by B resident's name and phone; filter by B-only tower | only A rows; totals match A counts; 0 results |
| 6 | Nested B unit under an A URL | GET A/units/{B unit}, assign to B unit, invite with B `unitId` | 404; no invitation row created |
| 7 | Guard calls admin operations | 10 admin endpoints in the guard's own society | 403 each; target unchanged |
| 8 | Admin administers another society | 7 admin endpoints on Society B | 403 each; no membership created |
| 9 | Revoked membership keeps access | suspend → overview 403 → reactivate → 200 → revoke → overview/my-units 403, active society cleared, units ended, revoke is terminal | immediate on next request |
| 10 | Expired/revoked/invalid tokens | garbage, over-long, forged cookie, DB-expired session, logged-out token, logout-all on 2 sessions, sessions after password reset | 401 each |
| 11 | Invitation reuse | accept twice, 3 concurrent accepts, after revoke, after expiry, wrong phone, unknown and malformed token | 409 / 409 / 404 / 400 as specified; exactly one membership |
| 12 | Self-assigned privileged role | `role` in accept body, `role` in member PATCH, resident inviting self as ADMIN, `platformRole`/`adminSocietyIds` at register, `status`/`role` on join request, spoofed `X-User-Id` | 400 / 403 / ignored; no privilege gained |
| 13 | Assign a unit across societies | API with B membership on A unit; **direct DB inserts** mixing societies | 404; DB rejects both inserts (composite FKs) |
| 14 | Denials are audited | guard reading B members with a fixed `X-Request-Id`; failed login; failed acceptance | `authz.denied` / `auth.login FAILURE` / `invitation.accept_failed` rows with actor, society, permission, route and request id; no password or phone stored |
| 15 | CRUD, pagination, filter, export isolation | page 1/2/3 with pageSize=1 while B has 4 units; pageSize 500; extra `societyId` query param; CSV export | A totals only; empty past end; 400 for bad params; CSV has no B data and neutralises `=` formulas |
| – | Platform admin has no implicit tenant access | platform admin on members/units/invitations/audit/overview of A and of a society it created | 403; can still create the society and invite its admin (both audited) |
| – | Audit tampering | Prisma `update` / `deleteMany` on AuditEvent; HTTP DELETE/PATCH | DB raises "append-only"; routes do not exist (404) |

Browser-level checks (Playwright, `apps/web/e2e/account-security.spec.ts`):
* Reset password via the UI.
* Invited resident registers through the link, accepts, then cannot reuse it.
* Admin suspends the member and sees it in the audit log.
* A different number cannot accept someone else's invitation.
* A guard is refused the admin pages and the admin API.

## 7. Audit events implemented

Every event stores `createdAt`, `requestId` (same as the `X-Request-Id` response header and access-log line), `actorUserId` (when known), `action`, `outcome` (SUCCESS / FAILURE / DENIED), `societyId` (when applicable), `targetType`/`targetId` and small redacted `metadata`. Passwords, codes, tokens and phone numbers are never stored. Invitation events keep a masked phone; failed logins reference a known account by id only.

| Area | Actions |
|---|---|
| Authentication | `auth.register`, `auth.login` (success and failure), `auth.logout`, `auth.logout_all` |
| Password reset | `auth.password_reset.requested` (success, or failure for unknown account / cooldown / hourly limit), `auth.password_reset.completed`, `auth.password_reset.failed` (wrong / expired / used code, too many attempts) |
| Authorisation | `authz.denied` (permission, roles held, route; society and platform scope) |
| Invitations | `invitation.created`, `invitation.accepted`, `invitation.accept_failed`, `invitation.revoked`, `invitation.expired` |
| Memberships and roles | `membership.created` (via invitation or join request, including re-activation), `membership.status_changed` (from → to, reason), `membership.request.created` / `approved` / `rejected` |
| Units | `unit.created`, `unit.assigned`, `unit.unassigned` |
| Society administration | `society.created`, `society.updated` (changed field names), `data.exported` |
| Platform | `platform.admin_invited`, plus `society.created` by platform admins |
| Sessions | `session.active_society.changed` |

Events an attacker can trigger at will (failed logins, denials, failed resets and acceptances) are rate-limited to 20 per key per minute. The excess is counted and reported on the log, not written. Success events are written in the same transaction as the change they describe. Admins can only read their own society's events; nothing in the API writes, edits or deletes them; and a database trigger rejects `UPDATE`/`DELETE` even from the application's own database user.

## 8. Known limitations and unresolved findings

No critical or high findings are open.

| Severity | Item | Status / mitigation |
|---|---|---|
| **Blocker (operational)** | No SMS/email provider is configured. In production (`MESSAGE_DELIVERY=none`) password-reset codes are generated but **not delivered**, so self-service reset does not work there. Invitations work, because the admin gets the one-time link to share. | Needs provider credentials plus DLT template registration (TRAI). The `MessageSender` interface is the integration point; development uses the in-memory dev outbox. |
| Medium | Registration still answers 409 for an already registered number (carried over from Sprint 1). Login and reset responses are generic as required. | Rate-limited. Close once phone verification by OTP exists. |
| Medium | Phone numbers are not verified at registration. Invitation acceptance trusts that the account's phone belongs to the person, so someone who registered another person's number first could accept an invitation meant for them. | The admin sees who accepted, can revoke, and the audit log records it. Fix with OTP verification at registration (needs the same SMS provider). |
| Low | Password-reset requests for unknown numbers return slightly faster than for real ones (timing side channel). | Per-IP rate limit. Could be equalised with constant-time padding. |
| Low | The audit trigger stops UPDATE/DELETE, but a database owner can still `TRUNCATE` or drop the trigger. | Run the API with a database role that does not own the tables (documented recommendation); ship audit events to external storage later. |
| Low | Rate-limit and audit-suppression counters are in memory, per API instance. | Use a shared store (Redis) when running more than one instance. |
| Low | `/membership-requests/:id/approve|reject` answer 403 (not 404) to an admin of another society, which confirms that the request id exists. Kept for Sprint 1 test compatibility. | Ids are random UUIDs and the denial is audited. Society-URL routes added this sprint return 404 for foreign ids. |
| Info | `GET /dev/outbox` is public when `MESSAGE_DELIVERY=dev-outbox`. The API refuses that value in production, but a server started with `NODE_ENV=development` and reachable from the internet would expose reset codes. | Never expose a development-mode API; documented in `.env.example`, README and api.md. |
| Info | Login has per-IP throttling but no per-account lockout. | Argon2id slows guessing. Consider per-account backoff with the Redis store. |
| Info | Rolling back to the Sprint 1 build cannot read Argon2id hashes written after upgrade. | Documented in migrations.md. |

## 9. Commands

```bash
# one-time setup
pnpm install
cp apps/api/.env.example apps/api/.env && cp apps/api/.env.test.example apps/api/.env.test
createdb krevia_dev && createdb krevia_test && createdb krevia_e2e_test

# migrations and seed (dev)
pnpm db:migrate                 # applies 20261021090000_sprint2_secure_accounts
pnpm db:seed                    # optional demo admin / guard / platform admin via SEED_* vars

# run
pnpm dev                        # API :4100 + website :3100
curl 'http://localhost:4100/api/v1/dev/outbox?to=%2B919876543210'   # read invite links / reset codes (dev only)

# verify
pnpm typecheck && pnpm lint
pnpm test                       # shared + API (real krevia_test DB) + web unit + mobile unit
pnpm test:api                   # API only, includes test/sprint2-security.e2e-spec.ts
pnpm test:e2e                   # Playwright against real API + website
pnpm build

# rollback (see migrations.md)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/rollback/20261021090000_sprint2_secure_accounts.down.sql
```

Production additionally requires `AUTH_PEPPER` (32+ random characters) and `COOKIE_SECURE` behind HTTPS (forced on when `NODE_ENV=production`).

## 10. Verdict

**PASS WITH BLOCKERS.**

* **Pass:** all 15 mandatory acceptance scenarios and the additional authentication, invitation, platform-admin and audit-immutability tests pass against a real database (128/128 API tests, 0 failures). The authentication and membership flows work end to end in the browser (4 Sprint 2 Playwright tests plus 14 Sprint 1 tests passing). Typecheck, lint and build pass. No critical or high security findings remain.
* **Blocker:** production delivery of password-reset codes (and of invitation messages) needs an SMS/email provider that does not exist yet. Until one is configured, password reset cannot be offered in production. Every other Sprint 2 capability is release-ready.
