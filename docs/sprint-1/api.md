# Krevia API v1 — Sprint 1

Base URL: `http://localhost:4100/api/v1` (dev). Interactive OpenAPI: `http://localhost:4100/api/docs` (JSON: `/api/docs-json`; disabled in production).

All responses are JSON. Errors use one envelope:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Please correct the highlighted fields.", "details": { "phone": "Enter a valid 10-digit Indian mobile number" }, "requestId": "…" } }
```

Codes: `VALIDATION_FAILED` (400), `BAD_REQUEST` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `INTERNAL` (500).

Every response carries `X-Request-Id` (a well-formed incoming value is reused); error bodies repeat it as `error.requestId`, and it appears on the request's structured log line.

Authentication: web uses the `krevia_session` httpOnly cookie, mobile sends `Authorization: Bearer <token>`. Send `X-Krevia-Client: mobile` on register/login to receive a token in the body.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | public | **Liveness.** 200 `{ status: "ok", service: "krevia-api", version, time }`. No dependency checks |
| GET | `/ready` | public | **Readiness.** 200 `{ status: "ready", service, checks: { database: "up" } }`; 503 `{ status: "not_ready", service, checks: { database: "down" } }` when PostgreSQL fails or exceeds 2 s |
| POST | `/auth/register` | public, rate-limited | `{ fullName, phone, email?, password }` → 201 `{ user, expiresAt, token? }`; 409 if phone or email is taken |
| POST | `/auth/login` | public, rate-limited | `{ phone, password }` → 200; 401 generic error |
| POST | `/auth/logout` | session | 204; revokes the session and clears the cookie |
| GET | `/auth/me` | session | `{ user }` |
| GET | `/profile` | session | `{ user }` |
| PATCH | `/profile` | session | `{ fullName?, email? }` (`""`/`null` clears email). Other fields → 400 |
| GET | `/societies?q=&limit=` | session | Case-insensitive search on name, city, address; pincode prefix. `limit` 1–50 (default 20) |
| GET | `/societies/:id` | session | Public directory info + `towers` |
| GET | `/societies/:id/overview` | approved member or society admin | `{ society, approvedMembers, pendingRequests?, totalUnits? }` (the last two for admins only) |
| POST | `/membership-requests` | session | `{ societyId, tower, unitNumber, occupancy: OWNER\|TENANT }` → 201 `PENDING`; 409 when the user already has a PENDING/APPROVED request; 400 for a tower not in the society |
| GET | `/membership-requests/me` | session | `{ current, history }` (current = PENDING or APPROVED) |
| POST | `/membership-requests/:id/cancel` | owner | PENDING → CANCELLED; 404 for other users' requests |
| GET | `/admin/societies` | session | Societies the caller administers |
| GET | `/societies/:id/membership-requests?status=` | admin of that society | Includes applicant name and phone |
| POST | `/membership-requests/:id/approve` | admin of the request's society | `{ note? }`; 409 if already reviewed; 403 for own request |
| POST | `/membership-requests/:id/reject` | admin of the request's society | `{ note? }` |

`user` objects include `adminSocietyIds`, `guardSocietyIds` and `societyRoles` (`{ societyId, societyName, city, state, role: ADMIN | GUARD }`), which clients use to pick dashboards. Guards have no admin permissions: every admin endpoint returns 403 for them.

Validation rules are defined once in `packages/shared/src/validation.ts` and used by the API, the website and the mobile app.
