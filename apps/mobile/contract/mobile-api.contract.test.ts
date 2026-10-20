/**
 * Mobile ↔ backend contract test against a REAL running API (no mocks).
 * Uses the same shared client and MOBILE (bearer token) mode as src/lib/api.ts.
 *
 *   KREVIA_API_URL=http://localhost:4100 pnpm --filter @krevia/mobile test:contract
 */
import { ApiClientError, createApiClient } from '@krevia/shared';

const baseUrl = process.env.KREVIA_API_URL ?? 'http://localhost:4100';
let token: string | null = null;
const api = createApiClient({ baseUrl, clientType: 'MOBILE', getToken: () => token });

const phone = `6${String(Date.now()).slice(-9)}`;

async function expectError(p: Promise<unknown>, status: number) {
  await expect(p).rejects.toBeInstanceOf(ApiClientError);
  await p.catch((e: ApiClientError) => expect(e.status).toBe(status));
}

describe(`mobile client against ${baseUrl}`, () => {
  it('health check', async () => {
    expect((await api.health()).status).toBe('ok');
  });

  it('rejects unauthenticated access', async () => {
    await expectError(api.me(), 401);
  });

  it('registers and receives a bearer token (no cookie mode)', async () => {
    const res = await api.register({ fullName: 'Contract Test Resident', phone, password: 'Resident123' });
    expect(res.token).toEqual(expect.any(String));
    token = res.token!;
    expect((await api.me()).user.phone).toBe(`+91${phone}`);
  });

  it('searches persisted societies and submits a PENDING membership request', async () => {
    const { items } = await api.searchSocieties('green valley');
    expect(items.length).toBeGreaterThan(0);
    const { society } = await api.getSociety(items[0].id);
    const { request } = await api.createMembershipRequest({
      societyId: society.id,
      tower: society.towers[0],
      unitNumber: '101',
      occupancy: 'TENANT',
    });
    expect(request.status).toBe('PENDING');
    const mine = await api.myMembership();
    expect(mine.current?.id).toBe(request.id);
    await expectError(
      api.createMembershipRequest({ societyId: society.id, tower: society.towers[0], unitNumber: '102', occupancy: 'OWNER' }),
      409,
    );
    await api.cancelMembershipRequest(request.id);
  });

  it('logout revokes the token server-side', async () => {
    await api.logout();
    await expectError(api.me(), 401);
  });
});
