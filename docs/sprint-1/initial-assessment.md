# Krevia — Sprint 1 Initial Assessment

Date: 2026-10-20
Working directory: `/Volumes/Personal/krevia-gate`

## 1. Repository baseline

| Item | Finding |
|---|---|
| Git | Not a Git repository at start. `git init` was run (no commits made). |
| Source code | **None.** No package manifests, apps, backend modules, Prisma schema, migrations, tests, CI or env files existed. |
| Assets | Two raster images supplied by the product owner: `Krevia Secured Trust Logo.png` (logo) and `Krevia Community Management UI Showcase.png` (web + mobile UI direction). Both are 1536×1024 PNG. |
| README | None. |

Conclusion: Sprint 1 is a greenfield implementation. There is no existing functionality to preserve, and no obsolete code to migrate.

### Branding observation

The supplied logo is the official brand: the **Krevia** "K" monogram sheltering a house with a window grid, a green swoosh and leaf accent, and the tagline "Secured. Transparent. Trust." The product uses this mark directly (`design/krevia-mark.png`, cut from the supplied logo) with a text wordmark. The UI showcase guides the layout. The originals are kept unmodified under `design/reference/`.

> Change log: an earlier Sprint 1 build used the name "Cravia" and a redrawn "C" mark. The product owner confirmed the name is **Krevia**, and the product was renamed throughout (code, identifiers, databases, assets, docs).

Palette sampled from the supplied artwork:

| Token | Hex | Source |
|---|---|---|
| Forest (primary) | `#074331` | logo letterforms |
| Leaf (accent) | `#49994E` | logo leaf / swoosh |
| Mint surface | `#EAF3EE` | UI card backgrounds |
| Page background | `#F6F9F7` | UI canvas |

## 2. Toolchain inventory

| Tool | Status |
|---|---|
| Node.js | v26.5.0 (default); node@24 also installed via Homebrew |
| npm / pnpm | npm 11.17.0, pnpm 11.10.0 |
| PostgreSQL | Server 17 running (Homebrew service, socket `/tmp:5432`); `psql` client 14.23 |
| Docker | 29.6.2 available (not required) |
| Xcode | 26.6 (17F113), iOS Simulator runtime iOS 26.5 available |
| CocoaPods | **Missing** at start (required for iOS native builds). Installed 1.17.0 via Homebrew during Sprint 1. |
| Java / JDK | **Missing** |
| Android SDK, `adb`, emulator, Gradle | **Missing** |
| Watchman | Missing (optional) |
| Disk | System volume had ≈229 MB free (project volume 190 GB free); this caused one Xcode build failure, see acceptance report |

## 3. Existing vs. missing capabilities

Every Sprint 1 capability is missing: backend, database schema, authentication, society search, membership requests, dashboard, profile, website, iOS app, Android app, tests and docs.

## 4. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Android toolchain absent (no JDK, no SDK) | Native Android build cannot run on this machine | Shared React Native code base; Android JS bundle is still compiled via `expo export --platform android`; exact install steps documented; status reported as BLOCKED, not PASS. |
| CocoaPods absent | iOS native build blocked | Install CocoaPods via Homebrew (developer tool, non-destructive). |
| Very new package majors on npm (TypeScript 7, Prisma 7/8, Next 16) | Unknown breaking changes | Pin proven majors for backend/web (TS 5.9, Prisma 6, NestJS 11, Next 15). Mobile uses the current Expo SDK so it matches Xcode 26.6. |
| No SMS/OTP or email provider credentials | Cannot deliver OTP | Password authentication on Indian mobile number; an `OtpProvider` interface marks the integration boundary and is documented as unconfigured. |
| Product name confirmation | Brand inconsistency | Confirmed as Krevia by the product owner; renamed throughout, official logo used. |
