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

  /**
   * `@noble/ciphers` and `@noble/hashes` — the encryption behind
   * `domain/vault` — ship as ES modules only. Metro handles that natively, so
   * the app is unaffected; Jest runs as CommonJS and cannot `require` them.
   *
   * By default Jest transforms nothing in node_modules, which is the right
   * default and the reason the whole suite stays fast. The negative lookahead
   * carves out exactly those two packages and nothing else.
   */
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {}],
    '^.+\\.m?js$': [
      'babel-jest',
      { presets: [['@babel/preset-env', { targets: { node: 'current' } }]], babelrc: false, configFile: false },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!@noble/)'],
};
