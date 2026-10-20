/** Shared expo-router stand-ins (no imports, so it is safe to require from jest.setup.js). */
export const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissAll: jest.fn() };
export const mockParams: { current: Record<string, string> } = { current: {} };
