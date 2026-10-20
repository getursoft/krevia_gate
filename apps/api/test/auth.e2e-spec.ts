import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { hashToken } from '../src/auth/session.service';
import { PASSWORD, WEB_ORIGIN, registerMobile, resetData, setupApp, uniquePhone } from './helpers';

describe('Health, auth and sessions', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let http: () => request.Agent | ReturnType<typeof request>;

  beforeAll(async () => {
    ({ app, prisma, http } = await setupApp());
    await resetData(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('health', () => {
    it('GET /health reports ok without auth', async () => {
      const res = await http().get('/api/v1/health').expect(200);
      expect(res.body).toMatchObject({ status: 'ok', service: 'krevia-api' });
    });

    it('GET /ready reports database up', async () => {
      const res = await http().get('/api/v1/ready').expect(200);
      expect(res.body).toEqual({ status: 'ready', service: 'krevia-api', checks: { database: 'up' } });
    });

    it('unknown routes return a structured 404', async () => {
      const res = await http().get('/api/v1/does-not-exist').expect(404);
      expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('registration', () => {
    it('creates a user, normalises the phone and never returns the password hash', async () => {
      const phone = uniquePhone();
      const res = await http()
        .post('/api/v1/auth/register')
        .set('X-Krevia-Client', 'mobile')
        .send({ fullName: 'Asha Rao', phone: `+91 ${phone}`, email: 'Asha@Example.com', password: PASSWORD })
        .expect(201);
      expect(res.body.user).toMatchObject({ fullName: 'Asha Rao', phone: `+91${phone}`, email: 'asha@example.com' });
      expect(res.body.token).toEqual(expect.any(String));
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt/);
      const stored = await prisma.user.findUniqueOrThrow({ where: { phone: `+91${phone}` } });
      expect(stored.passwordHash).toMatch(/^scrypt\$/);
      expect(stored.passwordHash).not.toContain(PASSWORD);
    });

    it('stores only a hash of the session token', async () => {
      const { token, user } = await registerMobile(app);
      const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
      expect(session.tokenHash).toBe(hashToken(token));
      expect(session.tokenHash).not.toBe(token);
      expect(session.clientType).toBe('MOBILE');
    });

    it('rejects invalid input with field errors', async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .send({ fullName: 'A', phone: '12345', email: 'bad', password: 'short' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(res.body.error.details).sort()).toEqual(['email', 'fullName', 'password', 'phone']);
    });

    it('rejects non-Indian and malformed mobile numbers', async () => {
      for (const phone of ['5123456789', '+1 2025550123', '98765']) {
        const res = await http()
          .post('/api/v1/auth/register')
          .send({ fullName: 'Asha Rao', phone, password: PASSWORD })
          .expect(400);
        expect(res.body.error.details.phone).toBeDefined();
      }
    });

    it('rejects a duplicate mobile number with 409', async () => {
      const { phone } = await registerMobile(app);
      const res = await http()
        .post('/api/v1/auth/register')
        .send({ fullName: 'Someone Else', phone, password: PASSWORD })
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('rejects malformed JSON with a safe 400', async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .set('Content-Type', 'application/json')
        .send('{"fullName": ')
        .expect(400);
      expect(res.body.error).toMatchObject({ code: 'BAD_REQUEST', message: 'The request could not be understood.' });
      expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|at JSON/);
    });
  });

  describe('login', () => {
    it('logs in a web client with an httpOnly SameSite cookie and no token in the body', async () => {
      const { phone } = await registerMobile(app);
      const res = await http()
        .post('/api/v1/auth/login')
        .set('Origin', WEB_ORIGIN)
        .send({ phone, password: PASSWORD })
        .expect(200);
      expect(res.body.token).toBeUndefined();
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/krevia_session=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
    });

    it('rejects a wrong password with a generic message', async () => {
      const { phone } = await registerMobile(app);
      const res = await http().post('/api/v1/auth/login').send({ phone, password: 'Wrong12345' }).expect(401);
      expect(res.body.error).toMatchObject({ code: 'UNAUTHENTICATED', message: 'Incorrect mobile number or password.' });
    });

    it('rejects an unknown number with the same generic message', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ phone: '9999999999', password: PASSWORD })
        .expect(401);
      expect(res.body.error.message).toBe('Incorrect mobile number or password.');
    });

    it('validates login input', async () => {
      const res = await http().post('/api/v1/auth/login').send({ phone: 'abc' }).expect(400);
      expect(res.body.error.details).toHaveProperty('phone');
      expect(res.body.error.details).toHaveProperty('password');
    });
  });

  describe('protected endpoints and sessions', () => {
    it.each([
      ['get', '/api/v1/auth/me'],
      ['get', '/api/v1/profile'],
      ['patch', '/api/v1/profile'],
      ['get', '/api/v1/societies'],
      ['post', '/api/v1/membership-requests'],
      ['get', '/api/v1/membership-requests/me'],
      ['post', '/api/v1/auth/logout'],
    ] as const)('%s %s requires authentication', async (method, path) => {
      const res = await http()[method](path).expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects forged and garbage tokens', async () => {
      await http().get('/api/v1/auth/me').set('Authorization', 'Bearer forged-token').expect(401);
      await http().get('/api/v1/auth/me').set('Cookie', 'krevia_session=garbage').expect(401);
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${'x'.repeat(500)}`).expect(401);
    });

    it('GET /auth/me returns the session user (bearer)', async () => {
      const { token, user } = await registerMobile(app);
      const res = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
      expect(res.body.user).toMatchObject({ id: user.id, adminSocietyIds: [] });
    });

    it('cookie session works for web and logout revokes it', async () => {
      const { phone } = await registerMobile(app);
      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/v1/auth/login').set('Origin', WEB_ORIGIN).send({ phone, password: PASSWORD }).expect(200);
      await agent.get('/api/v1/auth/me').expect(200);
      await agent.post('/api/v1/auth/logout').set('Origin', WEB_ORIGIN).expect(204);
      await agent.get('/api/v1/auth/me').expect(401);
    });

    it('bearer logout revokes the token server-side', async () => {
      const { token } = await registerMobile(app);
      await http().post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`).expect(204);
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
      const session = await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
      expect(session.revokedAt).not.toBeNull();
    });

    it('expired sessions are rejected', async () => {
      const { token } = await registerMobile(app);
      await prisma.session.update({
        where: { tokenHash: hashToken(token) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    });
  });

  describe('CSRF / origin and CORS', () => {
    it('rejects cookie-authenticated mutations without an allowed Origin', async () => {
      const { phone } = await registerMobile(app);
      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/v1/auth/login').set('Origin', WEB_ORIGIN).send({ phone, password: PASSWORD }).expect(200);
      const noOrigin = await agent.patch('/api/v1/profile').send({ fullName: 'Hijacked' }).expect(403);
      expect(noOrigin.body.error.code).toBe('FORBIDDEN');
      await agent.patch('/api/v1/profile').set('Origin', 'https://evil.example').send({ fullName: 'Hijacked' }).expect(403);
      const ok = await agent.patch('/api/v1/profile').set('Origin', WEB_ORIGIN).send({ fullName: 'Legit Name' }).expect(200);
      expect(ok.body.user.fullName).toBe('Legit Name');
    });

    it('only allow-listed origins receive CORS headers', async () => {
      const good = await http().options('/api/v1/auth/login').set('Origin', WEB_ORIGIN).set('Access-Control-Request-Method', 'POST');
      expect(good.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
      expect(good.headers['access-control-allow-credentials']).toBe('true');
      const bad = await http().options('/api/v1/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
      expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('sets security headers', async () => {
      const res = await http().get('/api/v1/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-request-id']).toEqual(expect.any(String));
    });
  });
});

describe('Rate limiting on auth endpoints', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ app, prisma } = await setupApp({ AUTH_RATE_LIMIT: '3', AUTH_RATE_TTL_SECONDS: '60' }));
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('returns 429 RATE_LIMITED after the configured number of login attempts', async () => {
    const attempt = () =>
      request(app.getHttpServer()).post('/api/v1/auth/login').send({ phone: '9999999998', password: 'Wrong12345' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    // Non-auth endpoints are not affected by the strict auth limiter.
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });
});
