// generate-twa.mjs — Programmatically generate TWA project using @bubblewrap/core
import { createRequire } from 'module';
import { resolve } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';

const require = createRequire('/opt/homebrew/lib/node_modules/@bubblewrap/cli/');
const { TwaManifest } = require('@bubblewrap/core/dist/lib/TwaManifest');
const { TwaGenerator } = require('@bubblewrap/core/dist/lib/TwaGenerator');
const { ConsoleLog } = require('@bubblewrap/core/dist/lib/Log');

const TARGET_DIR = resolve('./twa-output');
const log = new ConsoleLog('generate-twa');

async function main() {

  // Define the TWA manifest
  const manifestJson = {
    packageId: 'com.shalomapp.twa',
    host: 'shalomapp.in',
    name: 'Shalom Church App',
    launcherName: 'Shalom',
    display: 'standalone',
    themeColor: '#2E2A5A',
    themeColorDark: '#1a1840',
    navigationColor: '#2E2A5A',
    navigationColorDark: '#1a1840',
    navigationDividerColor: '#2E2A5A',
    navigationDividerColorDark: '#1a1840',
    backgroundColor: '#ffffff',
    enableNotifications: true,
    startUrl: '/',
    iconUrl: 'https://shalomapp.in/icon-512.png',
    maskableIconUrl: 'https://shalomapp.in/icon-512.png',
    splashScreenFadeOutDuration: 300,
    signingKey: {
      path: './android.keystore',
      alias: 'shalom',
    },
    appVersionCode: 1,
    appVersionName: '1.0.0',
    shortcuts: [],
    generatorApp: 'bubblewrap-cli',
    webManifestUrl: 'https://shalomapp.in/manifest.json',
    fallbackType: 'customtabs',
    features: {
      locationDelegation: { enabled: false },
      playBilling: { enabled: false },
    },
    alphaDependencies: { enabled: false },
    enableSiteSettingsShortcut: true,
    isChromeOSOnly: false,
    isMetaQuest: false,
    orientation: 'portrait',
    fingerprints: [],
  };

  console.log('\n=== Creating TWA Manifest ===');
  const twaManifest = new TwaManifest(manifestJson);

  // Generate the TWA project
  console.log('\n=== Generating TWA Project ===');
  const generator = new TwaGenerator();
  await generator.createTwaProject(TARGET_DIR, twaManifest, log, (progress, total) => {
    process.stdout.write(`\r  Progress: ${progress}/${total}`);
  });
  console.log('\n  Project generated!');

  // Save twa-manifest.json for future bubblewrap build commands
  const twaManifestPath = resolve(TARGET_DIR, 'twa-manifest.json');
  writeFileSync(twaManifestPath, JSON.stringify(twaManifest.toJson(), null, 2));
  console.log('  Saved twa-manifest.json');

  console.log('\n=== Next: Build AAB ===');
  console.log('cd twa-output && bubblewrap build');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
