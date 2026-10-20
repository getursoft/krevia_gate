/** @type {import('jest').Config} */
const project = (displayName, testMatch) => ({
  displayName,
  testMatch,
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata', '<rootDir>/test/setup-env.ts'],
});

module.exports = {
  projects: [
    project('unit', ['<rootDir>/src/**/*.spec.ts']),
    project('integration', ['<rootDir>/test/**/*.e2e-spec.ts']),
  ],
};
