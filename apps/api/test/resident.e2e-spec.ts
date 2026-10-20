import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, Society } from '@prisma/client';
import type request from 'supertest';
import { createAdmin, createGuard, createSociety, registerMobile, resetData, setupApp } from './helpers';

describe('Profile, societies and membership', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let http: () => ReturnType<typeof request>;
  let greenValley: Society;
  let lakeview: Society;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    ({ app, prisma, http } = await setupApp());
    await resetData(prisma);
    greenValley = await createSociety(prisma, 'Green Valley Residency', ['T1', 'T2', 'T3']);
    lakeview = await createSociety(prisma, 'Lakeview Heights', ['A', 'B']);
    await prisma.society.update({ where: { id: lakeview.id }, data: { city: 'Bengaluru', pincode: '560103' } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('profile', () => {
    it('returns and updates only my own profile', async () => {
      const me = await registerMobile(app, { fullName: 'Ravi Kumar' });
      const other = await registerMobile(app, { fullName: 'Other Person' });
      const got = await http().get('/api/v1/profile').set(auth(me.token)).expect(200);
      expect(got.body.user.id).toBe(me.user.id);

      const updated = await http()
        .patch('/api/v1/profile')
        .set(auth(me.token))
        .send({ fullName: 'Ravi K. Sharma', email: 'ravi@example.in' })
        .expect(200);
      expect(updated.body.user).toMatchObject({ fullName: 'Ravi K. Sharma', email: 'ravi@example.in' });

      const otherAfter = await prisma.user.findUniqueOrThrow({ where: { id: other.user.id } });
      expect(otherAfter.fullName).toBe('Other Person');
    });

    it('clears email with an empty string', async () => {
      const me = await registerMobile(app, { email: 'clear.me@example.in' });
      const res = await http().patch('/api/v1/profile').set(auth(me.token)).send({ email: '' }).expect(200);
      expect(res.body.user.email).toBeNull();
    });

    it('validates updates and rejects unsupported fields', async () => {
      const me = await registerMobile(app);
      const bad = await http().patch('/api/v1/profile').set(auth(me.token)).send({ email: 'nope' }).expect(400);
      expect(bad.body.error.details.email).toBeDefined();
      await http().patch('/api/v1/profile').set(auth(me.token)).send({}).expect(400);
      // Phone number and role cannot be changed through the profile endpoint.
      await http().patch('/api/v1/profile').set(auth(me.token)).send({ phone: '9123456789' }).expect(400);
      await http().patch('/api/v1/profile').set(auth(me.token)).send({ platformRole: 'PLATFORM_ADMIN' }).expect(400);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: me.user.id } });
      expect(stored.platformRole).toBe('RESIDENT');
    });

    it('rejects an email already used by another account', async () => {
      await registerMobile(app, { email: 'taken@example.in' });
      const me = await registerMobile(app);
      const res = await http().patch('/api/v1/profile').set(auth(me.token)).send({ email: 'TAKEN@example.in' }).expect(400);
      expect(res.body.error.details.email).toMatch(/already linked/);
    });
  });

  describe('society search', () => {
    let token: string;
    beforeAll(async () => {
      ({ token } = await registerMobile(app));
    });

    it('searches persisted societies by partial, case-insensitive name', async () => {
      const res = await http().get('/api/v1/societies?q=valley').set(auth(token)).expect(200);
      expect(res.body.items.map((s: Society) => s.name)).toEqual(['Green Valley Residency']);
    });

    it('searches by city and pincode prefix', async () => {
      const byCity = await http().get('/api/v1/societies?q=bengal').set(auth(token)).expect(200);
      expect(byCity.body.items.map((s: Society) => s.name)).toEqual(['Lakeview Heights']);
      const byPin = await http().get('/api/v1/societies?q=5601').set(auth(token)).expect(200);
      expect(byPin.body.items.map((s: Society) => s.name)).toEqual(['Lakeview Heights']);
    });

    it('returns an empty list when nothing matches', async () => {
      const res = await http().get('/api/v1/societies?q=zzzz-nothing').set(auth(token)).expect(200);
      expect(res.body.items).toEqual([]);
    });

    it('does not treat search input as SQL', async () => {
      const res = await http()
        .get(`/api/v1/societies?q=${encodeURIComponent("' OR 1=1 --")}`)
        .set(auth(token))
        .expect(200);
      expect(res.body.items).toEqual([]);
    });

    it('validates limit and query length', async () => {
      await http().get('/api/v1/societies?limit=0').set(auth(token)).expect(400);
      await http().get(`/api/v1/societies?q=${'a'.repeat(81)}`).set(auth(token)).expect(400);
    });

    it('returns society details with towers', async () => {
      const res = await http().get(`/api/v1/societies/${greenValley.id}`).set(auth(token)).expect(200);
      expect(res.body.society).toMatchObject({ id: greenValley.id, towers: ['T1', 'T2', 'T3'] });
    });

    it('rejects malformed ids with 400 and unknown ids with 404', async () => {
      const bad = await http().get('/api/v1/societies/not-a-uuid').set(auth(token)).expect(400);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
      await http().get('/api/v1/societies/00000000-0000-4000-8000-000000000000').set(auth(token)).expect(404);
    });
  });

  describe('membership requests', () => {
    const submit = (token: string, body: Record<string, unknown>) =>
      http().post('/api/v1/membership-requests').set(auth(token)).send(body);

    it('creates a PENDING request even if the client asks for APPROVED, and persists it', async () => {
      const me = await registerMobile(app);
      const res = await submit(me.token, {
        societyId: greenValley.id,
        tower: 't1',
        unitNumber: '1203',
        occupancy: 'OWNER',
        status: 'APPROVED',
      }).expect(201);
      expect(res.body.request).toMatchObject({
        status: 'PENDING',
        tower: 'T1',
        unitNumber: '1203',
        occupancy: 'OWNER',
        society: { id: greenValley.id, name: 'Green Valley Residency' },
      });
      const stored = await prisma.membershipRequest.findUniqueOrThrow({ where: { id: res.body.request.id } });
      expect(stored.status).toBe('PENDING');

      const mine = await http().get('/api/v1/membership-requests/me').set(auth(me.token)).expect(200);
      expect(mine.body.current.id).toBe(res.body.request.id);
      expect(mine.body.history).toHaveLength(1);
    });

    it('a pending request does not grant member privileges', async () => {
      const me = await registerMobile(app);
      await submit(me.token, { societyId: greenValley.id, tower: 'T2', unitNumber: '201', occupancy: 'TENANT' }).expect(201);
      const res = await http().get(`/api/v1/societies/${greenValley.id}/overview`).set(auth(me.token)).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('prevents duplicate submissions (sequential and concurrent)', async () => {
      const me = await registerMobile(app);
      const body = { societyId: greenValley.id, tower: 'T1', unitNumber: '501', occupancy: 'OWNER' };
      const results = await Promise.all([submit(me.token, body), submit(me.token, body), submit(me.token, body)]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409]);
      const again = await submit(me.token, { ...body, societyId: lakeview.id, tower: 'A' }).expect(409);
      expect(again.body.error.code).toBe('CONFLICT');
      expect(await prisma.membershipRequest.count({ where: { userId: me.user.id } })).toBe(1);
    });

    it('validates input', async () => {
      const me = await registerMobile(app);
      const res = await submit(me.token, { societyId: 'nope', tower: '', unitNumber: '#$%', occupancy: 'GUEST' }).expect(400);
      expect(Object.keys(res.body.error.details).sort()).toEqual(['occupancy', 'societyId', 'tower', 'unitNumber']);
      await submit(me.token, {
        societyId: '00000000-0000-4000-8000-000000000000',
        tower: 'T1',
        unitNumber: '1',
        occupancy: 'OWNER',
      }).expect(404);
      const badTower = await submit(me.token, { societyId: greenValley.id, tower: 'Z9', unitNumber: '1', occupancy: 'OWNER' }).expect(400);
      expect(badTower.body.error.details.tower).toBeDefined();
    });

    it('returns no current request for a new user', async () => {
      const me = await registerMobile(app);
      const res = await http().get('/api/v1/membership-requests/me').set(auth(me.token)).expect(200);
      expect(res.body).toEqual({ current: null, history: [] });
    });

    it('lets the owner withdraw a pending request and then re-apply', async () => {
      const me = await registerMobile(app);
      const created = await submit(me.token, { societyId: greenValley.id, tower: 'T3', unitNumber: '9', occupancy: 'OWNER' }).expect(201);
      const other = await registerMobile(app);
      await http().post(`/api/v1/membership-requests/${created.body.request.id}/cancel`).set(auth(other.token)).expect(404);
      const cancelled = await http().post(`/api/v1/membership-requests/${created.body.request.id}/cancel`).set(auth(me.token)).expect(200);
      expect(cancelled.body.request.status).toBe('CANCELLED');
      await http().post(`/api/v1/membership-requests/${created.body.request.id}/cancel`).set(auth(me.token)).expect(409);
      await submit(me.token, { societyId: lakeview.id, tower: 'B', unitNumber: '9', occupancy: 'TENANT' }).expect(201);
    });
  });

  describe('admin review and cross-society isolation', () => {
    it('society admin approves a request; resident then sees APPROVED and gains member access', async () => {
      const admin = await createAdmin(prisma, app, greenValley.id);
      const resident = await registerMobile(app, { fullName: 'Approved Resident' });
      const created = await http()
        .post('/api/v1/membership-requests')
        .set(auth(resident.token))
        .send({ societyId: greenValley.id, tower: 'T1', unitNumber: '1001', occupancy: 'OWNER' })
        .expect(201);

      const list = await http()
        .get(`/api/v1/societies/${greenValley.id}/membership-requests?status=PENDING`)
        .set(auth(admin.token))
        .expect(200);
      expect(list.body.items.map((r: { id: string }) => r.id)).toContain(created.body.request.id);
      expect(list.body.items.every((r: { society: { id: string } }) => r.society.id === greenValley.id)).toBe(true);

      const approved = await http()
        .post(`/api/v1/membership-requests/${created.body.request.id}/approve`)
        .set(auth(admin.token))
        .send({ note: 'Verified with registry' })
        .expect(200);
      expect(approved.body.request).toMatchObject({ status: 'APPROVED', reviewNote: 'Verified with registry' });

      const mine = await http().get('/api/v1/membership-requests/me').set(auth(resident.token)).expect(200);
      expect(mine.body.current.status).toBe('APPROVED');

      const overview = await http().get(`/api/v1/societies/${greenValley.id}/overview`).set(auth(resident.token)).expect(200);
      expect(overview.body.approvedMembers).toBeGreaterThanOrEqual(1);
      expect(overview.body.pendingRequests).toBeUndefined();

      // Approved member of Green Valley has no access to Lakeview.
      await http().get(`/api/v1/societies/${lakeview.id}/overview`).set(auth(resident.token)).expect(403);

      // Reviewing twice is rejected.
      await http().post(`/api/v1/membership-requests/${created.body.request.id}/reject`).set(auth(admin.token)).send({}).expect(409);
    });

    it('admin of one society cannot list or review requests of another society', async () => {
      const lakeviewAdmin = await createAdmin(prisma, app, lakeview.id);
      const resident = await registerMobile(app);
      const created = await http()
        .post('/api/v1/membership-requests')
        .set(auth(resident.token))
        .send({ societyId: greenValley.id, tower: 'T2', unitNumber: '77', occupancy: 'TENANT' })
        .expect(201);

      const list = await http().get(`/api/v1/societies/${greenValley.id}/membership-requests`).set(auth(lakeviewAdmin.token)).expect(403);
      expect(list.body.error.code).toBe('FORBIDDEN');
      await http().post(`/api/v1/membership-requests/${created.body.request.id}/approve`).set(auth(lakeviewAdmin.token)).send({}).expect(403);
      await http().post(`/api/v1/membership-requests/${created.body.request.id}/reject`).set(auth(lakeviewAdmin.token)).send({}).expect(403);

      const stored = await prisma.membershipRequest.findUniqueOrThrow({ where: { id: created.body.request.id } });
      expect(stored.status).toBe('PENDING');

      const mySocieties = await http().get('/api/v1/admin/societies').set(auth(lakeviewAdmin.token)).expect(200);
      expect(mySocieties.body.items.map((s: Society) => s.id)).toEqual([lakeview.id]);
    });

    it('a resident cannot approve requests or list society requests', async () => {
      const resident = await registerMobile(app);
      const applicant = await registerMobile(app);
      const created = await http()
        .post('/api/v1/membership-requests')
        .set(auth(applicant.token))
        .send({ societyId: lakeview.id, tower: 'A', unitNumber: '12', occupancy: 'OWNER' })
        .expect(201);
      await http().get(`/api/v1/societies/${lakeview.id}/membership-requests`).set(auth(resident.token)).expect(403);
      await http().post(`/api/v1/membership-requests/${created.body.request.id}/approve`).set(auth(resident.token)).send({}).expect(403);
      // The applicant cannot approve their own request either.
      await http().post(`/api/v1/membership-requests/${created.body.request.id}/approve`).set(auth(applicant.token)).send({}).expect(403);
      const admins = await http().get('/api/v1/admin/societies').set(auth(resident.token)).expect(200);
      expect(admins.body.items).toEqual([]);
    });

    it('a resident never sees another resident\'s requests via /me', async () => {
      const a = await registerMobile(app);
      const b = await registerMobile(app);
      await http()
        .post('/api/v1/membership-requests')
        .set(auth(a.token))
        .send({ societyId: lakeview.id, tower: 'B', unitNumber: '404', occupancy: 'OWNER' })
        .expect(201);
      const res = await http().get('/api/v1/membership-requests/me').set(auth(b.token)).expect(200);
      expect(res.body).toEqual({ current: null, history: [] });
    });

    it('rejects malformed ids on review endpoints and status filters', async () => {
      const admin = await createAdmin(prisma, app, lakeview.id);
      await http().post('/api/v1/membership-requests/123/approve').set(auth(admin.token)).send({}).expect(400);
      await http().post('/api/v1/membership-requests/00000000-0000-4000-8000-000000000000/approve').set(auth(admin.token)).send({}).expect(404);
      await http().get(`/api/v1/societies/${lakeview.id}/membership-requests?status=BOGUS`).set(auth(admin.token)).expect(400);
      const reject = await http()
        .post('/api/v1/membership-requests/00000000-0000-4000-8000-000000000000/reject')
        .set(auth(admin.token))
        .send({ note: 'x'.repeat(300) })
        .expect(400);
      expect(reject.body.error.details.note).toBeDefined();
    });
  });

  describe('society roles (resident, admin, guard)', () => {
    it('exposes staff roles with society names on /auth/me', async () => {
      const guard = await createGuard(prisma, app, greenValley.id);
      const me = await http().get('/api/v1/auth/me').set(auth(guard.token)).expect(200);
      expect(me.body.user).toMatchObject({ adminSocietyIds: [], guardSocietyIds: [greenValley.id] });
      expect(me.body.user.societyRoles).toEqual([
        expect.objectContaining({ societyId: greenValley.id, societyName: 'Green Valley Residency', role: 'GUARD' }),
      ]);
      const resident = await registerMobile(app);
      const plain = await http().get('/api/v1/auth/me').set(auth(resident.token)).expect(200);
      expect(plain.body.user).toMatchObject({ adminSocietyIds: [], guardSocietyIds: [], societyRoles: [] });
    });

    it('a guard cannot use admin endpoints or approve requests', async () => {
      const guard = await createGuard(prisma, app, lakeview.id);
      const applicant = await registerMobile(app);
      const created = await http()
        .post('/api/v1/membership-requests')
        .set(auth(applicant.token))
        .send({ societyId: lakeview.id, tower: 'A', unitNumber: 'G-1', occupancy: 'OWNER' })
        .expect(201);
      await http().get(`/api/v1/societies/${lakeview.id}/membership-requests`).set(auth(guard.token)).expect(403);
      await http().post(`/api/v1/membership-requests/${created.body.request.id}/approve`).set(auth(guard.token)).send({}).expect(403);
      const admin = await http().get('/api/v1/admin/societies').set(auth(guard.token)).expect(200);
      expect(admin.body.items).toEqual([]);
      await http().get(`/api/v1/societies/${lakeview.id}/overview`).set(auth(guard.token)).expect(403);
    });

    it('overview includes total units for admins only', async () => {
      const admin = await createAdmin(prisma, app, greenValley.id);
      const res = await http().get(`/api/v1/societies/${greenValley.id}/overview`).set(auth(admin.token)).expect(200);
      const units = await prisma.unit.count({ where: { societyId: greenValley.id } });
      expect(res.body).toMatchObject({ totalUnits: units, pendingRequests: expect.any(Number), approvedMembers: expect.any(Number) });
    });
  });
});
