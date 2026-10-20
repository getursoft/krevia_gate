import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { ApiClientError } from '@krevia/shared';
import { LoginScreen, RegisterScreen, WelcomeScreen } from '../src/screens/AuthScreens';
import { mockApi, mockRouter, renderWithSession, user } from './test-utils';

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
});

describe('Welcome', () => {
  it('shows the Krevia brand and exact tagline', async () => {
    await renderWithSession(<WelcomeScreen />);
    expect(await screen.findByTestId('tagline')).toHaveTextContent('Secured. Transparent. Trust.');
    expect(screen.getByText('Krevia')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('go-register'));
    expect(mockRouter.push).toHaveBeenCalledWith('/register');
  });
});

describe('Login form', () => {
  it('validates Indian mobile number and password before calling the API', async () => {
    await renderWithSession(<LoginScreen />);
    await fireEvent.changeText(screen.getByTestId('phone'), '12345');
    await fireEvent.press(screen.getByTestId('submit-login'));
    expect(await screen.findByText('Enter a valid 10-digit Indian mobile number')).toBeTruthy();
    expect(screen.getByText('Password is required')).toBeTruthy();
    expect(mockApi.login).not.toHaveBeenCalled();
  });

  it('stores the session token in secure storage on success', async () => {
    mockApi.login.mockResolvedValue({ user, token: 'tok-123', expiresAt: '2026-12-01T00:00:00Z' });
    await renderWithSession(<LoginScreen />);
    await fireEvent.changeText(screen.getByTestId('phone'), '98765 43210');
    await fireEvent.changeText(screen.getByTestId('password'), 'Resident123');
    await act(async () => await fireEvent.press(screen.getByTestId('submit-login')));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(mockApi.login).toHaveBeenCalledWith({ phone: '98765 43210', password: 'Resident123' });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('krevia.session.token', 'tok-123', expect.any(Object));
  });

  it('shows the server error for wrong credentials and stays signed out', async () => {
    mockApi.login.mockRejectedValue(new ApiClientError(401, 'UNAUTHENTICATED', 'Incorrect mobile number or password.'));
    await renderWithSession(<LoginScreen />);
    await fireEvent.changeText(screen.getByTestId('phone'), '9876543210');
    await fireEvent.changeText(screen.getByTestId('password'), 'Wrong12345');
    await act(async () => await fireEvent.press(screen.getByTestId('submit-login')));
    expect(await screen.findByText('Incorrect mobile number or password.')).toBeTruthy();
    expect(store.size).toBe(0);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('shows a network error and recovers on the next attempt', async () => {
    mockApi.login
      .mockRejectedValueOnce(new ApiClientError(0, 'NETWORK', 'Unable to reach Krevia. Check your internet connection and try again.'))
      .mockResolvedValueOnce({ user, token: 'tok-2', expiresAt: '2026-12-01T00:00:00Z' });
    await renderWithSession(<LoginScreen />);
    await fireEvent.changeText(screen.getByTestId('phone'), '9876543210');
    await fireEvent.changeText(screen.getByTestId('password'), 'Resident123');
    await act(async () => await fireEvent.press(screen.getByTestId('submit-login')));
    expect(await screen.findByText(/Unable to reach Krevia/)).toBeTruthy();
    await act(async () => await fireEvent.press(screen.getByTestId('submit-login')));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
  });
});

describe('Registration form', () => {
  it('shows field errors for every invalid field', async () => {
    await renderWithSession(<RegisterScreen />);
    await fireEvent.changeText(screen.getByTestId('fullName'), 'A');
    await fireEvent.changeText(screen.getByTestId('phone'), '5123456789');
    await fireEvent.changeText(screen.getByTestId('email'), 'nope');
    await fireEvent.changeText(screen.getByTestId('password'), 'abcdefgh');
    await fireEvent.press(screen.getByTestId('submit-register'));
    expect(await screen.findByText('Full name must be at least 2 characters')).toBeTruthy();
    expect(screen.getByText('Enter a valid 10-digit Indian mobile number')).toBeTruthy();
    expect(screen.getByText('Enter a valid email address')).toBeTruthy();
    expect(screen.getByText('Password must contain a number')).toBeTruthy();
    expect(mockApi.register).not.toHaveBeenCalled();
  });

  it('shows the server conflict for a duplicate number', async () => {
    mockApi.register.mockRejectedValue(
      new ApiClientError(409, 'CONFLICT', 'An account with this mobile number already exists. Please sign in.'),
    );
    await renderWithSession(<RegisterScreen />);
    await fireEvent.changeText(screen.getByTestId('fullName'), 'Asha Rao');
    await fireEvent.changeText(screen.getByTestId('phone'), '9876543210');
    await fireEvent.changeText(screen.getByTestId('password'), 'Resident123');
    await act(async () => await fireEvent.press(screen.getByTestId('submit-register')));
    expect(await screen.findByText(/already exists/)).toBeTruthy();
  });

  it('goes to society search after successful registration', async () => {
    mockApi.register.mockResolvedValue({ user, token: 'tok-new', expiresAt: '2026-12-01T00:00:00Z' });
    await renderWithSession(<RegisterScreen />);
    await fireEvent.changeText(screen.getByTestId('fullName'), 'Asha Rao');
    await fireEvent.changeText(screen.getByTestId('phone'), '9876543210');
    await fireEvent.changeText(screen.getByTestId('password'), 'Resident123');
    await act(async () => await fireEvent.press(screen.getByTestId('submit-register')));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/join/search'));
  });
});
