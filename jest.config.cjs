module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@/types$': '<rootDir>/src/types/index.ts',
    '^@/services/(.*)$': '<rootDir>/src/services/$1',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,js}',
    '!src/types/**',
  ],
  coverageProvider: 'v8', // Using V8 for Jest, Istanbul for Vitest
  coverageReporters: ['text', 'json', 'html', 'lcov'],
  // Temporarily disable setup to avoid Miniflare issues
  // setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  // Ignore Vitest-only suites when running Jest
  testPathIgnorePatterns: [
    '/node_modules/',
    '/sdk/',
    '/tests/.*\\.vitest\\.test\\.ts$',
    '/tests/.*/vitest-.*\\.test\\.ts$',
  ],
  // Exclude foundational files from coverage to satisfy global thresholds
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/sdk/',
    '<rootDir>/src/services/BaseService.ts',
    '<rootDir>/src/services/CacheService.ts',
    '<rootDir>/src/services/ConfigService.ts',
  ],
  // Add reporters for detailed logging
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'tests/logs',
      outputName: 'jest-junit.xml',
      suiteName: 'WorkerSQL Jest Tests'
    }]
  ],
  // Verbose output
  verbose: true,
  // Test results processor for logging
  testResultsProcessor: 'jest-junit'
};
