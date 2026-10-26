import type {
  AdminMembershipRequestDto,
  AuditEventDto,
  BuildingDto,
  CreatedInvitationDto,
  InvitationDto,
  InvitationPreviewDto,
  MeDto,
  MemberDto,
  MyHouseholdDto,
  PageDto,
  ResidentDto,
  ResidentImportJobDto,
  UnitAssignmentDto,
  UnitDto,
  ApiErrorBody,
  AuthResponseDto,
  ClientType,
  FloorDto,
  HealthDto,
  MembershipRequestDto,
  MyMembershipDto,
  SocietyDetailDto,
  SocietyOverviewDto,
  SocietySummaryDto,
  UserDto,
} from './types';
import type {
  AddResidentUnitInput,
  AssignUnitInput,
  CreateBuildingInput,
  CreateFloorInput,
  CreateInvitationInput,
  CreateResidentInput,
  CreateSocietyInput,
  CreateUnitInput,
  PasswordResetConfirmInput,
  PasswordResetRequestInput,
  UpdateBuildingInput,
  UpdateFloorInput,
  UpdateMemberStatusInput,
  UpdateResidentInput,
  UpdateResidentUnitInput,
  UpdateSocietyInput,
  UpdateUnitInput,
  CreateMembershipRequestInput,
  LoginInput,
  RegisterInput,
  ReviewMembershipRequestInput,
  UpdateProfileInput,
} from './validation';

export const API_PREFIX = '/api/v1';
export const CLIENT_HEADER = 'X-Krevia-Client';

export type ApiClientErrorCode = ApiErrorBody['error']['code'] | 'NETWORK' | 'TIMEOUT';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiClientErrorCode,
    message: string,
    public readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  get isNetwork(): boolean {
    return this.code === 'NETWORK' || this.code === 'TIMEOUT';
  }
}

export interface ApiClientOptions {
  /** Origin of the API, e.g. `http://localhost:4000`. Empty string = same origin (web). */
  baseUrl: string;
  clientType: ClientType;
  /** Bearer token provider (mobile). */
  getToken?: () => string | null | Promise<string | null>;
  /** Called when the API answers 401 so clients can drop local session state. */
  onUnauthenticated?: () => void;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createApiClient(options: ApiClientOptions) {
  const timeoutMs = options.timeoutMs ?? 15000;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      [CLIENT_HEADER]: options.clientType.toLowerCase(),
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = options.getToken ? await options.getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${options.baseUrl}${API_PREFIX}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: options.clientType === 'WEB' ? 'include' : 'omit',
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = (err as { name?: string })?.name === 'AbortError';
      throw new ApiClientError(
        0,
        aborted ? 'TIMEOUT' : 'NETWORK',
        aborted
          ? 'The server took too long to respond. Please try again.'
          : 'Unable to reach Krevia. Check your internet connection and try again.',
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    if (!response.ok) {
      const errorBody = (json as ApiErrorBody | undefined)?.error;
      if (response.status === 401) options.onUnauthenticated?.();
      throw new ApiClientError(
        response.status,
        errorBody?.code ?? (response.status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'),
        errorBody?.message ?? 'Something went wrong. Please try again.',
        errorBody?.details,
      );
    }
    return json as T;
  }

  /** Sends a non-JSON body (CSV import) with the same auth, timeout and error handling. */
  async function requestText<T>(method: string, path: string, body: string, contentType: string): Promise<T> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': contentType,
      [CLIENT_HEADER]: options.clientType.toLowerCase(),
    };
    const token = options.getToken ? await options.getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${options.baseUrl}${API_PREFIX}${path}`, {
        method,
        headers,
        body,
        credentials: options.clientType === 'WEB' ? 'include' : 'omit',
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = (err as { name?: string })?.name === 'AbortError';
      throw new ApiClientError(
        0,
        aborted ? 'TIMEOUT' : 'NETWORK',
        aborted ? 'The server took too long to respond. Please try again.' : 'Unable to reach Krevia. Check your internet connection and try again.',
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    if (!response.ok) {
      const errorBody = (json as ApiErrorBody | undefined)?.error;
      if (response.status === 401) options.onUnauthenticated?.();
      throw new ApiClientError(
        response.status,
        errorBody?.code ?? (response.status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'),
        errorBody?.message ?? 'Something went wrong. Please try again.',
        errorBody?.details,
      );
    }
    return json as T;
  }

  return {
    health: () => request<HealthDto>('GET', '/health'),
    register: (input: RegisterInput) => request<AuthResponseDto>('POST', '/auth/register', input),
    login: (input: LoginInput) => request<AuthResponseDto>('POST', '/auth/login', input),
    logout: () => request<void>('POST', '/auth/logout'),
    me: () => request<MeDto>('GET', '/auth/me'),
    logoutAll: () => request<void>('POST', '/auth/logout-all'),
    requestPasswordReset: (input: PasswordResetRequestInput) =>
      request<{ message: string }>('POST', '/auth/password-reset/request', input),
    confirmPasswordReset: (input: PasswordResetConfirmInput) =>
      request<{ message: string }>('POST', '/auth/password-reset/confirm', input),
    setActiveSociety: (societyId: string) => request<MeDto>('POST', '/me/active-society', { societyId }),
    getProfile: () => request<{ user: UserDto }>('GET', '/profile'),
    updateProfile: (input: UpdateProfileInput) => request<{ user: UserDto }>('PATCH', '/profile', input),
    searchSocieties: (q: string, limit = 20) =>
      request<{ items: SocietySummaryDto[] }>(
        'GET',
        `/societies?q=${encodeURIComponent(q)}&limit=${limit}`,
      ),
    getSociety: (id: string) => request<{ society: SocietyDetailDto }>('GET', `/societies/${encodeURIComponent(id)}`),
    societyOverview: (id: string) => request<SocietyOverviewDto>('GET', `/societies/${encodeURIComponent(id)}/overview`),
    createMembershipRequest: (input: CreateMembershipRequestInput) =>
      request<{ request: MembershipRequestDto }>('POST', '/membership-requests', input),
    myMembership: () => request<MyMembershipDto>('GET', '/membership-requests/me'),
    cancelMembershipRequest: (id: string) =>
      request<{ request: MembershipRequestDto }>('POST', `/membership-requests/${encodeURIComponent(id)}/cancel`),
    adminSocieties: () => request<{ items: SocietySummaryDto[] }>('GET', '/admin/societies'),
    societyMembershipRequests: (societyId: string, status?: string) =>
      request<{ items: AdminMembershipRequestDto[] }>(
        'GET',
        `/societies/${encodeURIComponent(societyId)}/membership-requests${status ? `?status=${status}` : ''}`,
      ),
    approveMembershipRequest: (id: string, input: ReviewMembershipRequestInput = {}) =>
      request<{ request: AdminMembershipRequestDto }>('POST', `/membership-requests/${encodeURIComponent(id)}/approve`, input),
    rejectMembershipRequest: (id: string, input: ReviewMembershipRequestInput = {}) =>
      request<{ request: AdminMembershipRequestDto }>('POST', `/membership-requests/${encodeURIComponent(id)}/reject`, input),
    createSociety: (input: CreateSocietyInput) => request<{ society: SocietyDetailDto }>('POST', '/societies', input),
    updateSociety: (societyId: string, input: UpdateSocietyInput) =>
      request<{ society: SocietyDetailDto }>('PATCH', `/societies/${enc(societyId)}`, input),
    listMembers: (societyId: string, query: Query = {}) =>
      request<PageDto<MemberDto>>('GET', `/societies/${enc(societyId)}/members${qs(query)}`),
    updateMemberStatus: (societyId: string, membershipId: string, input: UpdateMemberStatusInput) =>
      request<{ member: MemberDto }>('PATCH', `/societies/${enc(societyId)}/members/${enc(membershipId)}`, input),
    membersExportUrl: (societyId: string) => `${options.baseUrl}${API_PREFIX}/societies/${enc(societyId)}/members/export`,
    listBuildings: (societyId: string, query: Query = {}) =>
      request<{ items: BuildingDto[] }>('GET', `/societies/${enc(societyId)}/buildings${qs(query)}`),
    createBuilding: (societyId: string, input: CreateBuildingInput) =>
      request<{ building: BuildingDto }>('POST', `/societies/${enc(societyId)}/buildings`, input),
    updateBuilding: (societyId: string, buildingId: string, input: UpdateBuildingInput) =>
      request<{ building: BuildingDto }>('PATCH', `/societies/${enc(societyId)}/buildings/${enc(buildingId)}`, input),
    archiveBuilding: (societyId: string, buildingId: string) =>
      request<{ building: BuildingDto }>('POST', `/societies/${enc(societyId)}/buildings/${enc(buildingId)}/archive`),
    createFloor: (societyId: string, buildingId: string, input: CreateFloorInput) =>
      request<{ floor: FloorDto }>('POST', `/societies/${enc(societyId)}/buildings/${enc(buildingId)}/floors`, input),
    updateFloor: (societyId: string, buildingId: string, floorId: string, input: UpdateFloorInput) =>
      request<{ floor: FloorDto }>('PATCH', `/societies/${enc(societyId)}/buildings/${enc(buildingId)}/floors/${enc(floorId)}`, input),
    deleteFloor: (societyId: string, buildingId: string, floorId: string) =>
      request<void>('DELETE', `/societies/${enc(societyId)}/buildings/${enc(buildingId)}/floors/${enc(floorId)}`),
    listUnits: (societyId: string, query: Query = {}) =>
      request<PageDto<UnitDto>>('GET', `/societies/${enc(societyId)}/units${qs(query)}`),
    createUnit: (societyId: string, input: CreateUnitInput) =>
      request<{ unit: UnitDto }>('POST', `/societies/${enc(societyId)}/units`, input),
    updateUnit: (societyId: string, unitId: string, input: UpdateUnitInput) =>
      request<{ unit: UnitDto }>('PATCH', `/societies/${enc(societyId)}/units/${enc(unitId)}`, input),
    archiveUnit: (societyId: string, unitId: string) =>
      request<{ unit: UnitDto }>('POST', `/societies/${enc(societyId)}/units/${enc(unitId)}/archive`),
    restoreUnit: (societyId: string, unitId: string) =>
      request<{ unit: UnitDto }>('POST', `/societies/${enc(societyId)}/units/${enc(unitId)}/restore`),
    myUnits: (societyId: string) => request<{ items: UnitDto[] }>('GET', `/societies/${enc(societyId)}/my-units`),
    myHousehold: (societyId: string) => request<MyHouseholdDto>('GET', `/societies/${enc(societyId)}/my-household`),
    assignUnit: (societyId: string, unitId: string, input: AssignUnitInput) =>
      request<{ assignment: UnitAssignmentDto }>('POST', `/societies/${enc(societyId)}/units/${enc(unitId)}/assignments`, input),
    endAssignment: (societyId: string, unitId: string, assignmentId: string) =>
      request<void>('DELETE', `/societies/${enc(societyId)}/units/${enc(unitId)}/assignments/${enc(assignmentId)}`),
    listResidents: (societyId: string, query: Query = {}) =>
      request<PageDto<ResidentDto>>('GET', `/societies/${enc(societyId)}/residents${qs(query)}`),
    getResident: (societyId: string, residentId: string) =>
      request<{ resident: ResidentDto }>('GET', `/societies/${enc(societyId)}/residents/${enc(residentId)}`),
    createResident: (societyId: string, input: CreateResidentInput) =>
      request<{ resident: ResidentDto }>('POST', `/societies/${enc(societyId)}/residents`, input),
    updateResident: (societyId: string, residentId: string, input: UpdateResidentInput) =>
      request<{ resident: ResidentDto }>('PATCH', `/societies/${enc(societyId)}/residents/${enc(residentId)}`, input),
    archiveResident: (societyId: string, residentId: string) =>
      request<{ resident: ResidentDto }>('POST', `/societies/${enc(societyId)}/residents/${enc(residentId)}/archive`),
    addResidentUnit: (societyId: string, residentId: string, input: AddResidentUnitInput) =>
      request<{ resident: ResidentDto }>('POST', `/societies/${enc(societyId)}/residents/${enc(residentId)}/units`, input),
    updateResidentUnit: (societyId: string, residentId: string, residentUnitId: string, input: UpdateResidentUnitInput) =>
      request<{ resident: ResidentDto }>('PATCH', `/societies/${enc(societyId)}/residents/${enc(residentId)}/units/${enc(residentUnitId)}`, input),
    endResidentUnit: (societyId: string, residentId: string, residentUnitId: string) =>
      request<{ resident: ResidentDto }>('DELETE', `/societies/${enc(societyId)}/residents/${enc(residentId)}/units/${enc(residentUnitId)}`),
    residentsImportTemplateUrl: (societyId: string) =>
      `${options.baseUrl}${API_PREFIX}/societies/${enc(societyId)}/residents/import/template`,
    listResidentImports: (societyId: string, query: Query = {}) =>
      request<PageDto<ResidentImportJobDto>>('GET', `/societies/${enc(societyId)}/residents/imports${qs(query)}`),
    previewResidentImport: (societyId: string, fileName: string, csv: string) =>
      requestText<{ job: ResidentImportJobDto }>(
        'POST',
        `/societies/${enc(societyId)}/residents/imports/preview${qs({ fileName })}`,
        csv,
        'text/csv',
      ),
    confirmResidentImport: (societyId: string, jobId: string) =>
      request<{ job: ResidentImportJobDto }>('POST', `/societies/${enc(societyId)}/residents/imports/${enc(jobId)}/confirm`),
    getResidentImport: (societyId: string, jobId: string) =>
      request<{ job: ResidentImportJobDto }>('GET', `/societies/${enc(societyId)}/residents/imports/${enc(jobId)}`),
    residentImportErrorsUrl: (societyId: string, jobId: string) =>
      `${options.baseUrl}${API_PREFIX}/societies/${enc(societyId)}/residents/imports/${enc(jobId)}/errors.csv`,
    listInvitations: (societyId: string, query: Query = {}) =>
      request<PageDto<InvitationDto>>('GET', `/societies/${enc(societyId)}/invitations${qs(query)}`),
    createInvitation: (societyId: string, input: CreateInvitationInput) =>
      request<CreatedInvitationDto>('POST', `/societies/${enc(societyId)}/invitations`, input),
    revokeInvitation: (societyId: string, invitationId: string) =>
      request<{ invitation: InvitationDto }>('POST', `/societies/${enc(societyId)}/invitations/${enc(invitationId)}/revoke`),
    previewInvitation: (token: string) => request<{ invitation: InvitationPreviewDto }>('POST', '/invitations/preview', { token }),
    acceptInvitation: (token: string) => request<MeDto>('POST', '/invitations/accept', { token }),
    societyAuditEvents: (societyId: string, query: Query = {}) =>
      request<PageDto<AuditEventDto>>('GET', `/societies/${enc(societyId)}/audit-events${qs(query)}`),
  };
}

type Query = Record<string, string | number | undefined>;
const enc = encodeURIComponent;
function qs(query: Query): string {
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${enc(k)}=${enc(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export type ApiClient = ReturnType<typeof createApiClient>;
