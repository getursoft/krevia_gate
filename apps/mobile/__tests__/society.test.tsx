import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiClientError } from '@krevia/shared';
import { MembershipStatusScreen, ReviewScreen, SocietyDetailsScreen, SocietySearchScreen } from '../src/screens/SocietyScreens';
import { mockApi, mockParams, mockRouter, networkError, pendingRequest, renderWithSession, society } from './test-utils';

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.current = {};
});

describe('Society search', () => {
  it('lists societies from the API and opens the selected one', async () => {
    mockApi.searchSocieties.mockResolvedValue({ items: [society] });
    await renderWithSession(<SocietySearchScreen />);
    await fireEvent.changeText(screen.getByTestId('society-search'), 'valley');
    await waitFor(() => expect(mockApi.searchSocieties).toHaveBeenLastCalledWith('valley'));
    await fireEvent.press(await screen.findByLabelText('Green Valley Residency, Pune'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/join/[societyId]', params: { societyId: society.id } });
  });

  it('shows an empty state when nothing matches', async () => {
    mockApi.searchSocieties.mockResolvedValue({ items: [] });
    await renderWithSession(<SocietySearchScreen />);
    expect(await screen.findByText('No societies found')).toBeTruthy();
  });

  it('shows an offline error and recovers on retry', async () => {
    mockApi.searchSocieties.mockRejectedValueOnce(networkError()).mockResolvedValueOnce({ items: [society] });
    await renderWithSession(<SocietySearchScreen />);
    expect(await screen.findByText('You appear to be offline')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('retry'));
    expect(await screen.findByText('Green Valley Residency')).toBeTruthy();
  });
});

describe('Membership request flow', () => {
  it('validates apartment details before continuing', async () => {
    mockParams.current = { societyId: society.id };
    mockApi.getSociety.mockResolvedValue({ society: { ...society, towers: ['T1', 'T2'] } });
    await renderWithSession(<SocietyDetailsScreen />);
    expect(await screen.findByTestId('selected-society')).toHaveTextContent('Green Valley Residency');
    await fireEvent.press(screen.getByTestId('continue'));
    expect(await screen.findByText('Tower / block is required')).toBeTruthy();
    expect(screen.getByText('Flat / unit number is required')).toBeTruthy();
    expect(screen.getByText('Select owner, tenant or household member')).toBeTruthy();
    expect(mockRouter.push).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('T2'));
    await fireEvent.changeText(screen.getByTestId('unitNumber'), 'b-704');
    await fireEvent.press(screen.getByLabelText('Tenant'));
    await fireEvent.press(screen.getByTestId('continue'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/join/review',
      params: { societyId: society.id, societyName: society.name, tower: 'T2', unitNumber: 'B-704', occupancy: 'TENANT' },
    });
  });

  it('submits the request and navigates to the status screen', async () => {
    mockParams.current = { societyId: society.id, societyName: society.name, tower: 'T1', unitNumber: '1203', occupancy: 'OWNER' };
    mockApi.createMembershipRequest.mockResolvedValue({ request: pendingRequest });
    await renderWithSession(<ReviewScreen />);
    await act(async () => await fireEvent.press(screen.getByTestId('submit-request')));
    expect(mockApi.createMembershipRequest).toHaveBeenCalledWith({ societyId: society.id, tower: 'T1', unitNumber: '1203', occupancy: 'OWNER' });
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/society'));
  });

  it('shows the duplicate-request error from the server', async () => {
    mockParams.current = { societyId: society.id, societyName: society.name, tower: 'T1', unitNumber: '1203', occupancy: 'OWNER' };
    mockApi.createMembershipRequest.mockRejectedValue(
      new ApiClientError(409, 'CONFLICT', 'You already have a pending request for Green Valley Residency. Please wait for verification.'),
    );
    await renderWithSession(<ReviewScreen />);
    await act(async () => await fireEvent.press(screen.getByTestId('submit-request')));
    expect(await screen.findByText(/already have a pending request/)).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('shows the actual status returned by the backend', async () => {
    mockApi.myMembership.mockResolvedValue({ current: pendingRequest, history: [pendingRequest] });
    await renderWithSession(<MembershipStatusScreen />);
    expect(await screen.findByTestId('membership-status')).toHaveTextContent('Pending verification');
    expect(screen.getByTestId('status-unit')).toHaveTextContent('T1 · 1203');

    mockApi.myMembership.mockResolvedValue({ current: { ...pendingRequest, status: 'APPROVED' }, history: [] });
    await act(async () => await fireEvent.press(screen.getByTestId('refresh-status')));
    await waitFor(() => expect(screen.getByTestId('membership-status')).toHaveTextContent('Approved'));
  });

  it('offers to join when the user has no request', async () => {
    mockApi.myMembership.mockResolvedValue({ current: null, history: [] });
    await renderWithSession(<MembershipStatusScreen />);
    await fireEvent.press(await screen.findByTestId('start-join'));
    expect(mockRouter.push).toHaveBeenCalledWith('/join/search');
  });
});
