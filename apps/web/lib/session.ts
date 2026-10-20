import 'server-only';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { UserDto } from '@krevia/shared';
import { log } from './log';

const API_URL = process.env.API_URL ?? 'http://localhost:4100';

/** Validates the session cookie against the API. Returns null when not signed in. */
export async function getCurrentUser(): Promise<UserDto | null> {
  const token = (await cookies()).get('krevia_session')?.value;
  if (!token) return null;
  // Our own request id, sent to the API so both log lines can be correlated.
  const requestId = randomUUID();
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1/auth/me`, {
      headers: { Cookie: `krevia_session=${token}`, Accept: 'application/json', 'X-Request-Id': requestId },
      cache: 'no-store',
    });
  } catch (err) {
    log('error', 'Session check failed: API unreachable', { requestId, route: '/api/v1/auth/me', error: err, durationMs: Date.now() - started });
    throw new Error('Krevia API is unreachable');
  }
  if (res.status === 401) return null;
  if (!res.ok) {
    log('error', 'Session check failed', { requestId, route: '/api/v1/auth/me', status: res.status, durationMs: Date.now() - started });
    throw new Error(`Session check failed (${res.status})`);
  }
  return ((await res.json()) as { user: UserDto }).user;
}

export async function requireUser(nextPath: string): Promise<UserDto> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}
