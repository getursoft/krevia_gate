# Krevia — Sprint 1 Acceptance Report

**Sprint status: CLOSED** · Closed on 2026-10-20
Product: **Krevia** — *Secured. Transparent. Trust.*
Machine: macOS (Darwin 25.3), Node 26.5.0, pnpm 11.10.0, PostgreSQL 17.10, Xcode 26.6, iOS Simulator 26.5.
Evidence: logs in [`evidence/`](evidence/), screenshots in [`evidence/screenshots/`](evidence/screenshots/).

## Closure summary

| # | Criterion | Result |
|---|---|---|
| 1 | Krevia branding and exact tagline consistent | **PASS** |
| 2 | Website runs and renders landing page | **PASS** |
| 3 | Website auth and protected routes work against backend | **PASS** |
| 4 | iOS builds successfully | **PASS** |
| 5 | Android builds successfully | **BLOCKED**: no JDK or Android SDK on the build machine. The Android JS bundle compiles: PASS |
| 6 | Both mobile clients integrate with the real backend | **PASS (iOS)** / **BLOCKED (Android device run)** |
| 7 | Migrations work against a clean test database | **PASS** |
| 8 | Society search uses persisted records | **PASS** |
| 9 | Membership requests persist and actual status is displayed | **PASS** |
| 10 | Unauthorized and cross-society access rejected | **PASS** |
| 11 | Automated tests execute, outcomes recorded | **PASS**: 127 tests in the final state, 0 failures |
| 12 | Type checks and linting pass | **PASS** |
| 13 | Existing unrelated functionality intact | **PASS** |
| 14 | Reproducible startup, test and build instructions | **PASS** |
| R1 | Role-based dashboards (Resident, Society Admin/AOA, Security Guard) per the multi-role showcase, on web and mobile | **PASS** |

Open items carried to Sprint 2: the Android native build and emulator run (toolchain), OTP/SMS integration, and all modules marked "Coming soon" (listed below).

## Changes made during Sprint 1 (change log)

1. **Initial build.** API, website, iOS/Android app, shared contract, tests and docs. The first build used the name "Cravia" and a redrawn mark.
2. **Product name corrected to Krevia** (product owner). Everything was renamed: UI text, page titles, package scope `@krevia/*`, session cookie `krevia_session`, header `X-Krevia-Client`, secure-store key, bundle and package ID `com.krevia.app`, iOS project `Krevia`, and databases `krevia_dev` / `krevia_test` / `krevia_e2e_test` (renamed in place, so data was kept). The official supplied **K-house logo** replaced the redrawn mark everywhere: web, mobile, app icon, adaptive icon, splash and favicon (`design/krevia-mark.png`).
3. **Role-based UI and menus** from `design/reference/Krevia Multi-Role Community App Showcase.png`:
   * New `GUARD` society role (migration `20261020130000_guard_role`). `/auth/me` returns `guardSocietyIds` and `societyRoles`. The society overview returns `totalUnits` to admins. The seed has an optional demo guard.
   * One shared definition of every role's sidebar, mobile "More" menu, quick actions and bottom tabs (`packages/shared/src/navigation.ts`, `icons.ts`, `illustrations.ts`).
   * **Web:** a role-aware shell (sidebar, society selector, feature search, notifications bell, avatar menu with view switcher). Resident `/dashboard`, Admin `/admin` (Society Dashboard) with `/admin/requests` (approvals), Guard `/guard` (Live Gate Entry), `/settings`, `/home` role redirect, and per-role "Coming soon" module pages.
   * **Mobile:** header with role label, society card, per-role home screens, role "More" menu with search, bottom tabs with a centre action button, a real admin Approvals screen (approve/reject), "Coming soon" module screens, and a view switcher in Settings.
4. **Defects found and fixed:** iOS Release startup crash (API URL config value not a string on device); app stuck on splash when the Keychain is unreadable; Xcode build failure from a full system disk (temp files moved to the project volume). Each code fix has a regression test.

## Test results (final state)

Following the product owner's instruction, only suites covering changed code were re-run after each change.

| Suite | Last run | Result |
|---|---|---|
| Shared validation (unit) | after Krevia rename | 19 / 19 passed |
| API unit + integration (`krevia_test`, recreated + migrated each run) | after role changes | **56 / 56 passed** (3 new: guard role on `/auth/me`; guard denied admin endpoints, approvals and member data; `totalUnits` for admins only) |
| Mobile (Jest + RNTL) | after role changes | **38 / 38 passed** (12 new: resident, admin and guard homes from API data; admin stats error and retry; each role's More menu matches the showcase; search; coming-soon screen; admin approve flow; view switching; no switcher for single-role users) |
| Website E2E (Playwright, real API + `krevia_e2e_test`) | after role changes | **14 / 14 passed** (3 new role tests: admin lands on `/admin` with stats equal to the API response and the exact admin menu; guard lands on `/guard` and is denied `/admin`; resident menu, coming-soon pages, feature search, no view switcher, denied `/guard`) |
| Mobile ↔ live API contract | before rename (not re-run) | 5 / 5 passed. Its only rename impact, the client header, is covered by the API suite |
| **Total in final state** | | **127 passed, 0 failed** |

Static checks after the last change: `pnpm typecheck` exit 0 and `pnpm lint` exit 0, 0 problems (`evidence/typecheck.log`, `evidence/lint.log`).

## Evidence by criterion

**1. Branding: PASS.** `BRAND.name = 'Krevia'` and `BRAND.tagline = 'Secured. Transparent. Trust.'` (`packages/shared/src/brand.ts`) are used on every surface. The E2E landing test asserts the title `Krevia — Secured. Transparent. Trust.`, the exact tagline and wordmark, and that the old name "Cravia" never appears. A source audit finds "Cravia" only in that negative assertion and in the change-log notes (this report and `initial-assessment.md`). The iOS build shows display name **Krevia** and bundle ID `com.krevia.app`. Screenshots: `web-landing.png`, `web-login.png`, `ios-welcome.png`.

**2. Website runs: PASS.** `next build` → compiled successfully, 16 routes (`evidence/web-build.log`). The dev server on :3100 returns 200.

**3. Web auth and protected routes: PASS.** E2E: validation errors, duplicate number, generic wrong-credentials error, redirects for `/dashboard`, `/profile`, `/society/join`, `/admin` (and middleware protection for `/home`, `/resident`, `/settings`, `/guard`), forged cookie rejected, logout ends access.

**4. iOS build: PASS.** `xcodebuild … -scheme Krevia -configuration Release -sdk iphonesimulator` → `** BUILD SUCCEEDED **` (`evidence/ios-build.log`, built after the role changes). Installed and launched on the iPhone 17 simulator with no crash reports.

**5. Android build: BLOCKED.** No Java runtime, Android SDK, `adb`, emulator or Gradle. `expo export --platform android` compiles the final app, including the role screens and logo assets, to a 2.9 MB Hermes bundle (`evidence/android-export.log`). Install steps are in `README.md`.

**6. Mobile ↔ backend: PASS (iOS).** On the simulator, a resident registered, searched, selected Green Valley Residency, submitted T2 · 201 · Owner and saw **Pending verification** from the API. The database shows the persisted request and a `MOBILE` session from the iOS app. The contract test (5/5) exercises bearer-token auth, search, submission, duplicate 409 and logout revocation against the live API.

**7. Clean-database migrations: PASS.** Every API run drops and recreates `krevia_test` and applies both migrations (`init`, `guard_role`). The Playwright setup does the same for `krevia_e2e_test`. Dev was migrated with `prisma migrate deploy`.

**8. Society search: PASS.** API tests cover case-insensitive name search, city and pincode search, empty results, SQL-injection input and limits. E2E searches the seeded database.

**9. Membership persistence and status: PASS.** API: created as PENDING even if the client sends APPROVED; concurrent duplicates give `[201, 409, 409]`, enforced by a DB partial unique index; withdraw and re-apply; approval changes status and grants member access. E2E: register → join → pending (survives reload) → admin approves at `/admin/requests` → resident sees Approved. Mobile: status from the API, duplicate error, admin approve.

**10. Unauthorized and cross-society access: PASS.** Covered by API tests:
* 401 on all protected routes, and for forged, expired or revoked tokens.
* An admin of one society cannot list or review another society's requests.
* Residents, applicants and **guards** cannot approve requests.
* A pending request grants nothing.
* `/me` never leaks another user's data.
* CSRF origin check, CORS allow-list and rate limiting (429).

The web and mobile staff dashboards are hidden from users without the role; E2E covers a guard on `/admin` and a resident on `/guard`.

**11. Tests: PASS.** See the totals above.

**12. Typecheck and lint: PASS.** Both exit 0 across shared, api, web and mobile.

**13. Unrelated functionality: PASS.** Greenfield repository, and the supplied images are unmodified (`design/reference/`). Other local projects on ports 3000/4000 were left untouched; Krevia uses 3100/4100.

**14. Reproducible instructions: PASS.** `README.md` covers setup, seeding (including demo admin and guard), roles, run, test and build for every platform.

**R1. Role-based dashboards: PASS.**

| | Resident | Society Admin / AOA | Security Guard |
|---|---|---|---|
| Web home | `/dashboard`: welcome banner, Quick Access (8), Recent Updates, My Society, Upcoming Events | `/admin`: Society Dashboard, 4 stats, Quick Actions (8), Recent Activity, Society Health, Complaints Overview | `/guard`: Live Gate Entry (QR, Manual Entry, Pre-Approved), Today's Summary, Today's Entries, Quick Actions |
| Web sidebar | Home, My Society, Visitors, Payments, Amenities, Complaints, Notices, Events, Directory, Buy & Sell, Documents, Settings | Dashboard, Residents, Visitors, Payments, Amenities, Complaints, Notices, Events, Staff & Vendors, Documents, Polls & Voting, Reports, Settings | Live Entry, Visitor Log, Pre-Approved, Deliveries, Staff Entry, Vehicle Entry, Resident Directory, Incident Reports, Notices, Shift & Handover, Settings |
| Mobile tabs | Home · Community · ⊕ · Buy & Sell · More | Dashboard · Approvals · ⊕ · Reports · More | Home · Entries · QR · Contacts · More |
| Live data | Membership, society and unit, status, history | Total units, residents, pending requests, recent activity, approve/reject | Assigned society |

Screenshots: `web-role-resident.png`, `web-role-resident-phone.png`, `web-role-admin.png`, `web-role-guard.png`.

## Implemented vs. not implemented

**Implemented and tested:** accounts and sessions, society search, membership requests and status, admin approvals (web and mobile), resident profile, the three role dashboards and menus, view switching, and branding.

**Present in menus as "Coming soon" (not implemented):** visitors and pre-approval, QR gate entry and visitor log, deliveries, staff and vehicle entry, payments and dues, amenities booking, complaints/helpdesk, notices, events, directory, buy & sell, documents, family members, emergency contacts, society information, polls and voting, reports and society health, staff and vendor management, community, contacts, incident reports, and shift handover. These screens show no data; the counts that depend on them are shown as "—".

## Known limitations
* Android native build and emulator run not executed (toolchain).
* OTP / SMS not integrated (no credentials), so there is no number verification and no password reset (`apps/api/src/auth/otp/otp-provider.ts`).
* Roles are assigned through the database or seed; there is no admin UI for assigning admins or guards yet.
* Registration reveals whether a number is already registered (rate-limited).
* Rate-limit counters are in-memory (single instance).
* No automated simulator UI runner (Maestro needs Java). iOS UI was verified by interactive use plus Jest and the contract test.
* No CI pipeline. Legal and contact footer links are placeholders.

## Environment changes on the build machine
`git init` (no commits made); CocoaPods 1.17.0 installed via Homebrew; databases `krevia_dev`, `krevia_test`, `krevia_e2e_test`; session-created caches removed when the system disk filled; Xcode builds use `TMPDIR=<repo>/.tmp` (git-ignored).
