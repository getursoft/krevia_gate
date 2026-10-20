# Krevia — Sprint 1 Implementation Plan

## 1. Architecture

```
krevia/ (pnpm workspace)
├── packages/shared     @krevia/shared — zod schemas, DTO types, brand tokens, API contract
├── apps/api            NestJS 11 REST API (/api/v1) + Prisma 6 + PostgreSQL
├── apps/web            Next.js 15 (App Router) responsive website
├── apps/mobile         Expo (React Native) app → iOS and Android from one code base
└── docs/               sprint docs, API notes, runbooks
```

* **One validation source.** Request schemas (Indian mobile number, email, password policy, unit details) live in `@krevia/shared` and are used by the API (zod validation pipe), the website forms, and the mobile forms.
* **Web session = httpOnly cookie, mobile session = bearer token.** Both map to the same server-side `Session` row, stored as a SHA-256 hash of a 256-bit random token, with expiry and revocation. The website calls the API through a same-origin Next.js rewrite (`/api/v1/* → API`) so the cookie is first-party.
* **Mobile token storage** uses `expo-secure-store` (iOS Keychain / Android Keystore-backed storage).

## 2. Data model (Prisma)

| Model | Key fields | Constraints |
|---|---|---|
| `User` | phone (E.164, `+91…`), email?, fullName, passwordHash, platformRole | unique phone, unique email |
| `Session` | userId, tokenHash, clientType, expiresAt, revokedAt | unique tokenHash, index userId |
| `Society` | name, slug, addressLine, city, state, pincode, towers[] | unique slug, index (city), index (name) |
| `Unit` | societyId, tower, number | unique (societyId, tower, number) |
| `SocietyRole` | userId, societyId, role (`ADMIN`) | unique (userId, societyId) |
| `MembershipRequest` | userId, societyId, unitId, occupancy (`OWNER`/`TENANT`), status (`PENDING`/`APPROVED`/`REJECTED`/`CANCELLED`), reviewedById, reviewedAt, reviewNote | partial unique index: one `PENDING`/`APPROVED` request per user |

## 3. API (all under `/api/v1`)

| Method | Path | Auth |
|---|---|---|
| GET | `/health`, `/ready` | public |
| POST | `/auth/register`, `/auth/login` | public, rate-limited |
| POST | `/auth/logout` | session |
| GET | `/auth/me` | session |
| GET / PATCH | `/profile` | session |
| GET | `/societies?q=` , `/societies/:id` | session |
| POST | `/membership-requests` | session |
| GET | `/membership-requests/me` | session |
| POST | `/membership-requests/:id/cancel` | owner of request |
| GET | `/societies/:id/membership-requests` | admin **of that society** |
| POST | `/membership-requests/:id/approve` / `reject` | admin **of the request's society** |
| GET | `/admin/societies` | societies the caller administers |

OpenAPI served at `/api/docs` (JSON at `/api/docs-json`).

Society-admin review endpoints are included so membership status changes are real (not simulated) and so cross-society isolation can be tested.

## 4. Security controls

scrypt password hashing (Node crypto, per-user salt, timing-safe compare); opaque session tokens hashed at rest; 30-day sliding-free expiry (configurable); logout revokes the session; `Secure`, `HttpOnly`, `SameSite=Lax` cookies (Secure in production); Origin check on cookie-authenticated state-changing requests (CSRF defence); `@nestjs/throttler` on auth endpoints; CORS restricted to an allowlist from env; Helmet headers; structured error envelope `{ error: { code, message, details? } }` with no stack traces; request logging that never records bodies or auth headers; seed script refuses to run in production.

## 5. Work order

1. Workspace + shared package. 2. Prisma schema, migration, seed. 3. API modules + tests. 4. Website pages + Playwright. 5. Mobile app + Jest tests. 6. iOS simulator build/run; Android bundle export (native build blocked by tooling). 7. Lint, type-check, docs, acceptance report.

## 6. Acceptance criteria

The 14 Definition-of-Done criteria from the Sprint 1 brief, each evidenced in `acceptance-report.md`.

## 7. Scope addition: role-based dashboards (product owner request)

Per `design/reference/Krevia Multi-Role Community App Showcase.png`, the product has three experiences with the same layout on web and mobile:

* **Resident**: welcome banner, My Society (society, apartment, membership status), Quick Access (8), Recent Updates, Upcoming Events. Mobile tabs: Home · Community · ⊕ · Buy & Sell · More.
* **Society Admin / AOA**: Society Overview stats (total units, residents, pending requests, complaints), Quick Actions (8), Recent Activity, Society Health, Complaints Overview, resident approvals. Mobile tabs: Dashboard · Approvals · ⊕ · Reports · More.
* **Security Guard**: Live Gate Entry console (QR scan, manual entry, pre-approved), Today's Entries, Today's Summary, quick actions. Mobile tabs: Home · Entries · QR · Contacts · More.

Data model: `SocietyRoleType` gains `GUARD` (migration `20261020130000_guard_role`). Menus come from one shared definition (`packages/shared/src/navigation.ts`). Panels backed by Sprint 1 data are live (membership, admin stats, activity, approvals). Every other module from the showcase is present in the menus and opens a clearly labelled "Coming soon" page, with no sample people or fabricated entries.
