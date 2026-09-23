const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const localVersion = require('../package.json').version
const nextVersion = version => version.replace(/\d+$/, patch => String(Number(patch) + 1))

const source = fs.readFileSync('src/utils/electronMock.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const sourceZip = 'https://github.com/CYRickyArAr/ChillPass/archive/refs/heads/master.zip'

function createApi(fetchImpl) {
  const sandbox = {
    exports: {},
    require(id) {
      if (id === '../../package.json') return { default: { version: localVersion } }
      if (id === '@services/browserFileStore') return {}
      if (id === '../i18n') return { translate: (_, key) => key }
      if (id === '@stores/languageStore') return { useLanguageStore: { getState: () => ({ language: 'zh' }) } }
      throw new Error(`Unexpected module: ${id}`)
    },
    window: {}, fetch: fetchImpl, AbortSignal, TextDecoder, Uint8Array, atob,
  }
  vm.runInNewContext(compiled, sandbox, { filename: 'electronMock.js' })
  sandbox.exports.setupElectronMock()
  return sandbox.window.electronAPI
}

async function main() {
  const backendUpdate = createApi(async () => ({
    ok: true,
    json: async () => ({ updateAvailable: true, latestVersion: nextVersion(localVersion), currentVersion: localVersion }),
  }))
  const info = await backendUpdate.checkForUpdates()
  assert.equal(info.version, nextVersion(localVersion))
  assert.equal(info.downloadUrl, sourceZip)

  const sameVersion = createApi(async () => ({ ok: true, json: async () => ({ updateAvailable: false }) }))
  assert.equal(await sameVersion.checkForUpdates(), null)

  const calls = []
  const fallback = createApi(async url => {
    calls.push(url)
    if (url === '/api/checkForUpdates') throw new Error('Local endpoint unavailable')
    return {
      ok: true,
      json: async () => ({ encoding: 'base64', content: Buffer.from(JSON.stringify({ version: nextVersion(localVersion) })).toString('base64') }),
    }
  })
  assert.equal((await fallback.checkForUpdates()).version, nextVersion(localVersion))
  assert(calls[1].includes('/contents/package.json?ref=master'))

  const offline = createApi(async () => { throw new Error('Offline') })
  await assert.rejects(() => offline.checkForUpdates(), /updateServerUnreachable/)

  console.log('PASS source update available, up-to-date, browser fallback, and offline cases')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
