import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, Society, Unit } from '@prisma/client';
import type request from 'supertest';
import { hashPasswordScrypt } from '../src/auth/password';
import { hashToken } from '../src/auth/session.service';
import { DevOutboxSender, MESSAGE_SENDER } from '../src/messaging/message-sender';
import { createAdmin, createGuard, createSociety, PASSWORD, registerMobile, resetData, setupApp } from './helpers';

/**
 * Sprint 2 acceptance: authentication lifecycle, invitations, roles and
 * tenant isolation (IDOR/BOLA), against the real PostgreSQL test database.
 * Numbered `[n]` tests map to the mandatory scenarios in the sprint brief.
 */
describe('Sprint 2 — secure society accounts', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let http: () => ReturnType<typeof request>;
  let outbox: DevOutboxSender;

  let A: Society;
  let B: Society;
  let unitA: Unit;
  let unitA2: Unit;
  let unitB: Unit;
  type Actor = Awaited<ReturnType<typeof registerMobile>>;
  let adminA: Actor;
  let adminB: Actor;
  let guardA: Actor;
  let residentA: Actor;
  let residentB: Actor;
  let memberResA: string;
  let memberResB: string;
  let assignmentB: string;
  let invitationB: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const tokenOf = (inviteUrl: string) => new URL(inviteUrl).searchParams.get('token')!;

  async function invite(adminToken: string, societyId: string, body: Record<string, unknown>) {
    const res = await http().post(`/api/v1/societies/${societyId}/invitations`).set(auth(adminToken)).send(body).expect(201);
    return { token: tokenOf(res.body.inviteUrl), invitation: res.body.invitation, res };
  }

  /** Registers a user and has them accept a resident invitation for `unit`. */
  async function invitedResident(adminToken: string, society: Society, unit: Unit, name: string) {
    const user = await registerMobile(app, { fullName: name });
    const { token } = await invite(adminToken, society.id, { phone: user.phone, role: 'RESIDENT', unitId: unit.id, occupancy: 'OWNER' });
    await http().post('/api/v1/invitations/accept').set(auth(user.token)).send({ token }).expect(200);
    const membership = await prisma.membership.findFirstOrThrow({ where: { userId: user.user.id, societyId: society.id, role: 'RESIDENT' } });
    return { user, membershipId: membership.id };
  }

  beforeAll(async () => {
    ({ app, prisma, http } = await setupApp());
    outbox = app.get(MESSAGE_SENDER);
    await resetData(prisma);
    A = await createSociety(prisma, 'Green Valley Residency', ['T1', 'T2']);
    B = await createSociety(prisma, 'Lakeview Heights', ['A', 'B']);
    adminA = await createAdmin(prisma, app, A.id);
    adminB = await createAdmin(prisma, app, B.id);
    guardA = await createGuard(prisma, app, A.id);

    unitA = (await http().post(`/api/v1/societies/${A.id}/units`).set(auth(adminA.token)).send({ tower: 'T1', number: '101' }).expect(201)).body.unit;
    unitA2 = (await http().post(`/api/v1/societies/${A.id}/units`).set(auth(adminA.token)).send({ tower: 'T2', number: '202' }).expect(201)).body.unit;
    unitB = (await http().post(`/api/v1/societies/${B.id}/units`).set(auth(adminB.token)).send({ tower: 'A', number: '1' }).expect(201)).body.unit;

    const ra = await invitedResident(adminA.token, A, unitA, 'Asha Resident');
    residentA = ra.user;
    memberResA = ra.membershipId;
    const rb = await invitedResident(adminB.token, B, unitB, 'Bharat Lakeview');
    residentB = rb.user;
    memberResB = rb.membershipId;
    assignmentB = (await prisma.unitAssignment.findFirstOrThrow({ where: { membershipId: memberResB, endedAt: null } })).id;
    invitationB = (await invite(adminB.token, B.id, { phone: '9876500001', role: 'GUARD' })).invitation.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('[1] unauthenticated access', () => {
    it.each([
      ['GET', () => `/api/v1/societies/${A.id}/overview`],
      ['GET', () => `/api/v1/societies/${A.id}/members`],
      ['GET', () => `/api/v1/societies/${A.id}/members/export`],
      ['GET', () => `/api/v1/societies/${A.id}/units`],
      ['GET', () => `/api/v1/societies/${A.id}/my-units`],
      ['GET', () => `/api/v1/societies/${A.id}/invitations`],
      ['GET', () => `/api/v1/societies/${A.id}/audit-events`],
      ['GET', () => '/api/v1/me/memberships'],
      ['POST', () => `/api/v1/societies/${A.id}/invitations`],
      ['POST', () => `/api/v1/societies/${A.id}/units`],
      ['POST', () => '/api/v1/invitations/accept'],
      ['POST', () => '/api/v1/societies'],
      ['PATCH', () => `/api/v1/societies/${A.id}`],
      ['PATCH', () => `/api/v1/societies/${A.id}/members/${memberResA}`],
    ])('%s %s → 401', async (method, path) => {
      const req = method === 'GET' ? http().get(path()) : method === 'POST' ? http().post(path()) : http().patch(path());
      const res = await req.send({}).expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('[2][3] residents read only their own society', () => {
    it('[2] a Society A resident reads authorised Society A data', async () => {
      const overview = await http().get(`/api/v1/societies/${A.id}/overview`).set(auth(residentA.token)).expect(200);
      expect(overview.body.society.id).toBe(A.id);
      expect(overview.body.pendingRequests).toBeUndefined();
      const mine = await http().get(`/api/v1/societies/${A.id}/my-units`).set(auth(residentA.token)).expect(200);
      expect(mine.body.items.map((u: Unit) => u.id)).toEqual([unitA.id]);
    });

    it('[3] the same resident cannot read Society B data by changing the society id', async () => {
      for (const path of ['overview', 'my-units', 'members', 'units', `units/${unitB.id}`, 'invitations', 'audit-events', 'members/export']) {
        const res = await http().get(`/api/v1/societies/${B.id}/${path}`).set(auth(residentA.token)).expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(JSON.stringify(res.body)).not.toContain('Bharat');
      }
    });

    it('a resident has no administrative access to their own society', async () => {
      for (const path of ['members', 'units', 'invitations', 'audit-events', 'members/export']) {
        await http().get(`/api/v1/societies/${A.id}/${path}`).set(auth(residentA.token)).expect(403);
      }
    });
  });

  describe('[4] write attempts against Society B resources', () => {
    it('a Society A resident cannot update or delete Society B resources', async () => {
      await http().patch(`/api/v1/societies/${B.id}/members/${memberResB}`).set(auth(residentA.token)).send({ status: 'REVOKED' }).expect(403);
      await http().delete(`/api/v1/societies/${B.id}/units/${unitB.id}/assignments/${assignmentB}`).set(auth(residentA.token)).expect(403);
      await http().post(`/api/v1/societies/${B.id}/invitations/${invitationB}/revoke`).set(auth(residentA.token)).expect(403);
      await http().patch(`/api/v1/societies/${B.id}`).set(auth(residentA.token)).send({ name: 'Hijacked' }).expect(403);
    });

    it('a Society A admin substituting Society B ids under the Society A URL gets 404 and changes nothing', async () => {
      await http().patch(`/api/v1/societies/${A.id}/members/${memberResB}`).set(auth(adminA.token)).send({ status: 'REVOKED' }).expect(404);
      await http().delete(`/api/v1/societies/${A.id}/units/${unitB.id}/assignments/${assignmentB}`).set(auth(adminA.token)).expect(404);
      await http().post(`/api/v1/societies/${A.id}/invitations/${invitationB}/revoke`).set(auth(adminA.token)).expect(404);

      expect((await prisma.membership.findUniqueOrThrow({ where: { id: memberResB } })).status).toBe('ACTIVE');
      expect((await prisma.unitAssignment.findUniqueOrThrow({ where: { id: assignmentB } })).endedAt).toBeNull();
      expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitationB } })).status).toBe('PENDING');
      expect((await prisma.society.findUniqueOrThrow({ where: { id: B.id } })).name).toBe('Lakeview Heights');
    });
  });

  describe('[5][15] list, search, filter, pagination and export stay inside the tenant', () => {
    it('lists contain only Society A records', async () => {
      const members = await http().get(`/api/v1/societies/${A.id}/members?pageSize=100`).set(auth(adminA.token)).expect(200);
      const ids = members.body.items.map((m: { id: string }) => m.id);
      expect(ids).toContain(memberResA);
      expect(ids).not.toContain(memberResB);
      expect(members.body.total).toBe(await prisma.membership.count({ where: { societyId: A.id } }));

      const units = await http().get(`/api/v1/societies/${A.id}/units?pageSize=100`).set(auth(adminA.token)).expect(200);
      expect(units.body.items.every((u: Unit) => u.societyId === A.id)).toBe(true);
      expect(units.body.items.map((u: Unit) => u.id)).not.toContain(unitB.id);

      const invitations = await http().get(`/api/v1/societies/${A.id}/invitations`).set(auth(adminA.token)).expect(200);
      expect(invitations.body.items.every((i: { societyId: string }) => i.societyId === A.id)).toBe(true);
      expect(invitations.body.items.map((i: { id: string }) => i.id)).not.toContain(invitationB);

      const audit = await http().get(`/api/v1/societies/${A.id}/audit-events?pageSize=100`).set(auth(adminA.token)).expect(200);
      expect(audit.body.items.length).toBeGreaterThan(0);
      expect(audit.body.items.every((e: { societyId: string }) => e.societyId === A.id)).toBe(true);
    });

    it('search and filters cannot reach Society B', async () => {
      const byName = await http().get(`/api/v1/societies/${A.id}/members?q=Bharat`).set(auth(adminA.token)).expect(200);
      expect(byName.body).toMatchObject({ items: [], total: 0 });
      const byPhone = await http().get(`/api/v1/societies/${A.id}/members?q=${residentB.phone}`).set(auth(adminA.token)).expect(200);
      expect(byPhone.body.total).toBe(0);
      // Tower "A" exists only in Society B.
      const towerB = await http().get(`/api/v1/societies/${A.id}/units?tower=A`).set(auth(adminA.token)).expect(200);
      expect(towerB.body.total).toBe(0);
      const residents = await http().get(`/api/v1/societies/${A.id}/members?role=RESIDENT&status=ACTIVE`).set(auth(adminA.token)).expect(200);
      expect(residents.body.items.map((m: { id: string }) => m.id)).toEqual([memberResA]);
    });

    it('pagination totals and pages are tenant-scoped', async () => {
      for (const n of ['301', '302', '303']) {
        await http().post(`/api/v1/societies/${B.id}/units`).set(auth(adminB.token)).send({ tower: 'B', number: n }).expect(201);
      }
      const p1 = await http().get(`/api/v1/societies/${A.id}/units?pageSize=1&page=1`).set(auth(adminA.token)).expect(200);
      const p2 = await http().get(`/api/v1/societies/${A.id}/units?pageSize=1&page=2`).set(auth(adminA.token)).expect(200);
      const p3 = await http().get(`/api/v1/societies/${A.id}/units?pageSize=1&page=3`).set(auth(adminA.token)).expect(200);
      expect(p1.body.total).toBe(2);
      expect([p1.body.items[0].id, p2.body.items[0].id].sort()).toEqual([unitA.id, unitA2.id].sort());
      expect(p3.body.items).toEqual([]);
      await http().get(`/api/v1/societies/${A.id}/units?pageSize=500`).set(auth(adminA.token)).expect(400);
      await http().get(`/api/v1/societies/${A.id}/units?societyId=${B.id}`).set(auth(adminA.token)).expect(400);
    });

    it('CSV export contains only Society A members and is audited', async () => {
      const res = await http().get(`/api/v1/societies/${A.id}/members/export`).set(auth(adminA.token)).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text).toContain('Asha Resident');
      expect(res.text).not.toContain('Bharat');
      expect(res.text).not.toContain(residentB.phone.slice(-6));
      const event = await prisma.auditEvent.findFirst({ where: { action: 'data.exported', societyId: A.id, actorUserId: adminA.user.id } });
      expect(event).not.toBeNull();
      await http().get(`/api/v1/societies/${B.id}/members/export`).set(auth(adminA.token)).expect(403);
    });

    it('export neutralises spreadsheet formulas', async () => {
      const evil = await registerMobile(app, { fullName: 'Asha Resident' });
      await prisma.user.update({ where: { id: evil.user.id }, data: { fullName: '=HYPERLINK("x")' } });
      const { token } = await invite(adminA.token, A.id, { phone: evil.phone, role: 'GUARD' });
      await http().post('/api/v1/invitations/accept').set(auth(evil.token)).send({ token }).expect(200);
      const res = await http().get(`/api/v1/societies/${A.id}/members/export`).set(auth(adminA.token)).expect(200);
      expect(res.text).toContain(`"'=HYPERLINK(""x"")"`);
    });
  });

  describe('[6] nested resources reject Society B ids under a Society A URL', () => {
    it('unit, assignment and invitation references are tenant-checked', async () => {
      await http().get(`/api/v1/societies/${A.id}/units/${unitB.id}`).set(auth(adminA.token)).expect(404);
      await http()
        .post(`/api/v1/societies/${A.id}/units/${unitB.id}/assignments`)
        .set(auth(adminA.token))
        .send({ membershipId: memberResA, occupancy: 'OWNER' })
        .expect(404);
      const inv = await http()
        .post(`/api/v1/societies/${A.id}/invitations`)
        .set(auth(adminA.token))
        .send({ phone: '9876500002', role: 'RESIDENT', unitId: unitB.id, occupancy: 'TENANT' })
        .expect(404);
      expect(inv.body.error.message).toBe('Unit not found.');
      expect(await prisma.invitation.count({ where: { phone: '+919876500002' } })).toBe(0);
    });
  });

  describe('[7] guards cannot use administrator operations', () => {
    it('every admin-only endpoint answers 403 to a guard of the same society', async () => {
      const g = auth(guardA.token);
      await http().get(`/api/v1/societies/${A.id}/members`).set(g).expect(403);
      await http().patch(`/api/v1/societies/${A.id}/members/${memberResA}`).set(g).send({ status: 'SUSPENDED' }).expect(403);
      await http().get(`/api/v1/societies/${A.id}/members/export`).set(g).expect(403);
      await http().post(`/api/v1/societies/${A.id}/invitations`).set(g).send({ phone: '9876500003', role: 'ADMIN' }).expect(403);
      await http().get(`/api/v1/societies/${A.id}/invitations`).set(g).expect(403);
      await http().post(`/api/v1/societies/${A.id}/units`).set(g).send({ tower: 'T1', number: '999' }).expect(403);
      await http().post(`/api/v1/societies/${A.id}/units/${unitA.id}/assignments`).set(g).send({ membershipId: memberResA, occupancy: 'OWNER' }).expect(403);
      await http().get(`/api/v1/societies/${A.id}/audit-events`).set(g).expect(403);
      await http().patch(`/api/v1/societies/${A.id}`).set(g).send({ name: 'Guarded' }).expect(403);
      await http().get(`/api/v1/societies/${A.id}/membership-requests`).set(g).expect(403);
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: memberResA } })).status).toBe('ACTIVE');
    });
  });

  describe('[8] a society administrator cannot administer another society', () => {
    it('Society A admin is denied on every Society B admin endpoint', async () => {
      const a = auth(adminA.token);
      await http().get(`/api/v1/societies/${B.id}/members`).set(a).expect(403);
      await http().patch(`/api/v1/societies/${B.id}/members/${memberResB}`).set(a).send({ status: 'SUSPENDED' }).expect(403);
      await http().post(`/api/v1/societies/${B.id}/invitations`).set(a).send({ phone: adminA.phone, role: 'ADMIN' }).expect(403);
      await http().post(`/api/v1/societies/${B.id}/units`).set(a).send({ tower: 'A', number: '2' }).expect(403);
      await http().post(`/api/v1/societies/${B.id}/units/${unitB.id}/assignments`).set(a).send({ membershipId: memberResB, occupancy: 'OWNER' }).expect(403);
      await http().get(`/api/v1/societies/${B.id}/audit-events`).set(a).expect(403);
      await http().patch(`/api/v1/societies/${B.id}`).set(a).send({ name: 'Taken over' }).expect(403);
      expect(await prisma.membership.count({ where: { societyId: B.id, userId: adminA.user.id } })).toBe(0);
    });
  });

  describe('[9] revoked and suspended memberships lose access immediately', () => {
    it('suspension and revocation apply on the next request; reactivation restores access', async () => {
      const r = await invitedResident(adminA.token, A, unitA2, 'Revoked Resident');
      const t = auth(r.user.token);
      await http().get(`/api/v1/societies/${A.id}/overview`).set(t).expect(200);
      await http().post('/api/v1/me/active-society').set(t).send({ societyId: A.id }).expect(200);

      await http().patch(`/api/v1/societies/${A.id}/members/${r.membershipId}`).set(auth(adminA.token)).send({ status: 'SUSPENDED', reason: 'Dues' }).expect(200);
      await http().get(`/api/v1/societies/${A.id}/overview`).set(t).expect(403);
      await http().patch(`/api/v1/societies/${A.id}/members/${r.membershipId}`).set(auth(adminA.token)).send({ status: 'ACTIVE' }).expect(200);
      await http().get(`/api/v1/societies/${A.id}/overview`).set(t).expect(200);

      const revoked = await http().patch(`/api/v1/societies/${A.id}/members/${r.membershipId}`).set(auth(adminA.token)).send({ status: 'REVOKED' }).expect(200);
      expect(revoked.body.member).toMatchObject({ status: 'REVOKED', units: [] });
      await http().get(`/api/v1/societies/${A.id}/overview`).set(t).expect(403);
      await http().get(`/api/v1/societies/${A.id}/my-units`).set(t).expect(403);
      // Session policy: the login stays valid (other societies may still apply), the society does not.
      const me = await http().get('/api/v1/auth/me').set(t).expect(200);
      expect(me.body.activeSocietyId).toBeNull();
      expect(me.body.user.memberships).toEqual([expect.objectContaining({ societyId: A.id, role: 'RESIDENT', status: 'REVOKED' })]);
      // Revoked is terminal.
      await http().patch(`/api/v1/societies/${A.id}/members/${r.membershipId}`).set(auth(adminA.token)).send({ status: 'ACTIVE' }).expect(409);
    });

    it('administrators cannot change their own membership or remove the last active admin', async () => {
      const own = await prisma.membership.findFirstOrThrow({ where: { userId: adminA.user.id, societyId: A.id, role: 'ADMIN' } });
      await http().patch(`/api/v1/societies/${A.id}/members/${own.id}`).set(auth(adminA.token)).send({ status: 'REVOKED' }).expect(403);
      const co = await registerMobile(app, { fullName: 'Co Admin' });
      const { token } = await invite(adminA.token, A.id, { phone: co.phone, role: 'ADMIN' });
      await http().post('/api/v1/invitations/accept').set(auth(co.token)).send({ token }).expect(200);
      await http().patch(`/api/v1/societies/${A.id}/members/${own.id}`).set(auth(co.token)).send({ status: 'SUSPENDED' }).expect(200);
      const coMembership = await prisma.membership.findFirstOrThrow({ where: { userId: co.user.id, societyId: A.id } });
      // adminA is suspended now: no admin rights left.
      await http().patch(`/api/v1/societies/${A.id}/members/${coMembership.id}`).set(auth(adminA.token)).send({ status: 'REVOKED' }).expect(403);
      await http().patch(`/api/v1/societies/${A.id}/members/${own.id}`).set(auth(co.token)).send({ status: 'ACTIVE' }).expect(200);
    });
  });

  describe('[10] invalid, expired and revoked tokens', () => {
    it('rejects garbage, unknown, expired and logged-out tokens', async () => {
      await http().get('/api/v1/auth/me').set(auth('not-a-token')).expect(401);
      await http().get('/api/v1/auth/me').set(auth('x'.repeat(500))).expect(401);
      await http().get('/api/v1/auth/me').set('Cookie', 'krevia_session=forged').expect(401);

      const u = await registerMobile(app);
      await prisma.session.updateMany({ where: { tokenHash: hashToken(u.token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().get('/api/v1/auth/me').set(auth(u.token)).expect(401);

      const v = await registerMobile(app);
      await http().post('/api/v1/auth/logout').set(auth(v.token)).expect(204);
      await http().get(`/api/v1/societies/${A.id}/overview`).set(auth(v.token)).expect(401);
    });

    it('logout-all revokes every session of the user', async () => {
      const u = await registerMobile(app);
      const second = await http().post('/api/v1/auth/login').set('X-Krevia-Client', 'mobile').send({ phone: u.phone, password: PASSWORD }).expect(200);
      await http().post('/api/v1/auth/logout-all').set(auth(u.token)).expect(204);
      await http().get('/api/v1/auth/me').set(auth(u.token)).expect(401);
      await http().get('/api/v1/auth/me').set(auth(second.body.token)).expect(401);
      expect(await prisma.auditEvent.count({ where: { action: 'auth.logout_all', actorUserId: u.user.id } })).toBe(1);
    });
  });

  describe('[11] invitations are single-use, revocable and expire', () => {
    it('cannot be reused after acceptance', async () => {
      const u = await registerMobile(app);
      const { token } = await invite(adminA.token, A.id, { phone: u.phone, role: 'GUARD' });
      const accepted = await http().post('/api/v1/invitations/accept').set(auth(u.token)).send({ token }).expect(200);
      expect(accepted.body.user.guardSocietyIds).toEqual([A.id]);
      await http().post('/api/v1/invitations/accept').set(auth(u.token)).send({ token }).expect(409);
      await http().post('/api/v1/invitations/preview').send({ token }).expect(404);
    });

    it('concurrent acceptance creates exactly one membership', async () => {
      const u = await registerMobile(app);
      const { token } = await invite(adminA.token, A.id, { phone: u.phone, role: 'RESIDENT', unitId: unitA2.id, occupancy: 'TENANT' });
      const results = await Promise.all([1, 2, 3].map(() => http().post('/api/v1/invitations/accept').set(auth(u.token)).send({ token })));
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(await prisma.membership.count({ where: { userId: u.user.id } })).toBe(1);
      expect(await prisma.unitAssignment.count({ where: { membership: { userId: u.user.id } } })).toBe(1);
    });

    it('cannot be used after revocation', async () => {
      const u = await registerMobile(app);
      const { token, invitation } = await invite(adminA.token, A.id, { phone: u.phone, role: 'GUARD' });
      await http().post(`/api/v1/societies/${A.id}/invitations/${invitation.id}/revoke`).set(auth(adminA.token)).expect(200);
      await http().post('/api/v1/invitations/accept').set(auth(u.token)).send({ token }).expect(409);
      expect(await prisma.membership.count({ where: { userId: u.user.id } })).toBe(0);
    });

    it('cannot be used after expiry', async () => {
      const u = await registerMobile(app);
      const { token, invitation } = await invite(adminA.token, A.id, { phone: u.phone, role: 'GUARD' });
      await prisma.invitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().post('/api/v1/invitations/preview').send({ token }).expect(404);
      await http().post('/api/v1/invitations/accept').set(auth(u.token)).send({ token }).expect(409);
      expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe('EXPIRED');
      expect(await prisma.auditEvent.count({ where: { action: 'invitation.expired', targetId: invitation.id } })).toBe(1);
    });

    it('only the invited phone number can accept; unknown and malformed tokens are rejected', async () => {
      const invited = await registerMobile(app);
      const other = await registerMobile(app);
      const { token } = await invite(adminA.token, A.id, { phone: invited.phone, role: 'GUARD' });
      const wrong = await http().post('/api/v1/invitations/accept').set(auth(other.token)).send({ token }).expect(404);
      const unknown = await http().post('/api/v1/invitations/accept').set(auth(other.token)).send({ token: 'A'.repeat(43) }).expect(404);
      expect(wrong.body.error.message).toBe(unknown.body.error.message);
      await http().post('/api/v1/invitations/accept').set(auth(other.token)).send({ token: 'short' }).expect(400);
      // Still usable by the right person.
      await http().post('/api/v1/invitations/accept').set(auth(invited.token)).send({ token }).expect(200);
    });

    it('stores only a hash of the token; preview masks the phone number', async () => {
      const { token, invitation } = await invite(adminA.token, A.id, { phone: '9876500010', role: 'GUARD' });
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(row.tokenHash).toBe(hashToken(token));
      expect(JSON.stringify(row)).not.toContain(token);
      const preview = await http().post('/api/v1/invitations/preview').send({ token }).expect(200);
      expect(preview.body.invitation).toMatchObject({ role: 'GUARD', phone: '+91******0010', society: { id: A.id } });
      const listed = await http().get(`/api/v1/societies/${A.id}/invitations?status=PENDING`).set(auth(adminA.token)).expect(200);
      expect(JSON.stringify(listed.body)).not.toContain('9876500010');
      // The development outbox received the link (no real SMS provider).
      expect(outbox.messagesFor('+919876500010')[0]!.body).toContain(token);
      // Duplicate pending invitation for the same number and role.
      await http().post(`/api/v1/societies/${A.id}/invitations`).set(auth(adminA.token)).send({ phone: '9876500010', role: 'GUARD' }).expect(409);
    });
  });

  describe('[12] no self-assigned privileges through payloads', () => {
    it('extra role/status fields are rejected or ignored, never applied', async () => {
      const u = await registerMobile(app);
      const { token } = await invite(adminA.token, A.id, { phone: u.phone, role: 'RESIDENT', unitId: unitA.id, occupancy: 'TENANT' });
      await http().post('/api/v1/invitations/accept').set(auth(u.token)).send({ token, role: 'ADMIN' }).expect(400);
      const ok = await http().post('/api/v1/invitations/accept').set(auth(u.token)).send({ token }).expect(200);
      expect(ok.body.user).toMatchObject({ adminSocietyIds: [], guardSocietyIds: [] });

      const membership = await prisma.membership.findFirstOrThrow({ where: { userId: u.user.id } });
      await http().patch(`/api/v1/societies/${A.id}/members/${membership.id}`).set(auth(adminA.token)).send({ status: 'ACTIVE', role: 'ADMIN' }).expect(400);
      // A resident cannot invite themselves (or anyone) as admin.
      await http().post(`/api/v1/societies/${A.id}/invitations`).set(auth(u.token)).send({ phone: u.phone, role: 'ADMIN' }).expect(403);

      const reg = await http()
        .post('/api/v1/auth/register')
        .set('X-Krevia-Client', 'mobile')
        .send({ fullName: 'Sneaky', phone: '9876500020', password: PASSWORD, platformRole: 'PLATFORM_ADMIN', adminSocietyIds: [A.id] })
        .expect(201);
      expect(reg.body.user).toMatchObject({ platformRole: 'RESIDENT', adminSocietyIds: [] });
      await http()
        .post('/api/v1/membership-requests')
        .set(auth(reg.body.token))
        .send({ societyId: A.id, tower: 'T1', unitNumber: '777', occupancy: 'OWNER', status: 'APPROVED', role: 'ADMIN' })
        .expect(201);
      const me = await http().get('/api/v1/auth/me').set(auth(reg.body.token)).expect(200);
      expect(me.body.user).toMatchObject({ adminSocietyIds: [], memberships: [] });
      // Client-supplied identity headers are ignored.
      await http().get(`/api/v1/societies/${A.id}/members`).set(auth(reg.body.token)).set('X-User-Id', adminA.user.id).expect(403);
    });
  });

  describe('[13] unit assignment is confined to the society', () => {
    it('rejects a membership of another society and is enforced by the database', async () => {
      await http()
        .post(`/api/v1/societies/${A.id}/units/${unitA.id}/assignments`)
        .set(auth(adminA.token))
        .send({ membershipId: memberResB, occupancy: 'OWNER' })
        .expect(404);
      expect(await prisma.unitAssignment.count({ where: { membershipId: memberResB, unitId: unitA.id } })).toBe(0);
      // Even a direct insert that mixes societies violates the composite foreign keys.
      await expect(
        prisma.unitAssignment.create({ data: { societyId: A.id, unitId: unitB.id, membershipId: memberResA, occupancy: 'OWNER' } }),
      ).rejects.toThrow();
      await expect(
        prisma.unitAssignment.create({ data: { societyId: A.id, unitId: unitA.id, membershipId: memberResB, occupancy: 'OWNER' } }),
      ).rejects.toThrow();
    });

    it('assigns and ends assignments for residents of the same society only', async () => {
      const added = await http()
        .post(`/api/v1/societies/${A.id}/units/${unitA2.id}/assignments`)
        .set(auth(adminA.token))
        .send({ membershipId: memberResA, occupancy: 'TENANT' })
        .expect(201);
      const guardMembership = await prisma.membership.findFirstOrThrow({ where: { userId: guardA.user.id, societyId: A.id } });
      await http()
        .post(`/api/v1/societies/${A.id}/units/${unitA2.id}/assignments`)
        .set(auth(adminA.token))
        .send({ membershipId: guardMembership.id, occupancy: 'TENANT' })
        .expect(409);
      await http().delete(`/api/v1/societies/${A.id}/units/${unitA2.id}/assignments/${added.body.assignment.id}`).set(auth(adminA.token)).expect(204);
      await http().delete(`/api/v1/societies/${A.id}/units/${unitA2.id}/assignments/${added.body.assignment.id}`).set(auth(adminA.token)).expect(404);
      const events = await prisma.auditEvent.findMany({ where: { societyId: A.id, action: { in: ['unit.assigned', 'unit.unassigned'] }, targetId: unitA2.id } });
      expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(['unit.assigned', 'unit.unassigned']));
    });
  });

  describe('[14] denied operations are audited', () => {
    it('records denied cross-tenant attempts with actor, society, permission and request id', async () => {
      const res = await http().get(`/api/v1/societies/${B.id}/members`).set(auth(guardA.token)).set('X-Request-Id', 'audit-trace-0001').expect(403);
      expect(res.headers['x-request-id']).toBe('audit-trace-0001');
      const event = await prisma.auditEvent.findFirst({ where: { requestId: 'audit-trace-0001' } });
      expect(event).toMatchObject({
        action: 'authz.denied',
        outcome: 'DENIED',
        actorUserId: guardA.user.id,
        societyId: B.id,
        metadata: expect.objectContaining({ permission: 'membership.read', route: '/api/v1/societies/:societyId/members' }),
      });
    });

    it('records failed logins and failed invitation acceptance without secrets', async () => {
      await http().post('/api/v1/auth/login').send({ phone: residentA.phone, password: 'WrongPass99' }).set('X-Request-Id', 'audit-trace-0002').expect(401);
      const login = await prisma.auditEvent.findFirstOrThrow({ where: { requestId: 'audit-trace-0002' } });
      expect(login).toMatchObject({ action: 'auth.login', outcome: 'FAILURE', targetId: residentA.user.id, metadata: { reason: 'wrong_password' } });
      expect(JSON.stringify(login)).not.toMatch(/WrongPass99|\+91/);

      await http().post('/api/v1/invitations/accept').set(auth(residentA.token)).set('X-Request-Id', 'audit-trace-0003').send({ token: 'B'.repeat(43) }).expect(404);
      expect(await prisma.auditEvent.findFirst({ where: { requestId: 'audit-trace-0003', action: 'invitation.accept_failed' } })).not.toBeNull();
    });

    it('the audit trail is append-only, even for the database client', async () => {
      const event = await prisma.auditEvent.findFirstOrThrow();
      await expect(prisma.auditEvent.update({ where: { id: event.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
      await expect(prisma.auditEvent.deleteMany({ where: { societyId: A.id } })).rejects.toThrow(/append-only/);
      await http().delete(`/api/v1/societies/${A.id}/audit-events`).set(auth(adminA.token)).expect(404);
      await http().patch(`/api/v1/societies/${A.id}/audit-events`).set(auth(adminA.token)).send({}).expect(404);
    });

    it('records membership, invitation and society administration events', async () => {
      await http().patch(`/api/v1/societies/${A.id}`).set(auth(adminA.token)).send({ addressLine: 'Baner Road' }).expect(200);
      const actions = (await prisma.auditEvent.findMany({ where: { societyId: A.id }, select: { action: true } })).map((e) => e.action);
      for (const a of ['invitation.created', 'invitation.accepted', 'invitation.revoked', 'membership.created', 'membership.status_changed', 'unit.created', 'society.updated', 'authz.denied']) {
        expect(actions).toContain(a);
      }
    });
  });

  describe('password storage', () => {
    it('stores Argon2id hashes and upgrades a Sprint 1 scrypt hash at the next login', async () => {
      const u = await registerMobile(app);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: u.user.id } });
      expect(stored.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(stored.passwordHash).not.toContain(PASSWORD);

      await prisma.user.update({ where: { id: u.user.id }, data: { passwordHash: await hashPasswordScrypt(PASSWORD) } });
      await http().post('/api/v1/auth/login').send({ phone: u.phone, password: PASSWORD }).expect(200);
      const upgraded = await prisma.user.findUniqueOrThrow({ where: { id: u.user.id } });
      expect(upgraded.passwordHash).toMatch(/^\$argon2id\$/);
      await http().post('/api/v1/auth/login').send({ phone: u.phone, password: PASSWORD }).expect(200);
    });
  });

  describe('password reset (one-time code)', () => {
    const codeFor = (phone: string) => /(\d{6}) is your/.exec(outbox.messagesFor(phone)[0]?.body ?? '')?.[1];

    it('gives the same answer for registered and unknown numbers', async () => {
      const u = await registerMobile(app);
      const known = await http().post('/api/v1/auth/password-reset/request').send({ phone: u.phone }).expect(202);
      const unknown = await http().post('/api/v1/auth/password-reset/request').send({ phone: '9876500099' }).expect(202);
      expect(known.body).toEqual(unknown.body);
      expect(outbox.messagesFor('+919876500099')).toHaveLength(0);
    });

    it('resets the password once, signs out everywhere and never stores the code', async () => {
      const u = await registerMobile(app);
      const e164 = `+91${u.phone}`;
      await http().post('/api/v1/auth/password-reset/request').send({ phone: u.phone }).expect(202);
      const code = codeFor(e164)!;
      expect(code).toMatch(/^\d{6}$/);
      const stored = await prisma.passwordResetCode.findFirstOrThrow({ where: { userId: u.user.id } });
      expect(stored.codeHash).not.toContain(code);

      await http().post('/api/v1/auth/password-reset/confirm').send({ phone: u.phone, code, password: 'short' }).expect(400);
      await http().post('/api/v1/auth/password-reset/confirm').send({ phone: u.phone, code, password: 'NewPass2026' }).expect(200);
      await http().get('/api/v1/auth/me').set(auth(u.token)).expect(401);
      await http().post('/api/v1/auth/password-reset/confirm').send({ phone: u.phone, code, password: 'Another2026' }).expect(400);
      await http().post('/api/v1/auth/login').send({ phone: u.phone, password: PASSWORD }).expect(401);
      await http().post('/api/v1/auth/login').send({ phone: u.phone, password: 'NewPass2026' }).expect(200);

      const events = await prisma.auditEvent.findMany({ where: { targetId: u.user.id, action: { startsWith: 'auth.password_reset' } } });
      expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(['auth.password_reset.requested', 'auth.password_reset.completed']));
      expect(JSON.stringify(events)).not.toContain(code);
    });

    it('limits attempts, enforces a resend cooldown and expiry', async () => {
      const u = await registerMobile(app);
      const e164 = `+91${u.phone}`;
      await http().post('/api/v1/auth/password-reset/request').send({ phone: u.phone }).expect(202);
      const code = codeFor(e164)!;
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i += 1) {
        await http().post('/api/v1/auth/password-reset/confirm').send({ phone: u.phone, code: wrong, password: 'NewPass2026' }).expect(400);
      }
      // Locked after 5 attempts, even with the right code.
      await http().post('/api/v1/auth/password-reset/confirm').send({ phone: u.phone, code, password: 'NewPass2026' }).expect(400);

      // Cooldown: an immediate second request sends nothing new.
      await http().post('/api/v1/auth/password-reset/request').send({ phone: u.phone }).expect(202);
      expect(outbox.messagesFor(e164)).toHaveLength(1);

      // After the cooldown a new code works; an expired one does not.
      await prisma.passwordResetCode.updateMany({ where: { userId: u.user.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
      await http().post('/api/v1/auth/password-reset/request').send({ phone: u.phone }).expect(202);
      const fresh = codeFor(e164)!;
      await prisma.passwordResetCode.updateMany({ where: { userId: u.user.id, consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().post('/api/v1/auth/password-reset/confirm').send({ phone: u.phone, code: fresh, password: 'NewPass2026' }).expect(400);
      expect(await prisma.auditEvent.count({ where: { targetId: u.user.id, action: 'auth.password_reset.failed' } })).toBeGreaterThanOrEqual(6);
    });
  });

  describe('platform administrators', () => {
    let platform: Actor;
    beforeAll(async () => {
      platform = await registerMobile(app, { fullName: 'Platform Operator' });
      await prisma.user.update({ where: { id: platform.user.id }, data: { platformRole: 'PLATFORM_ADMIN' } });
    });

    it('create societies and invite their first admin, but get no implicit society access', async () => {
      const created = await http()
        .post('/api/v1/societies')
        .set(auth(platform.token))
        .send({ name: 'Sunrise Enclave', addressLine: 'Sector 54', city: 'Gurugram', state: 'Haryana', pincode: '122011', towers: ['Tower 1'] })
        .expect(201);
      const societyId = created.body.society.id;

      const firstAdmin = await registerMobile(app, { fullName: 'Sunrise Admin' });
      const inv = await http().post(`/api/v1/platform/societies/${societyId}/admin-invitations`).set(auth(platform.token)).send({ phone: firstAdmin.phone }).expect(201);
      await http().post('/api/v1/invitations/accept').set(auth(firstAdmin.token)).send({ token: tokenOf(inv.body.inviteUrl) }).expect(200);
      await http().get(`/api/v1/societies/${societyId}/members`).set(auth(firstAdmin.token)).expect(200);

      for (const path of ['members', 'units', 'invitations', 'audit-events', 'overview']) {
        await http().get(`/api/v1/societies/${societyId}/${path}`).set(auth(platform.token)).expect(403);
        await http().get(`/api/v1/societies/${A.id}/${path}`).set(auth(platform.token)).expect(403);
      }
      const admin = await http().get('/api/v1/admin/societies').set(auth(platform.token)).expect(200);
      expect(admin.body.items).toEqual([]);
      const platformList = await http().get('/api/v1/platform/societies').set(auth(platform.token)).expect(200);
      expect(platformList.body.items.length).toBeGreaterThanOrEqual(3);
      expect(await prisma.auditEvent.count({ where: { action: { in: ['society.created', 'platform.admin_invited'] }, actorUserId: platform.user.id } })).toBe(2);
    });

    it('validates society input and forbids non-platform users', async () => {
      const bad = await http().post('/api/v1/societies').set(auth(platform.token)).send({ name: 'X', pincode: '012345', towers: [] }).expect(400);
      expect(Object.keys(bad.body.error.details)).toEqual(expect.arrayContaining(['name', 'addressLine', 'city', 'state', 'pincode', 'towers']));
      const body = { name: 'Rogue Society', addressLine: 'Road', city: 'Pune', state: 'MH', pincode: '411045', towers: ['T1'] };
      await http().post('/api/v1/societies').set(auth(adminA.token)).send(body).expect(403);
      await http().post('/api/v1/societies').set(auth(residentA.token)).send(body).expect(403);
      await http().get('/api/v1/platform/audit-events').set(auth(adminA.token)).expect(403);
      await http().post(`/api/v1/platform/societies/${A.id}/admin-invitations`).set(auth(adminA.token)).send({ phone: residentA.phone }).expect(403);
    });
  });

  describe('multiple societies and the active society', () => {
    it('a person can belong to several societies and choose an active one they belong to', async () => {
      const u = await registerMobile(app, { fullName: 'Two Homes' });
      const a = await invite(adminA.token, A.id, { phone: u.phone, role: 'RESIDENT', unitId: unitA.id, occupancy: 'OWNER' });
      const b = await invite(adminB.token, B.id, { phone: u.phone, role: 'GUARD' });
      await http().post('/api/v1/invitations/accept').set(auth(u.token)).send({ token: a.token }).expect(200);
      await http().post('/api/v1/invitations/accept').set(auth(u.token)).send({ token: b.token }).expect(200);

      const mine = await http().get('/api/v1/me/memberships').set(auth(u.token)).expect(200);
      expect(mine.body.items.map((m: { societyId: string; role: string }) => `${m.societyId}:${m.role}`).sort()).toEqual([`${A.id}:RESIDENT`, `${B.id}:GUARD`].sort());

      const set = await http().post('/api/v1/me/active-society').set(auth(u.token)).send({ societyId: B.id }).expect(200);
      expect(set.body.activeSocietyId).toBe(B.id);
      // Being a guard in B does not give resident access in B, nor guard access in A.
      await http().get(`/api/v1/societies/${B.id}/overview`).set(auth(u.token)).expect(403);
      await http().get(`/api/v1/societies/${A.id}/overview`).set(auth(u.token)).expect(200);

      const outsider = await createSociety(prisma, 'Palm Grove Apartments');
      await http().post('/api/v1/me/active-society').set(auth(u.token)).send({ societyId: outsider.id }).expect(403);
      const me = await http().get('/api/v1/auth/me').set(auth(u.token)).expect(200);
      expect(me.body.activeSocietyId).toBe(B.id);
    });
  });
});
