/* In-memory stand-ins for native modules and navigation that are unavailable under Jest. */
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k) => void store.delete(k)),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    __store: store,
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => () => {}),
  fetch: jest.fn(async () => ({ isConnected: true })),
}));

jest.mock('expo-router', () => {
  const { mockRouter, mockParams } = require('./__tests__/router-mock');
  return { useRouter: () => mockRouter, useLocalSearchParams: () => mockParams.current, Redirect: () => null };
});

/* The API client is replaced by jest.fn()s; tests set per-case responses. */
jest.mock('./src/lib/api', () => ({
  setApiToken: jest.fn(),
  onApiUnauthenticated: jest.fn(),
  api: {
    login: jest.fn(),
    register: jest.fn(),
    logout: jest.fn(),
    me: jest.fn(),
    updateProfile: jest.fn(),
    searchSocieties: jest.fn(),
    getSociety: jest.fn(),
    createMembershipRequest: jest.fn(),
    myMembership: jest.fn(),
    cancelMembershipRequest: jest.fn(),
    societyOverview: jest.fn(),
    societyMembershipRequests: jest.fn(),
    approveMembershipRequest: jest.fn(),
    rejectMembershipRequest: jest.fn(),
    adminSocieties: jest.fn(),
  },
}));
