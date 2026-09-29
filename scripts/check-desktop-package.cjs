'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'release', 'desktop');
const version = require('../package.json').version;
const archive = path.join(output, 'win-unpacked/resources/app.asar');
const names = asar.listPackage(archive).map(name => name.split(String.fromCharCode(92)).join('/').replace(/^\//, ''));
const roots = new Set(['desktop', 'dist', 'installer', 'public', 'docs', 'README.md', 'package.json']);
for (const name of names) {
  assert(roots.has(name.split('/')[0]), `Unexpected packaged file: ${name}`);
  assert(!/(?:^|\/)(?:backups|output|node_modules|_chillpass-data|\.env|\.git)(?:\/|$)/.test(name), `Private/build data: ${name}`);
}
for (const name of ['desktop/main.cjs', 'desktop/preload.cjs', 'installer/app.cjs', 'installer/data-storage.cjs', 'README.md', 'docs/desktop.md', 'dist/index.html']) {
  assert(names.includes(name), `Missing runtime file: ${name}`);
}
const metadata = JSON.parse(asar.extractFile(archive, 'package.json'));
assert.equal(metadata.version, version);
assert.equal(metadata.main, 'desktop/main.cjs');
const installer = path.join(output, `ChillPass-Setup-${version}.exe`);
const bytes = fs.readFileSync(installer);
assert.equal(bytes.subarray(0, 2).toString(), 'MZ');
console.log(`PASS package whitelist, runtime files and version ${version}; ${names.length} entries`);
console.log(`Installer: ${installer} (${(bytes.length / 1024 / 1024).toFixed(1)} MiB)`);
console.log(`SHA256: ${createHash('sha256').update(bytes).digest('hex')}`);
