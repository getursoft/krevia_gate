export type PlatformRole = 'RESIDENT' | 'PLATFORM_ADMIN';
export type OccupancyType = 'OWNER' | 'TENANT' | 'HOUSEHOLD';
export type UnitStatus = 'ACTIVE' | 'ARCHIVED';
export type UnitOccupancyStatus = 'VACANT' | 'OCCUPIED';
export type ResidentStatus = 'ACTIVE' | 'INACTIVE';
export type ImportJobStatus = 'PREVIEWED' | 'IMPORTING' | 'COMPLETED' | 'FAILED';
export type ImportRowAction = 'CREATE' | 'UPDATE' | 'SKIP' | 'REJECT';
/** Status of a self-service join request. REVOKED: the resulting membership was later revoked. */
export type MembershipStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'REVOKED';
export type ClientType = 'WEB' | 'MOBILE';
export type SocietyRoleType = 'ADMIN' | 'GUARD';
/** The three experiences of the product. */
export type AppRole = 'RESIDENT' | 'ADMIN' | 'GUARD';

import type { MemberRole, MemberStatus } from './permissions';

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
  /** Every membership the user holds (any status), across societies. */
  memberships: MyMembershipSummaryDto[];
  createdAt: string;
}

/** One of the current user's memberships. Only ACTIVE memberships grant permissions. */
export interface MyMembershipSummaryDto {
  id: string;
  societyId: string;
  societyName: string;
  city: string;
  role: MemberRole;
  status: MemberStatus;
}

export interface MeDto {
  user: UserDto;
  /** Society chosen for this session (validated server-side), or null. */
  activeSocietyId: string | null;
}

export interface PageDto<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface UnitAssignmentDto {
  id: string;
  unitId: string;
  tower: string;
  number: string;
  occupancy: OccupancyType;
  assignedAt: string;
}

/** Admin view of a society member. */
export interface MemberDto {
  id: string;
  role: MemberRole;
  status: MemberStatus;
  user: { id: string; fullName: string; phone: string };
  units: UnitAssignmentDto[];
  createdAt: string;
  statusChangedAt: string | null;
}

export interface BuildingDto {
  id: string;
  societyId: string;
  name: string;
  archivedAt: string | null;
  floors: FloorDto[];
  unitCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FloorDto {
  id: string;
  buildingId: string;
  level: number;
  name: string | null;
  unitCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UnitDto {
  id: string;
  societyId: string;
  tower: string;
  number: string;
  buildingId: string;
  buildingName: string;
  floorId: string | null;
  floorLevel: number | null;
  floorName: string | null;
  status: UnitStatus;
  /** Derived from current active assignments/resident links. */
  occupancyStatus: UnitOccupancyStatus;
  archivedAt: string | null;
  residents: { assignmentId: string | null; residentId: string; membershipId: string | null; fullName: string; occupancy: OccupancyType }[];
  createdAt: string;
  updatedAt: string;
}

export interface VehicleDto {
  number: string;
  type?: string;
}

export interface ResidentUnitDto {
  id: string;
  unitId: string;
  buildingId: string;
  buildingName: string;
  tower: string;
  number: string;
  floorId: string | null;
  floorLevel: number | null;
  relationship: OccupancyType;
  isPrimary: boolean;
  startedAt: string;
  endedAt: string | null;
}

export interface ResidentDto {
  id: string;
  societyId: string;
  userId: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: ResidentStatus;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  vehicles: VehicleDto[];
  units: ResidentUnitDto[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A resident's own view: only their profile and the household in their units. */
export interface MyHouseholdDto {
  resident: ResidentDto | null;
  units: {
    unit: UnitDto;
    relationship: OccupancyType;
    isPrimary: boolean;
    household: { id: string; fullName: string; relationship: OccupancyType; maskedPhone: string | null }[];
  }[];
}

export interface ImportRowErrorDto {
  rowNumber: number;
  field: string;
  message: string;
}

export interface ImportPreviewRowDto {
  rowNumber: number;
  action: ImportRowAction;
  building: string;
  floor: number | null;
  unitNumber: string;
  residentName: string | null;
  relationship: OccupancyType | null;
  message: string | null;
}

export interface ResidentImportJobDto {
  id: string;
  societyId: string;
  fileName: string;
  status: ImportJobStatus;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  rejectedRows: number;
  errors: ImportRowErrorDto[];
  rows: ImportPreviewRowDto[];
  failureReason: string | null;
  /** True when an identical file had already been previewed or imported. */
  alreadyProcessed: boolean;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
}

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface InvitationDto {
  id: string;
  societyId: string;
  /** Masked except the last 4 digits. */
  phone: string;
  role: MemberRole;
  unit: { id: string; tower: string; number: string } | null;
  occupancy: OccupancyType | null;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

/** Returned once, when an invitation is created. The token is never stored or shown again. */
export interface CreatedInvitationDto {
  invitation: InvitationDto;
  inviteUrl: string;
  /** Whether a message was handed to a delivery channel (false when none is configured). */
  delivered: boolean;
  /** `dev-outbox` (development only, not a real SMS), `none`, or a provider name. */
  channel: string;
}

/** What an invitee sees before accepting. */
export interface InvitationPreviewDto {
  society: { id: string; name: string; city: string };
  role: MemberRole;
  unit: { tower: string; number: string } | null;
  phone: string;
  expiresAt: string;
}

export type AuditOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED';

export interface AuditEventDto {
  id: string;
  createdAt: string;
  action: string;
  outcome: AuditOutcome;
  actor: { id: string; fullName: string } | null;
  societyId: string | null;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
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
