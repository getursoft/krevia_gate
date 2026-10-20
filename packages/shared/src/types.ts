export type PlatformRole = 'RESIDENT' | 'PLATFORM_ADMIN';
export type OccupancyType = 'OWNER' | 'TENANT';
export type MembershipStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type ClientType = 'WEB' | 'MOBILE';
export type SocietyRoleType = 'ADMIN' | 'GUARD';
/** The three experiences of the product. */
export type AppRole = 'RESIDENT' | 'ADMIN' | 'GUARD';

export interface SocietyRoleDto {
  societyId: string;
  societyName: string;
  city: string;
  state: string;
  role: SocietyRoleType;
}

export interface UserDto {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  platformRole: PlatformRole;
  /** Society ids where this user holds the society ADMIN role. */
  adminSocietyIds: string[];
  /** Society ids where this user is a security guard. */
  guardSocietyIds: string[];
  /** All society-level staff roles with society names, for dashboards and view switching. */
  societyRoles: SocietyRoleDto[];
  createdAt: string;
}

export interface SocietySummaryDto {
  id: string;
  name: string;
  city: string;
  state: string;
  pincode: string;
  addressLine: string;
}

export interface SocietyDetailDto extends SocietySummaryDto {
  towers: string[];
}

export interface MembershipRequestDto {
  id: string;
  status: MembershipStatus;
  occupancy: OccupancyType;
  tower: string;
  unitNumber: string;
  society: SocietySummaryDto;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Admin view of a request includes the applicant's identity. */
export interface AdminMembershipRequestDto extends MembershipRequestDto {
  applicant: { id: string; fullName: string; phone: string };
}

export interface AuthResponseDto {
  user: UserDto;
  /** Only returned to mobile clients; web clients receive an httpOnly cookie. */
  token?: string;
  expiresAt: string;
}

export interface MyMembershipDto {
  /** The current PENDING or APPROVED request, if any. */
  current: MembershipRequestDto | null;
  /** All requests, newest first. */
  history: MembershipRequestDto[];
}

export interface HealthDto {
  status: 'ok';
  service: 'krevia-api';
  version: string;
  time: string;
}

export interface ReadyDto {
  status: 'ready' | 'not_ready';
  service: 'krevia-api';
  checks: { database: 'up' | 'down' };
}

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, string>;
    requestId?: string;
  };
}

/** GET /societies/:id/overview. Member-only; admin-only fields are omitted for residents. */
export interface SocietyOverviewDto {
  society: SocietyDetailDto;
  approvedMembers: number;
  pendingRequests?: number;
  totalUnits?: number;
}
