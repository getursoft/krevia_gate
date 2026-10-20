import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Text } from 'react-native';
import { ApiClientError } from '@krevia/shared';
import { Button } from '../src/components/ui';
import { onApiUnauthenticated, setApiToken } from '../src/lib/api';
import { useSession } from '../src/lib/session';
import { mockApi, networkError, renderWithSession, user } from './test-utils';

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

function Probe() {
  const { state, retryRestore, logout } = useSession();
  return (
    <>
      <Text testID="state">{state.status}</Text>
      {state.status === 'signedIn' && <Text testID="name">{state.user.fullName}</Text>}
      <Button title="retry" onPress={retryRestore} testID="retry" />
      <Button title="logout" onPress={logout} testID="logout" />
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
});

describe('Session restoration and authentication states', () => {
  it('is signed out when no token is stored', async () => {
    await renderWithSession(<Probe />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('signedOut'));
    expect(mockApi.me).not.toHaveBeenCalled();
  });

  it('treats an unreadable secure store as signed out instead of hanging', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keychain unavailable'));
    await renderWithSession(<Probe />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('signedOut'));
  });

  it('restores a stored session after the server validates it', async () => {
    store.set('krevia.session.token', 'stored-token');
    mockApi.me.mockResolvedValue({ user });
    await renderWithSession(<Probe />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('signedIn'));
    expect(setApiToken).toHaveBeenCalledWith('stored-token');
    expect(screen.getByTestId('name')).toHaveTextContent('Asha Rao');
  });

  it('discards a token the server rejects (expired or revoked)', async () => {
    store.set('krevia.session.token', 'revoked');
    mockApi.me.mockRejectedValue(new ApiClientError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'));
    await renderWithSession(<Probe />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('signedOut'));
    expect(store.has('krevia.session.token')).toBe(false);
  });

  it('keeps the token while offline and recovers on retry', async () => {
    store.set('krevia.session.token', 'stored-token');
    mockApi.me.mockRejectedValueOnce(networkError()).mockResolvedValueOnce({ user });
    await renderWithSession(<Probe />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('offline'));
    expect(store.has('krevia.session.token')).toBe(true);
    await act(async () => await fireEvent.press(screen.getByTestId('retry')));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('signedIn'));
  });

  it('logout revokes on the server and clears secure storage', async () => {
    store.set('krevia.session.token', 'stored-token');
    mockApi.me.mockResolvedValue({ user });
    mockApi.logout.mockResolvedValue(undefined);
    await renderWithSession(<Probe />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('signedIn'));
    await act(async () => await fireEvent.press(screen.getByTestId('logout')));
    expect(mockApi.logout).toHaveBeenCalled();
    expect(store.has('krevia.session.token')).toBe(false);
    expect(screen.getByTestId('state')).toHaveTextContent('signedOut');
  });

  it('signs out locally when any API call returns 401', async () => {
    store.set('krevia.session.token', 'stored-token');
    mockApi.me.mockResolvedValue({ user });
    await renderWithSession(<Probe />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('signedIn'));
    const handler = (onApiUnauthenticated as jest.Mock).mock.calls.filter((c) => c[0]).at(-1)?.[0] as () => void;
    await act(async () => handler());
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('signedOut'));
  });
});
