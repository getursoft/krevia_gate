#!/usr/bin/env bash
# Runs the same checks as .github/workflows/ci.yml on this machine: `pnpm ci:local`
#
# Uses the local TEST databases only (apps/api/.env.test → krevia_test, and
# krevia_e2e_test for Playwright). Development data is never touched: both reset
# scripts refuse any database whose name does not end in _test.
# Stops at the first failing step and exits non-zero.
set -euo pipefail
cd "$(dirname "$0")/.."

results=()
step() {
  local name="$1"; shift
  printf '\n\033[1m▶ %s\033[0m\n' "$name"
  local start=$SECONDS
  if "$@"; then
    results+=("✓ $name ($((SECONDS - start))s)")
  else
    results+=("✗ $name")
    printf '\n\033[31mCI step failed: %s\033[0m\n' "$name"
    printf '%s\n' "${results[@]}"
    exit 1
  fi
}

if command -v pg_isready >/dev/null && ! pg_isready -h localhost -q; then
  echo "PostgreSQL is not accepting connections on localhost:5432. Start it first (see README → Troubleshooting)." >&2
  exit 1
fi

step "Install dependencies (frozen lockfile)" pnpm install --frozen-lockfile
step "Build shared package" pnpm build:shared
step "Lint" pnpm lint
step "Typecheck" pnpm typecheck
step "Shared tests" pnpm test:shared --ci
step "API unit + integration tests" pnpm test:api --ci
step "Web unit tests" pnpm test:web:unit --ci
step "Mobile unit tests" pnpm test:mobile --ci
# Build into a separate dir so a running `pnpm dev:web` (.next) is not disturbed.
step "Build web app" env NEXT_DIST_DIR=.next-ci pnpm --filter @krevia/web build
step "Web end-to-end tests" pnpm test:e2e
step "Android JS bundle export" pnpm export:android

printf '\n\033[32mAll CI steps passed locally.\033[0m\n'
printf '%s\n' "${results[@]}"
