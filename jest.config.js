/**
 * Tests for the pure domain layer only — money maths, budget pacing, merchant
 * normalization. These need no React Native runtime, so they run fast in plain
 * Node and there is no transform pipeline to break.
 *
 * Component and screen tests arrive in Phase 2 with jest-expo.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/domain'],
};
