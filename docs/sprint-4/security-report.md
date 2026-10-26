# Krevia — Sprint 4 security report

**Sprint:** Visitor & Gate Workflow · **Date:** 26 Oct 2026
**Verdict: PASS WITH BLOCKERS** — all Sprint 4 security scenarios pass; the only blocker is the inherited Sprint 2 messaging provider (see §8).

Related: [Implementation report](implementation-report.md) · [Test report](test-report.md) · [Known limitations](known-limitations.md)

---

## 1. Security model in one page

Sprint 4 adds no new authentication or authorisation mechanism. Every visitor route runs through the existing session guard, the existing society access resolver and a society permission check. The visitor service then applies a second, data-level scope:

* **Staff (`ADMIN` / `GUARD`)** see the whole society.
* **Residents** see only visitors whose `unitId` belongs to one of their active `ResidentUnit` links, where the resident record is `ACTIVE`, not archived and in the same society.
* A resident who guesses another flat's visitor id receives **404**, not 403, so the API does not confirm that the id exists.
* A guard or resident from another society is rejected by the access resolver before any visitor query runs, even when the URL carries the victim society's id.

Every lifecycle transition is a conditional `UPDATE … WHERE status = expected AND societyId = …` inside a transaction with its audit event. There is no client-supplied status field anywhere in the API.

## 2. Role–permission matrix (Sprint 4 additions)

| Permission | ADMIN | GUARD | RESIDENT |
|---|:--:|:--:|:--:|
| `visitor.read` | ✓ | ✓ | ✓ |
| `visitor.create` | ✓ | ✓ | — |
| `visitor.approve` | ✓ | — | ✓ |
| `visitor.entry` | ✓ | ✓ | — |
| `visitor.manage` (cancel) | ✓ | ✓ | — |
| `visitor.override` | ✓ | — | — |

`visitor.override` is in the shared `ADMIN_ONLY` set. The shared unit tests assert that a guard has no `visitor.approve` or `visitor.override`, that a resident has no create/entry/manage, and that an admin holds all six. Scenario 16 proves the same at the API.

Note: an admin holds `visitor.approve`, so an administrator can decide a request. This is deliberate for operational recovery; the resident decision is still attributed to the acting user in the audit trail.

## 3. Tenant isolation

### 3.1 Application layer

`RequireSocietyPermission` resolves the caller's roles in the `:societyId` from the URL. A user with no membership there is refused. After that, `findVisible()` and `list()` apply the resident unit scope. The destination picker (`/visitors/destinations`) requires `visitor.create`, so only staff can enumerate flats, and it returns only `id`, tower, number and building name — no resident names or phones.

### 3.2 Database layer

* `Visitor.societyId → Society.id` (`ON DELETE CASCADE`).
* `Visitor (unitId, societyId) → Unit (id, societyId)` — a visitor cannot point at a unit in another society, even if application code regresses.
* `VisitorNotification (visitorId, societyId) → Visitor (id, societyId)`.
* `Visitor (id, societyId)` is unique, which lets every child reference carry the society and prevents cross-society joins.
* Check constraints keep the lifecycle internally consistent (decision/cancel/entry/exit timestamps, override reason, E.164 phone).

### 3.3 Evidence from the scripted scenarios

| Scenario | Attack / misuse attempted | Result |
|---|---|---|
| 13 | Resident of flat B approves a visitor for flat A | `404`; request unchanged |
| 14 | Resident of another unit lists the register and fetches a detail by id | Empty/absent in list; `404` on detail |
| 15 | Guard of society B uses society A's URL, then substitutes the id under society B | `403` under A; `404` under B |
| 15 | Resident of society B fetches society A's visitor by id | `403` |
| 17 | Signed-in user with no society membership reads visitor history | `403` |

Scenario 15 also confirms that id substitution under the caller's own society URL cannot reach a foreign row, because the visitor query always includes `societyId`.

## 4. Lifecycle integrity and concurrency

| Control | Implementation | Evidence |
|---|---|---|
| No entry before approval | `UPDATE … WHERE status='APPROVED'` | Scenario 07 |
| No duplicate entry | Second update claims 0 rows → `409` | Scenario 08 |
| No exit before entry | `WHERE status='ENTERED'` | Scenario 09 |
| No duplicate exit | Second update claims 0 rows → `409` | Scenario 10 |
| No approval after cancellation/rejection/timeout | `WHERE status='PENDING' AND approvalExpiresAt > now` | Scenarios 11, 12, 22 |
| Concurrent approvals | Two requests race; exactly one wins, the other gets `409` | Scenario 20 |
| Single audit per transition | Audit written inside the same transaction as the claim | Scenario 04 |

The audit count is the proof that a losing concurrent request did not write a success event: scenario 04 asserts exactly one `visitor.approved` event after a duplicate attempt, and scenario 20 asserts one success and one conflict.

## 5. Emergency override controls

* Admin-only (`visitor.override`); a guard is refused (scenario 16).
* Reason is mandatory and at least 5 characters (scenario 18); the database also requires a non-null reason when `entryMethod='OVERRIDE'`.
* Allowed only from `PENDING`, `APPROVED` or `TIMED_OUT`; rejected/cancelled/exited rows cannot be resurrected.
* Records `overrideReason`, `overriddenById`, `overriddenAt`, `entryMethod='OVERRIDE'` and a `visitor.overridden` audit event containing the reason and previous status (scenario 19).
* The visitor still exits through the normal `ENTERED → EXITED` transition, so an override does not create a permanently open gate record (scenario 19).

## 6. PII exposure

| Data | Staff | Resident | Evidence |
|---|---|---|---|
| Visitor phone | Full E.164 | Masked `+91******XXXX` | Scenario 02 asserts `+91******3210` |
| Resident phone in notification log | Masked before storage | — | `VisitorNotification.recipientPhone` stores `maskPhone()` output |
| Resident names/phones in destination picker | Not returned at all | Not returned | Controller returns only unit labels |
| Visitor name, purpose, flat | Visible | Visible only for own units | Scenarios 02, 13, 14 |

The resident response is built with `revealPhone: false`; the mask is applied server-side, so a client cannot recover the full number from the payload. Visitor phone is optional and may be absent for deliveries left at the gate.

## 7. Audit coverage

Eight new append-only actions, all written in the same transaction as the state change:

| Action | Actor | Key metadata |
|---|---|---|
| `visitor.created` | guard/admin | unit, category, expiry |
| `visitor.approved` | resident/admin | previous status, whether a note was given |
| `visitor.rejected` | resident/admin | previous status, whether a note was given |
| `visitor.cancelled` | guard/admin | previous status, reason |
| `visitor.timed_out` | system (null) | unit, category, previous status |
| `visitor.entered` | guard/admin | method `MANUAL`, previous status |
| `visitor.exited` | guard/admin | previous status |
| `visitor.overridden` | admin | previous status, reason |

The audit log is readable by admins through the existing `/audit-events` endpoint; the web admin visitor page and the existing audit tab both surface it. Scenario 23 asserts the full lifecycle sequence for one visitor, and the Playwright test queries `action=visitor.exited` and checks the target id. Audit metadata never contains the visitor's full phone number.

## 8. Sprint 2 blocker carried forward

`MESSAGE_DELIVERY=none` in production because no SMS/email provider is configured. Visitor approval requests are recorded and visible in the resident's in-app pending list, but the SMS attempt returns `delivered=false` and the UI states that delivery is unavailable. The workflow is not blocked, and the API never claims delivery. This remains a release blocker for production because residents who do not open the app will not learn about a visitor at the gate.

## 9. Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Blocker (inherited) | No SMS/email provider; visitor SMS not delivered | Open — see §8 |
| 2 | Low | Timeout sweep is lazy, so a stale `PENDING` row is only marked `TIMED_OUT` on the next read/action | Accepted; approval itself also checks `approvalExpiresAt`, so no late approval is possible |
| 3 | Low | Actor columns have no `User` FK, so a deleted user's name is resolved as absent | Accepted, matches audit convention and preserves gate history |
| 4 | Info | Admins can approve on a resident's behalf | Accepted and audited; needed for operational recovery |

No high or critical Sprint 4 vulnerability was found. No authorisation, isolation or audit control was weakened; the full Sprint 1–3 regression suite still passes.

## 10. Verdict

**PASS WITH BLOCKERS.** Sprint 4 security controls are implemented and verified. The inherited messaging blocker prevents an unqualified PASS.
