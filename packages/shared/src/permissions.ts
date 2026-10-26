/**
 * Central permission policy (Sprint 2). The API enforces it on every request
 * (apps/api/src/authz); clients only use it to decide what to show.
 *
 * Society permissions come from the user's ACTIVE memberships in that society.
 * Platform permissions come from `User.platformRole` and never include any
 * society permission: a platform administrator has no implicit access to a
 * society's data.
 */
export const MEMBER_ROLES = ['RESIDENT', 'ADMIN', 'GUARD'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Stored membership statuses. Only ACTIVE grants permissions. */
export const MEMBER_STATUSES = ['ACTIVE', 'SUSPENDED', 'REVOKED'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];
/**
 * Membership lifecycle shown to people: INVITED is a pending invitation (an
 * Invitation record bound to a phone number); the membership row is created
 * only when the invited person accepts while signed in to that number.
 */
export type MemberLifecycleStatus = 'INVITED' | MemberStatus;

export const SOCIETY_PERMISSIONS = [
  'society.read',
  'society.update',
  'membership.read',
  'membership.review',
  'membership.invite',
  'membership.manage',
  'building.read',
  'building.manage',
  'unit.read',
  'unit.create',
  'unit.assign',
  'resident.read',
  'resident.manage',
  'resident.import',
  'household.read',
  'security.access',
  'audit.read',
  'data.export',
] as const;
export type SocietyPermission = (typeof SOCIETY_PERMISSIONS)[number];

export const PLATFORM_PERMISSIONS = ['society.create', 'platform.society.read', 'platform.admin.assign', 'platform.audit.read'] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export type Permission = SocietyPermission | PlatformPermission;

export const ROLE_PERMISSIONS: Record<MemberRole, readonly SocietyPermission[]> = {
  ADMIN: [
    'society.read',
    'society.update',
    'membership.read',
    'membership.review',
    'membership.invite',
    'membership.manage',
    'building.read',
    'building.manage',
    'unit.read',
    'unit.create',
    'unit.assign',
    'resident.read',
    'resident.manage',
    'resident.import',
    'audit.read',
    'data.export',
  ],
  GUARD: ['security.access'],
  RESIDENT: ['society.read', 'household.read'],
};

export const PLATFORM_ROLE_PERMISSIONS: Record<'RESIDENT' | 'PLATFORM_ADMIN', readonly PlatformPermission[]> = {
  RESIDENT: [],
  PLATFORM_ADMIN: ['society.create', 'platform.society.read', 'platform.admin.assign', 'platform.audit.read'],
};

/** Union of the permissions granted by a set of ACTIVE society roles. */
export function societyPermissionsFor(roles: readonly MemberRole[]): Set<SocietyPermission> {
  return new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r]));
}

export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = { RESIDENT: 'Resident', ADMIN: 'Society Admin', GUARD: 'Security Guard' };
export const MEMBER_STATUS_LABEL: Record<MemberLifecycleStatus, string> = {
  INVITED: 'Invited',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  REVOKED: 'Revoked',
};
