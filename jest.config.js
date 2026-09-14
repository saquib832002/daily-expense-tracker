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
  // The i18n tests read the JSON files and the screens as plain text, so they
  // need no React Native runtime either — and they are the only guard that a
  // string added in English reaches Hindi, Urdu and Arabic before a user does.
  roots: ['<rootDir>/src/domain', '<rootDir>/src/i18n'],
};
