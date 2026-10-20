/* Regression: the API URL resolver crashed on device when a config source was not a string. */
jest.unmock('../src/lib/api');

describe('resolveApiUrl', () => {
  const load = (extra: unknown, env?: unknown) => {
    jest.resetModules();
    jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra } } }));
    if (env === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = env as string;
    // Fresh require after resetModules so API_URL is re-evaluated with the mocked config.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../src/lib/config') as typeof import('../src/lib/config');
  };

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_API_URL;
  });

  it('falls back to the simulator default when nothing is configured', () => {
    expect(load({ apiUrl: null }).API_URL).toBe('http://localhost:4100');
  });

  it('ignores non-string config values instead of crashing', () => {
    expect(load({ apiUrl: { value: 'x' } }).API_URL).toBe('http://localhost:4100');
    expect(load(undefined).API_URL).toBe('http://localhost:4100');
  });

  it('uses the configured URL without trailing slashes', () => {
    expect(load({ apiUrl: 'https://api.krevia.example/' }).API_URL).toBe('https://api.krevia.example');
    expect(load({ apiUrl: null }, 'https://env.krevia.example//').API_URL).toBe('https://env.krevia.example');
  });
});
