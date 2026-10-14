const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/services/modelPreferences.ts'), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exportsObject });
const { enabledModelIds, preferredEnabledModel } = exportsObject;

test('legacy connections keep all models; an explicit empty preference disables all', () => {
  assert.equal(enabledModelIds(['a', 'b', 'a', '']).join(','), 'a,b');
  assert.equal(enabledModelIds(['a', 'b'], []).length, 0);
  assert.throws(() => preferredEnabledModel({ enabledModels: [] }, 'a'), /全部关闭/);
  assert.equal(preferredEnabledModel({ model: 'a' }, 'b'), 'b');
});
test('model menus and requests honor enabled models without reviving stale entries', () => {
  assert.equal(enabledModelIds(['a', 'b'], ['b', 'removed']).join(','), 'b');
  assert.equal(preferredEnabledModel({ model: 'b', enabledModels: ['b', 'c'] }, 'a'), 'b');
  assert.equal(preferredEnabledModel({ model: 'b', enabledModels: ['b', 'c'] }, 'c'), 'c');
  assert.equal(preferredEnabledModel({ model: 'removed', enabledModels: ['b'] }, ''), 'b');
});
