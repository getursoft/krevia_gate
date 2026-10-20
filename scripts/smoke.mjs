#!/usr/bin/env node
/**
 * Krevia local smoke test: `pnpm smoke`
 *
 * Checks services that are ALREADY running (it never starts or stops servers):
 *   1. API liveness   GET  $SMOKE_API_URL/api/v1/health   → 200, service krevia-api
 *   2. Database       GET  $SMOKE_API_URL/api/v1/ready    → 200, database up
 *   3. Website        GET  $SMOKE_WEB_URL/                → 200, Krevia wordmark + exact tagline
 *   4. Web → API      GET  $SMOKE_WEB_URL/api/v1/health   → 200 through the same-origin proxy
 *   5. Auth wiring    GET  $SMOKE_API_URL/api/v1/auth/me  → 401 without a session
 *
 * Defaults are local only (http://localhost:4100 and http://localhost:3100).
 * Exits 0 when every check passes, 1 otherwise.
 */
const API = (process.env.SMOKE_API_URL ?? 'http://localhost:4100').replace(/\/+$/, '');
const WEB = (process.env.SMOKE_WEB_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 8000);
const TAGLINE = 'Secured. Transparent. Trust.';

const tty = process.stdout.isTTY;
const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (s) => paint('32', s);
const bad = (s) => paint('31', s);
const dim = (s) => paint('2', s);

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'X-Request-Id': `smoke-${Date.now()}` } });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, text, json };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? `timed out after ${TIMEOUT_MS}ms` : (err?.cause?.code ?? err?.message ?? 'request failed');
    return { status: 0, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

const checks = [
  {
    name: 'API liveness',
    url: `${API}/api/v1/health`,
    verify: (r) => r.status === 200 && r.json?.status === 'ok' && r.json?.service === 'krevia-api',
    fix: `Start the API: \`pnpm dev:api\` (port 4100). Check for "Invalid environment configuration" in its output and compare apps/api/.env with apps/api/.env.example.`,
  },
  {
    name: 'Database readiness',
    dependsOn: 'API liveness',
    url: `${API}/api/v1/ready`,
    verify: (r) => r.status === 200 && r.json?.checks?.database === 'up',
    fix: 'PostgreSQL is unreachable from the API. Start it (`brew services start postgresql@17` or your service manager), check DATABASE_URL in apps/api/.env, then run `pnpm db:migrate`. The API log has the reason (credentials redacted).',
  },
  {
    name: 'Website + branding',
    url: `${WEB}/`,
    verify: (r) => r.status === 200 && r.text.includes('Krevia') && r.text.includes(TAGLINE),
    fix: 'Start the website: `pnpm dev:web` (port 3100). If it responds but branding is missing, the wrong app may be on this port: check with `lsof -nP -iTCP:3100 -sTCP:LISTEN`.',
  },
  {
    name: 'Website → API proxy',
    dependsOn: 'Website + branding',
    url: `${WEB}/api/v1/health`,
    verify: (r) => r.status === 200 && r.json?.service === 'krevia-api',
    fix: 'The website cannot reach the API. Set API_URL in apps/web/.env.local (default http://localhost:4100) and restart `pnpm dev:web`.',
  },
  {
    name: 'Auth protection',
    dependsOn: 'API liveness',
    url: `${API}/api/v1/auth/me`,
    verify: (r) => r.status === 401 && r.json?.error?.code === 'UNAUTHENTICATED',
    fix: 'Protected endpoints must return 401 without a session. Check the API build is current: `pnpm --filter @krevia/api build`.',
  },
];

console.log(`Krevia smoke test\n${dim(`API ${API} · Web ${WEB}`)}\n`);
let failures = 0;
const failed = new Set();
for (const check of checks) {
  if (check.dependsOn && failed.has(check.dependsOn)) {
    // Root cause already reported; avoid misleading follow-up advice.
    failures += 1;
    failed.add(check.name);
    console.log(`${bad('✗')} ${check.name} ${dim(`— skipped: "${check.dependsOn}" failed`)}`);
    continue;
  }
  const started = Date.now();
  const res = await get(check.url);
  const ms = Date.now() - started;
  if (check.verify(res)) {
    console.log(`${ok('✓')} ${check.name} ${dim(`(${res.status}, ${ms}ms)`)}`);
  } else {
    failures += 1;
    failed.add(check.name);
    const got = res.status === 0 ? `no response: ${res.error}` : `HTTP ${res.status}`;
    console.log(`${bad('✗')} ${check.name} ${dim(`— ${check.url} → ${got}`)}`);
    console.log(`  ${dim('Next step:')} ${check.fix}`);
  }
}

console.log(failures === 0 ? `\n${ok('All smoke checks passed.')}` : `\n${bad(`${failures} of ${checks.length} smoke checks failed.`)}`);
process.exit(failures === 0 ? 0 : 1);
