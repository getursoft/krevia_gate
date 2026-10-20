import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiClientError, type MembershipRequestDto, type UserDto } from '@krevia/shared';
import { api } from '../src/lib/api';
import { SessionProvider } from '../src/lib/session';

export { mockParams, mockRouter } from './router-mock';

export const mockApi = api as unknown as Record<keyof typeof api, jest.Mock>;

export const user: UserDto = {
  id: 'u1',
  fullName: 'Asha Rao',
  phone: '+919876543210',
  email: null,
  platformRole: 'RESIDENT',
  adminSocietyIds: [],
  guardSocietyIds: [],
  societyRoles: [],
  createdAt: '2026-10-01T00:00:00.000Z',
};

export const society = {
  id: '3f1c9a8e-1b2c-4d5e-8f90-123456789abc',
  name: 'Green Valley Residency',
  addressLine: 'Baner Road',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411045',
};

export const pendingRequest: MembershipRequestDto = {
  id: 'r1',
  status: 'PENDING',
  occupancy: 'OWNER',
  tower: 'T1',
  unitNumber: '1203',
  society,
  reviewNote: null,
  reviewedAt: null,
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
};

export const networkError = () =>
  new ApiClientError(0, 'NETWORK', 'Unable to reach Krevia. Check your internet connection and try again.');

export async function renderWithSession(ui: ReactElement) {
  return await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <SessionProvider>{ui}</SessionProvider>
    </SafeAreaProvider>,
  );
}
