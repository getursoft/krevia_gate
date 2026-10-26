# Krevia API v1 — Sprint 2 additions and changes

Conventions are unchanged from [Sprint 1](../sprint-1/api.md): base `/api/v1`, JSON, error envelope `{ error: { code, message, details?, requestId } }`, cookie (web) or bearer (mobile) sessions, OpenAPI at `/api/docs` outside production.

Every society-scoped route below is authorised by `PermissionGuard` before the handler runs, using the permission shown, from the caller's **ACTIVE** memberships in the society in the URL. A denial returns `403 FORBIDDEN` and is audited. A resource id that does not belong to the authorised society returns `404 NOT_FOUND`. List endpoints return `{ items, page, pageSize, total }` (`page` ≥ 1, `pageSize` 1–100, default 25); unknown query parameters return 400.

## Authentication

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/password-reset/request` | public, rate-limited | `{ phone }` → **202** `{ message }`. Same response for unknown numbers. 60 s resend cooldown, at most 5 codes per hour; a new code invalidates the previous one |
| POST | `/auth/password-reset/confirm` | public, rate-limited | `{ phone, code, password }` → 200. Generic 400 `VALIDATION_FAILED` (`details.code`) for wrong, expired, used or locked codes (5 attempts per code). Success revokes **all** sessions of the account |
| POST | `/auth/logout-all` | session | 204; revokes every session of the user |
| GET | `/auth/me` | session | **Changed:** `{ user, activeSocietyId }`. `user` adds `memberships[]` (all statuses). `adminSocietyIds`, `guardSocietyIds` and `societyRoles` now come from ACTIVE memberships |
| POST | `/auth/login` | public | **Changed:** audited (success and failure); Sprint 1 scrypt hashes are upgraded to Argon2id on success |
| POST | `/auth/register` | public | **Changed:** new hashes are Argon2id; audited |

## Me

| Method | Path | Notes |
|---|---|---|
| GET | `/me/memberships` | `{ items: MyMembershipSummaryDto[] }`, every society and status |
| POST | `/me/active-society` | `{ societyId }` → 200 `MeDto`. 403 (audited) unless the user holds an ACTIVE membership there. The selection is stored on the session and reads as `null` once the membership stops being ACTIVE. It is a client convenience and never grants access |

## Societies

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/societies` | `society.create` (platform) | `{ name, addressLine, city, state, pincode, towers[] }` → 201 |
| PATCH | `/societies/:societyId` | `society.update` | partial update, strict body; removing a tower that still has units → 400 |
| GET | `/societies/:id/overview` | `society.read` | **Changed:** counts ACTIVE resident memberships; admins also get `pendingRequests`, `totalUnits` |
| GET | `/societies/:id/membership-requests` | `membership.review` | **Changed:** a non-existent society now returns 403 instead of 404 (no existence check before authorisation) |
| GET | `/admin/societies` | session | **Changed:** only societies with an ACTIVE ADMIN membership; platform admins no longer see every society here |

## Members

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/societies/:societyId/members` | `membership.read` | filters `role`, `status`, `q` (name or phone) |
| PATCH | `/societies/:societyId/members/:membershipId` | `membership.manage` | `{ status: ACTIVE\|SUSPENDED\|REVOKED, reason? }`, strict body (no `role`). Own membership → 403. REVOKED is terminal (409). Cannot suspend or revoke the last ACTIVE admin (409). Revoking a resident ends their unit assignments and marks their APPROVED join request REVOKED |
| GET | `/societies/:societyId/members/export` | `data.export` | `text/csv` attachment (≤ 5,000 rows, formula-injection safe), audited |

## Units

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/societies/:societyId/units` | `unit.read` | filters `tower`, `q` (number) |
| POST | `/societies/:societyId/units` | `unit.create` | `{ tower, number }`; tower must belong to the society; duplicate → 409 |
| GET | `/societies/:societyId/units/:unitId` | `unit.read` | 404 if the unit is in another society |
| GET | `/societies/:societyId/my-units` | `household.read` | units the caller is assigned to |
| POST | `/societies/:societyId/units/:unitId/assignments` | `unit.assign` | `{ membershipId, occupancy }`; the unit and membership must both be in this society (404), and the membership must be an ACTIVE resident (409) |
| DELETE | `/societies/:societyId/units/:unitId/assignments/:assignmentId` | `unit.assign` | 204; ends the assignment |

## Invitations

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/societies/:societyId/invitations` | `membership.invite` | `{ phone, role, unitId?, occupancy? }` (residents need a unit of this society) → 201 `{ invitation, inviteUrl, delivered, channel }`. The link is returned **once** and only its hash is stored. 409 if the number is already an active/suspended member in that role or has a pending invitation for it |
| GET | `/societies/:societyId/invitations` | `membership.invite` | filter `status`; phone numbers masked; lazily marks expired ones EXPIRED |
| POST | `/societies/:societyId/invitations/:invitationId/revoke` | `membership.invite` | PENDING → REVOKED; 404 for another society's invitation |
| POST | `/invitations/preview` | public, rate-limited | `{ token }` → society, role, unit, masked phone, expiry. 404 when invalid, used, revoked or expired. The token goes in the body, never the URL |
| POST | `/invitations/accept` | session, rate-limited | `{ token }` (strict) → `MeDto`. Only the account whose phone matches; otherwise 404, same message as an unknown token. Used/revoked/expired → 409. Single use under concurrency. Role and unit come from the invitation |
| POST | `/platform/societies/:societyId/admin-invitations` | `platform.admin.assign` | `{ phone }`: invite a society's first ADMIN. Audited as `platform.admin_invited` |

## Audit and platform

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/societies/:societyId/audit-events` | `audit.read` | filters `action`, `outcome`; read-only (no write or delete routes exist) |
| GET | `/platform/audit-events` | `platform.audit.read` | all events |
| GET | `/platform/societies` | `platform.society.read` | societies with unit and active-member counts (no personal data) |

## Development only

| Method | Path | Notes |
|---|---|---|
| GET | `/dev/outbox?to=+91…` | Messages (invitation links, reset codes) that a real provider would have sent. Registered only when `MESSAGE_DELIVERY=dev-outbox`, which the API refuses in production. Never expose a non-production API that uses it to the internet |
