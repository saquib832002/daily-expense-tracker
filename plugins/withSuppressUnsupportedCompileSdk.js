const { withGradleProperties } = require('expo/config-plugins');

/**
 * Let this project compile against an SDK its build tools do not know about.
 *
 * React Native 0.76 pins Android Gradle Plugin 8.6, which recognises
 * compileSdk up to 35. Google Play requires **target API 36** for new apps as
 * of 31 August 2026, and a targetSdk above the compileSdk is not allowed — so
 * compileSdk has to move to 36 as well, and AGP 8.6 refuses to build against a
 * platform it was not shipped knowing about.
 *
 * This flag is AGP's own escape hatch for exactly this situation: the build
 * proceeds, and you accept that the tooling cannot warn you about API 36
 * behaviour it has never heard of.
 *
 * DELETE THIS the moment the project moves to an Expo SDK whose bundled AGP
 * knows about 36 by itself. A suppression that is no longer true is worse than
 * no suppression, because it silences warnings you would then want to read.
 */
const KEY = 'android.suppressUnsupportedCompileSdk';

module.exports = function withSuppressUnsupportedCompileSdk(config, { sdkVersion = 36 } = {}) {
  return withGradleProperties(config, (cfg) => {
    // Written by hand rather than appended blindly, so re-running prebuild
    // cannot leave two copies of the same property fighting each other.
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === 'property' && item.key === KEY),
    );
    cfg.modResults.push({ type: 'property', key: KEY, value: String(sdkVersion) });
    return cfg;
  });
};
