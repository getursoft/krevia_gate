/** Unit tests for the website's plain TypeScript modules (UI flows are covered by Playwright). */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/lib/**/*.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs', esModuleInterop: true, strict: true, jsx: 'react-jsx' } }],
  },
};
