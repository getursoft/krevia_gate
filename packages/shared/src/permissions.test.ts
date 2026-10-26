import {
  PLATFORM_ROLE_PERMISSIONS,
  ROLE_PERMISSIONS,
  SOCIETY_PERMISSIONS,
  societyPermissionsFor,
} from './permissions';

const ADMIN_ONLY = [
  'society.update',
  'membership.read',
  'membership.review',
  'membership.invite',
  'membership.manage',
  'building.read',
  'building.manage',
  'unit.create',
  'unit.assign',
  'resident.read',
  'resident.manage',
  'resident.import',
  'audit.read',
  'data.export',
] as const;

describe('permission matrix', () => {
  it('guards hold only security access (least privilege)', () => {
    expect([...societyPermissionsFor(['GUARD'])]).toEqual(['security.access']);
    for (const p of ADMIN_ONLY) expect(societyPermissionsFor(['GUARD']).has(p)).toBe(false);
  });

  it('residents read their society and household only', () => {
    expect([...societyPermissionsFor(['RESIDENT'])].sort()).toEqual(['household.read', 'society.read']);
    for (const p of ADMIN_ONLY) expect(societyPermissionsFor(['RESIDENT']).has(p)).toBe(false);
  });

  it('society admins hold every administrative permission but not household or gate access', () => {
    const admin = societyPermissionsFor(['ADMIN']);
    for (const p of ADMIN_ONLY) expect(admin.has(p)).toBe(true);
    expect(admin.has('household.read')).toBe(false);
    expect(admin.has('security.access')).toBe(false);
  });

  it('platform admins get platform permissions only, never society permissions', () => {
    const platform: readonly string[] = PLATFORM_ROLE_PERMISSIONS.PLATFORM_ADMIN;
    for (const p of SOCIETY_PERMISSIONS) expect(platform).not.toContain(p);
    expect(PLATFORM_ROLE_PERMISSIONS.RESIDENT).toEqual([]);
  });

  it('roles combine by union and no roles grant nothing', () => {
    expect(societyPermissionsFor([]).size).toBe(0);
    const both = societyPermissionsFor(['ADMIN', 'RESIDENT']);
    expect(both.has('household.read') && both.has('membership.manage')).toBe(true);
    for (const perms of Object.values(ROLE_PERMISSIONS)) for (const p of perms) expect(SOCIETY_PERMISSIONS).toContain(p);
  });
});
