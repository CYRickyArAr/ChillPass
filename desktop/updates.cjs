'use strict';
const RELEASES_URL = 'https://api.github.com/repos/CYRickyArAr/ChillPass/releases/latest';
function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value || '');
  return match ? match.slice(1).map(Number) : null;
}
function selectUpdate(release, currentVersion) {
  if (release?.draft || release?.prerelease) return null;
  const remote = parseVersion(release?.tag_name), local = parseVersion(currentVersion);
  if (!remote || !local) return null;
  const index = remote.findIndex((part, i) => part !== local[i]);
  if (index < 0 || remote[index] <= local[index]) return null;
  const asset = release.assets?.find(item => /^ChillPass-Setup-.*\.exe$/i.test(item.name)
    && typeof item.browser_download_url === 'string'
    && item.browser_download_url.startsWith('https://github.com/CYRickyArAr/ChillPass/releases/download/'));
  if (!asset) return null; // Source-only releases are not desktop upgrades.
  return {
    version: remote.join('.'), currentVersion, downloadUrl: asset.browser_download_url,
    releaseNotes: String(release.body || ''), releaseDate: String(release.published_at || ''),
  };
}
async function checkForUpdates(currentVersion) {
  const response = await fetch(RELEASES_URL, {
    headers: { 'User-Agent': `ChillPass-Desktop/${currentVersion}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  return selectUpdate(await response.json(), currentVersion);
}
module.exports = { checkForUpdates, selectUpdate };
