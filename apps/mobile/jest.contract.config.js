/** Contract tests run in plain Node against a live API — no React Native, no mocks. */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/contract/**/*.contract.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', esModuleInterop: true, strict: true, types: ['jest', 'node'] } }] },
};
