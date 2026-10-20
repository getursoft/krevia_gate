import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';
import { ApiClientError, ROLE_NAVIGATION, type AdminMembershipRequestDto, type UserDto } from '@krevia/shared';
import { SettingsScreen } from '../src/screens/HomeScreens';
import { AdminRequestsScreen, HomeScreen, MoreScreen, ModuleScreen } from '../src/screens/RoleScreens';
import { mockApi, mockParams, mockRouter, pendingRequest, renderWithSession, society, user } from './test-utils';

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const staffRole = (role: 'ADMIN' | 'GUARD') => ({ societyId: society.id, societyName: society.name, city: 'Pune', state: 'Maharashtra', role });
const admin: UserDto = { ...user, fullName: 'Meera Iyer', adminSocietyIds: [society.id], societyRoles: [staffRole('ADMIN')] };
const guard: UserDto = { ...user, fullName: 'Ravi Singh', guardSocietyIds: [society.id], societyRoles: [staffRole('GUARD')] };

const adminRequest: AdminMembershipRequestDto = { ...pendingRequest, applicant: { id: 'u9', fullName: 'Kiran Desai', phone: '+919811111111' } };

async function signInAs(u: UserDto, ui: React.ReactElement) {
  store.set('krevia.session.token', 'token');
  mockApi.me.mockResolvedValue({ user: u });
  await renderWithSession(ui);
}

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  mockParams.current = {};
});

describe('Role dashboards', () => {
  it('resident home shows membership from the API and the resident quick actions', async () => {
    mockApi.myMembership.mockResolvedValue({ current: pendingRequest, history: [pendingRequest] });
    await signInAs(user, <HomeScreen />);
    expect(await screen.findByTestId('resident-home')).toBeTruthy();
    expect(await screen.findByTestId('dashboard-society')).toHaveTextContent('Green Valley Residency');
    expect(screen.getByTestId('membership-status')).toHaveTextContent('Pending verification');
    expect(screen.getByText(/Welcome back,/)).toBeTruthy();
    for (const item of ROLE_NAVIGATION.RESIDENT.quickActions) expect(screen.getByText(item.label)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('qa-payments'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/module/[key]', params: { key: 'payments' } });
  });

  it('a society admin lands on the admin dashboard with live society stats', async () => {
    mockApi.societyOverview.mockResolvedValue({ society: { ...society, towers: ['T1'] }, approvedMembers: 12, pendingRequests: 3, totalUnits: 40 });
    mockApi.societyMembershipRequests.mockResolvedValue({ items: [adminRequest] });
    await signInAs(admin, <HomeScreen />);
    expect(await screen.findByTestId('admin-home')).toBeTruthy();
    expect(screen.getByTestId('header-role')).toHaveTextContent('Admin Panel');
    await waitFor(() => expect(screen.getByTestId('stat-units')).toHaveTextContent('40'));
    expect(screen.getByTestId('stat-residents')).toHaveTextContent('12');
    expect(screen.getByTestId('stat-pending')).toHaveTextContent('3');
    expect(mockApi.societyOverview).toHaveBeenCalledWith(society.id);
    expect(await screen.findByText(/Kiran Desai/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('qa-residents'));
    expect(mockRouter.push).toHaveBeenCalledWith('/requests');
  });

  it('a security guard lands on the gate console', async () => {
    await signInAs(guard, <HomeScreen />);
    expect(await screen.findByTestId('guard-home')).toBeTruthy();
    expect(screen.getByTestId('header-role')).toHaveTextContent('Gate App');
    expect(screen.getByText('Live')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('scan-qr'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/module/[key]', params: { key: 'scan-qr' } });
    expect(screen.getByText('No visitors entries')).toBeTruthy();
  });

  it('shows an error with retry when admin stats fail to load', async () => {
    mockApi.societyOverview
      .mockRejectedValueOnce(new ApiClientError(500, 'INTERNAL', 'Something went wrong. Please try again.'))
      .mockResolvedValueOnce({ society: { ...society, towers: [] }, approvedMembers: 1, pendingRequests: 0, totalUnits: 2 });
    mockApi.societyMembershipRequests.mockResolvedValue({ items: [] });
    await signInAs(admin, <HomeScreen />);
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    await act(async () => await fireEvent.press(screen.getByTestId('retry')));
    await waitFor(() => expect(screen.getByTestId('stat-units')).toHaveTextContent('2'));
  });
});

describe('More menus', () => {
  it.each([
    ['RESIDENT', user],
    ['ADMIN', admin],
    ['GUARD', guard],
  ] as const)('%s menu lists every showcase item', async (role, u) => {
    await signInAs(u, <MoreScreen />);
    await screen.findByTestId('more-screen');
    for (const item of ROLE_NAVIGATION[role].more) expect(screen.getByText(item.label)).toBeTruthy();
    if (role === 'GUARD') expect(screen.getByText('Logout')).toBeTruthy();
  });

  it('search filters the menu and built screens open directly', async () => {
    await signInAs(user, <MoreScreen />);
    await screen.findByTestId('more-screen');
    await fireEvent.changeText(screen.getByTestId('more-search'), 'profile');
    expect(screen.getByText('My Profile')).toBeTruthy();
    expect(screen.queryByText('Buy & Sell')).toBeNull();
    await fireEvent.press(screen.getByTestId('menu-profile'));
    expect(mockRouter.push).toHaveBeenCalledWith('/profile');
  });

  it('unbuilt modules show an honest coming-soon screen', async () => {
    mockParams.current = { key: 'visitor-log' };
    await signInAs(guard, <ModuleScreen />);
    expect(await screen.findByTestId('coming-soon')).toBeTruthy();
    expect(screen.getByText('Visitor Log')).toBeTruthy();
    expect(screen.getAllByText(/Coming soon/i).length).toBeGreaterThan(0);
  });
});

describe('Admin approvals and view switching', () => {
  it('approves a pending resident request through the API', async () => {
    mockApi.societyMembershipRequests.mockResolvedValue({ items: [adminRequest] });
    mockApi.approveMembershipRequest.mockResolvedValue({ request: { ...adminRequest, status: 'APPROVED' } });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    await signInAs(admin, <AdminRequestsScreen inStack />);
    expect(await screen.findByText('Kiran Desai')).toBeTruthy();
    expect(mockApi.societyMembershipRequests).toHaveBeenCalledWith(society.id, 'PENDING');
    await act(async () => await fireEvent.press(screen.getByTestId(`approve-${adminRequest.id}`)));
    expect(mockApi.approveMembershipRequest).toHaveBeenCalledWith(adminRequest.id);
    expect(await screen.findByText("Kiran Desai's request was approved.")).toBeTruthy();
    expect(screen.getByText('All caught up')).toBeTruthy();
    alertSpy.mockRestore();
  });

  it('a multi-role user can switch to the resident view', async () => {
    mockApi.myMembership.mockResolvedValue({ current: null, history: [] });
    mockApi.societyOverview.mockResolvedValue({ society: { ...society, towers: [] }, approvedMembers: 0, pendingRequests: 0, totalUnits: 0 });
    mockApi.societyMembershipRequests.mockResolvedValue({ items: [] });
    await signInAs(admin, <><SettingsScreen /><HomeScreen /></>);
    expect(await screen.findByTestId('admin-home')).toBeTruthy();
    expect(screen.getByTestId('role-switcher')).toBeTruthy();
    await act(async () => await fireEvent.press(screen.getByTestId('role-RESIDENT')));
    expect(await screen.findByTestId('resident-home')).toBeTruthy();
    expect(mockRouter.replace).toHaveBeenCalledWith('/(app)/(tabs)');
  });

  it('a single-role resident does not see the view switcher', async () => {
    await signInAs(user, <SettingsScreen />);
    await screen.findByTestId('settings-screen');
    expect(screen.queryByTestId('role-switcher')).toBeNull();
  });
});
