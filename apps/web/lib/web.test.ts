import { MODULES, ROLE_NAVIGATION } from '@krevia/shared';
import { createWebLogger } from './log';
import { ROLE_HOME, hrefFor, roleFromPath } from './roles';
import { safeNext } from './safe-next';

describe('safeNext (post-login redirect guard)', () => {
  it.each(['/dashboard', '/admin/requests', '/society/join?x=1'])('allows same-site path %s', (p) => {
    expect(safeNext(p)).toBe(p);
  });
  it.each([null, undefined, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)'])(
    'falls back for %p',
    (p) => {
      expect(safeNext(p as string)).toBe('/home');
    },
  );
});

describe('role routing', () => {
  it('maps paths to roles', () => {
    expect(roleFromPath('/admin')).toBe('ADMIN');
    expect(roleFromPath('/admin/m/payments')).toBe('ADMIN');
    expect(roleFromPath('/guard')).toBe('GUARD');
    expect(roleFromPath('/dashboard')).toBe('RESIDENT');
    expect(roleFromPath('/resident/m/events')).toBe('RESIDENT');
    expect(roleFromPath('/profile')).toBeNull();
    expect(roleFromPath('/administrator')).toBeNull();
  });

  it('routes built screens directly and unbuilt modules to the role coming-soon page', () => {
    expect(hrefFor('ADMIN', MODULES.residents!)).toBe('/admin/requests');
    expect(hrefFor('GUARD', MODULES['live-entry']!)).toBe(ROLE_HOME.GUARD);
    expect(hrefFor('RESIDENT', MODULES['my-society']!)).toBe('/society/join');
    expect(hrefFor('RESIDENT', MODULES.payments!)).toBe('/resident/m/payments');
    expect(hrefFor('GUARD', MODULES['visitor-log']!)).toBe('/guard/m/visitor-log');
  });

  it('every sidebar item resolves to a route under the app', () => {
    for (const role of ['RESIDENT', 'ADMIN', 'GUARD'] as const) {
      for (const item of ROLE_NAVIGATION[role].sidebar) expect(hrefFor(role, item)).toMatch(/^\/[a-z/-]*$/);
    }
  });
});

describe('web server logger', () => {
  const capture = (level = 'debug') => {
    const lines: string[] = [];
    const log = createWebLogger({ level, env: 'test', sink: (l) => lines.push(l) });
    return { log, lines, entries: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
  };

  it('emits structured JSON with service, env, level and request id', () => {
    const { log, entries } = capture();
    log('error', 'Session check failed', { requestId: 'r-123', status: 502, route: '/api/v1/auth/me' });
    expect(entries()[0]).toMatchObject({ level: 'error', service: 'krevia-web', env: 'test', msg: 'Session check failed', requestId: 'r-123', status: 502 });
  });

  it('filters by level', () => {
    const { log, lines } = capture('warn');
    log('info', 'hidden');
    log('warn', 'shown');
    expect(lines).toHaveLength(1);
  });

  it('redacts cookies, tokens and connection-string credentials', () => {
    const { log, lines } = capture();
    log('error', 'fetch http://user:pw123@api.internal failed', { cookie: 'krevia_session=abc', authorization: 'Bearer xyz', error: new Error('token Bearer qwe.rty') });
    const text = lines.join('\n');
    for (const secret of ['pw123', 'krevia_session=abc', 'xyz', 'qwe.rty']) expect(text).not.toContain(secret);
  });
});
