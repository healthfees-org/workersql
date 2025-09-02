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
  // Temporarily disable setup to avoid Miniflare issues
  // setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/sdk/'],
  coveragePathIgnorePatterns: ['/node_modules/', '/sdk/'],
};
