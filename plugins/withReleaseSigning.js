const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Sign release builds with a real release key instead of the debug key.
 *
 * The React Native template ships this, and it is a trap:
 *
 *     release {
 *         // Caution! In production, you need to generate your own keystore file.
 *         signingConfig signingConfigs.debug
 *     }
 *
 * So `gradlew bundleRelease` produces a *release* build signed with the
 * *debug* key — a file that builds cleanly, installs cleanly, runs cleanly, and
 * is rejected by Play with "You uploaded an APK or Android App Bundle that was
 * signed in debug mode." Nothing before the upload tells you.
 *
 * This plugin rewrites that. It is a config plugin rather than an edit to
 * `android/app/build.gradle` because `expo prebuild --clean` deletes the whole
 * android directory and writes it again from the template — any edit made by
 * hand there survives exactly until the next prebuild, which is the sort of fix
 * that fails months later with no explanation.
 *
 * ## Where the secrets live
 *
 * `keystore.properties` at the **project root** — beside package.json, NOT
 * inside android/, which prebuild deletes. Four lines:
 *
 *     storeFile=C:\\Najmus\\keys\\expense-tracker-upload.jks
 *     storePassword=...
 *     keyAlias=upload
 *     keyPassword=...
 *
 * `storeFile` may be absolute (recommended — keep the key outside the
 * repository entirely) or relative to the project root. The file is already in
 * .gitignore, along with *.jks and *.keystore. Committing any of them would put
 * the signing identity of the app into a public repository permanently.
 *
 * ## When the file is absent
 *
 * Debug builds carry on working — `expo run:android`, the dev client, all of
 * it. Only `bundleRelease` and `assembleRelease` fail, loudly, saying what is
 * missing. That is deliberate: the failure this plugin exists to prevent was
 * silent, and replacing it with another silent fallback would be no fix at all.
 */
const LOADER = `
// ---------------------------------------------------------------- signing --
// Injected by plugins/withReleaseSigning.js. Do not edit here; prebuild
// overwrites this file.
def releaseKeystorePropsFile = new File(rootProject.projectDir.parentFile, 'keystore.properties')
def releaseKeystoreProps = new Properties()
if (releaseKeystorePropsFile.exists()) {
    releaseKeystorePropsFile.withInputStream { releaseKeystoreProps.load(it) }
}
// Existence of the file is not enough — a template with the password line
// still blank would otherwise read as "configured" and fail deep inside the
// signing task with a message about nothing in particular.
def releaseKeystoreMissing = ['storeFile', 'storePassword', 'keyAlias', 'keyPassword'].findAll {
    !releaseKeystoreProps[it]?.toString()?.trim()
}
def hasReleaseKeystore = releaseKeystorePropsFile.exists() && releaseKeystoreMissing.isEmpty()
def resolveKeystoreFile = { String p ->
    def f = new File(p)
    f.isAbsolute() ? f : new File(rootProject.projectDir.parentFile, p)
}
// -------------------------------------------------------------------------
`;

const TEMPLATE_SIGNING_CONFIGS = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

const NEW_SIGNING_CONFIGS = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        if (hasReleaseKeystore) {
            release {
                storeFile resolveKeystoreFile(releaseKeystoreProps['storeFile'] as String)
                storePassword releaseKeystoreProps['storePassword'] as String
                keyAlias releaseKeystoreProps['keyAlias'] as String
                keyPassword releaseKeystoreProps['keyPassword'] as String
            }
        }
    }`;

const TEMPLATE_RELEASE_SIGNING = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

const NEW_RELEASE_SIGNING = `            // Signed with the release key from keystore.properties when it is
            // present. See plugins/withReleaseSigning.js.
            signingConfig hasReleaseKeystore ? signingConfigs.release : signingConfigs.debug`;

const GUARD = `

// Fail the release build rather than quietly producing a debug-signed bundle
// that Play will reject after the upload. Scoped to the two release packaging
// tasks, so every other task — debug builds, the dev client, tests — is
// untouched when the keystore is not configured.
tasks.configureEach { task ->
    if (!hasReleaseKeystore && (task.name == 'bundleRelease' || task.name == 'assembleRelease')) {
        task.doFirst {
            // Parenthesised deliberately: in Groovy a newline ends a statement
            // that is already complete, so \`def x = cond\` followed by a line
            // starting with \`?\` is a syntax error. The open paren keeps it one
            // expression.
            def why = (!releaseKeystorePropsFile.exists()
                ? "  File not found: " + releaseKeystorePropsFile.absolutePath
                : "  Blank or missing in keystore.properties: " + releaseKeystoreMissing.join(', '))
            throw new GradleException(
                "Release signing is not configured.\\n\\n" +
                why + "\\n\\n" +
                "  keystore.properties, in the project root, needs all four:\\n" +
                "    storeFile=keys/expense-tracker-upload.jks\\n" +
                "    storePassword=...\\n" +
                "    keyAlias=upload\\n" +
                "    keyPassword=...\\n\\n" +
                "Without them this task would produce a debug-signed bundle and Play\\n" +
                "would refuse the upload. See plugins/withReleaseSigning.js."
            )
        }
    }
}
`;

/** Marker used to make a second application of this plugin a no-op. */
const MARKER = 'def hasReleaseKeystore';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        'withReleaseSigning: app/build.gradle is not Groovy. Expo changed the ' +
          'template; this plugin needs updating rather than skipping.',
      );
    }

    let src = cfg.modResults.contents;

    // Idempotent: prebuild normally regenerates from the template, but
    // `prebuild` without --clean can hand back a file we already edited.
    if (src.includes(MARKER)) return cfg;

    // Every replacement below is anchored on exact template text. If Expo
    // changes that text, the right outcome is a loud failure at prebuild time
    // — not a silently unsigned build discovered at the Play upload.
    const steps = [
      ['signingConfigs block', TEMPLATE_SIGNING_CONFIGS, NEW_SIGNING_CONFIGS],
      ['release signingConfig', TEMPLATE_RELEASE_SIGNING, NEW_RELEASE_SIGNING],
    ];

    for (const [what, from, to] of steps) {
      if (!src.includes(from)) {
        throw new Error(
          `withReleaseSigning: could not find the ${what} in app/build.gradle. ` +
            'The Expo template has changed — update plugins/withReleaseSigning.js ' +
            'to match it. Refusing to continue, because carrying on would produce ' +
            'a debug-signed release build.',
        );
      }
      src = src.replace(from, to);
    }

    // The loader must be above `android { }`, which is the first thing that
    // uses it.
    const androidBlock = src.indexOf('\nandroid {');
    if (androidBlock === -1) {
      throw new Error('withReleaseSigning: no top-level `android {` block found.');
    }
    src = src.slice(0, androidBlock) + '\n' + LOADER + src.slice(androidBlock);

    cfg.modResults.contents = src + GUARD;
    return cfg;
  });
};
