import type {
  AdminMembershipRequestDto,
  ApiErrorBody,
  AuthResponseDto,
  ClientType,
  HealthDto,
  MembershipRequestDto,
  MyMembershipDto,
  SocietyDetailDto,
  SocietyOverviewDto,
  SocietySummaryDto,
  UserDto,
} from './types';
import type {
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

  return {
    health: () => request<HealthDto>('GET', '/health'),
    register: (input: RegisterInput) => request<AuthResponseDto>('POST', '/auth/register', input),
    login: (input: LoginInput) => request<AuthResponseDto>('POST', '/auth/login', input),
    logout: () => request<void>('POST', '/auth/logout'),
    me: () => request<{ user: UserDto }>('GET', '/auth/me'),
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
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
