const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture() {
  const exports = {};
  const create = () => factory => {
    let state;
    const store = { getState: () => state, setState: patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; } };
    state = factory(store.setState);
    return store;
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/stores/settingsStore.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: id => id === 'zustand' ? { create } : id === 'zustand/middleware' ? { persist: factory => factory } : { normalizeModelId: id => id },
  });
  return exports;
}

test('all builtin and custom providers can be removed and explicitly re-added', () => {
  const { useSettingsStore: store, getVisibleProviderIds: visible, BUILTIN_PROVIDER_IDS } = fixture();
  const custom = store.getState().addCustomProvider();
  for (const id of [...BUILTIN_PROVIDER_IDS, custom]) {
    store.getState().addProvider(id);
    store.getState().setProviderConnection(id, { apiKey: 'fixture-key', model: 'fixture-model' });
    assert.ok(visible().includes(id));
    store.getState().removeProvider(id);
    assert.ok(!visible().includes(id));
    assert.equal(store.getState().providerConnections[id], undefined);
    store.getState().addProvider(id);
    assert.ok(visible().includes(id));
    assert.equal(store.getState().providerConnections[id]?.apiKey, undefined);
  }
  assert.equal(store.getState().apiKey, '');
  assert.equal(store.getState().zhipuApiKey, '');
});

test('deleting active provider stops new AI calls without switching billing; re-add does not reactivate', () => {
  const { useSettingsStore: store } = fixture();
  store.getState().setProvider('chatgpt');
  store.getState().removeProvider('chatgpt');
  assert.equal(store.getState().provider, 'chatgpt');
  assert.equal(store.getState().providerDisabled, true);
  assert.equal(store.getState().model, '');
  store.getState().addProvider('chatgpt');
  assert.equal(store.getState().providerDisabled, true);
  store.getState().setProvider('chatgpt');
  assert.equal(store.getState().providerDisabled, false);
});

test('background OAuth catalog updates do not resurrect deleted ChatGPT; inactive removal leaves active unchanged', () => {
  const { useSettingsStore: store, getVisibleProviderIds: visible } = fixture();
  const previous = store.getState().model;
  store.getState().removeProvider('chatgpt');
  store.getState().setProviderConnection('chatgpt', { model: 'catalog-model', availableModels: ['catalog-model'] });
  assert.ok(!visible().includes('chatgpt'));
  assert.equal(store.getState().providerDisabled, false);
  assert.equal(store.getState().provider, 'deepseek');
  assert.equal(store.getState().model, previous);
});
