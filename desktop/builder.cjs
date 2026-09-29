'use strict';
module.exports = {
  appId: 'com.chillpass.desktop',
  productName: 'ChillPass',
  directories: { output: 'release/desktop' },
  // Explicit allowlist: never package output/, backups/, personal courseware or profiles.
  files: [
    'desktop/*.cjs', 'dist/**/*', 'installer/app.cjs', 'installer/data-storage.cjs',
    'public/icon.ico', 'package.json', 'README.md', 'docs/desktop.md',
    '!node_modules/**/*', '!desktop/builder.cjs',
  ],
  asar: true,
  npmRebuild: false,
  electronLanguages: ['en-US', 'zh-CN'],
  electronFuses: { runAsNode: false, enableNodeOptionsEnvironmentVariable: false },
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'public/icon.ico', artifactName: 'ChillPass-Setup-${version}.exe' },
  nsis: {
    oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: 'always', createStartMenuShortcut: true,
    shortcutName: 'ChillPass', deleteAppDataOnUninstall: false,
    installerLanguages: ['zh_CN', 'en_US'],
  },
  publish: null,
};
