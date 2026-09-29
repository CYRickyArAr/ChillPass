const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const courseState = { currentCourseId: 'B', courses: [{ course: { id: 'A', name: '课程甲' }, rawText: '甲课件' }, { course: { id: 'B', name: '课程乙' }, rawText: '乙课件' }] };
const disk = new Map();
const legacy = [
  { id: 'one', title: '旧甲', messages: [{ role: 'user', content: '旧问题', courseId: 'A', images: ['image'] }], createdAt: 1, updatedAt: 2 },
  { id: 'mixed', title: '混合', messages: [{ role: 'user', content: '甲', courseId: 'A' }, { role: 'assistant', content: '乙', courseId: 'B' }], createdAt: 1, updatedAt: 2 },
  { id: 'unknown', title: '不能按标题猜测归属', messages: [{ role: 'user', content: '问题' }], createdAt: 1, updatedAt: 2 },
];
disk.set('chillpass-chat', JSON.stringify({ version: 1, state: { conversations: legacy, currentId: 'one' } }));
disk.set('athena-storage', JSON.stringify({ state: { memories: [{ id: 'old', type: 'flow', content: '不该共享的旧全局记忆' }], abilities: [] }, version: 0 }));
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const context = { exports: {}, console, require: id => {
    if (id.endsWith('/courseStore')) return { useCourseStore: { getState: () => courseState } };
    if (id.endsWith('/learningDataStorage')) return { learningDataStorage: { getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value), removeItem: key => disk.delete(key) } };
    if (id.endsWith('/athenaStore')) return load('src/stores/athenaStore.ts');
    if (id.endsWith('/athenaText')) return load('src/utils/athenaText.ts');
    return require(id);
  } };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, context); cache.set(file, context.exports); return context.exports;
}
const { useChatStore, migrateChat } = load('src/stores/chatStore.ts');
const store = () => useChatStore.getState();
const get = id => store().conversations.find(c => c.id === id);
assert.equal(get('one').courseId, 'A');
assert.equal(get('mixed').courseId, null);
assert.equal(get('unknown').courseId, null);
assert.equal(JSON.stringify(get('one').messages), JSON.stringify(legacy[0].messages));
assert(!JSON.stringify(store().conversations).includes('不该共享的旧全局记忆'));
assert.equal(JSON.parse(disk.get('chillpass-chat')).version, 2);
assert.equal(migrateChat({ messages: legacy[0].messages }).conversations[0].courseId, 'A');
const a1 = store().createConversation('A'), a2 = store().createConversation('A'), b = store().createConversation('B');
store().addMemory(a1, 'charter', '甲一规则');
store().addAutoMemory(a1, { content: '甲一自动记忆' });
store().addAutoMemory(a1, { content: '甲一自动记忆' });
assert.equal(get(a1).memories.length, get(a2).memories.length + 2);
assert(!JSON.stringify(get(a2).memories).includes('甲一'));
assert(!JSON.stringify(get(b).memories).includes('甲一'));
store().switchConversation(a1);
store().addMessage('user', '甲一消息', 'B');
assert.equal(get(a1).messages.at(-1).courseId, 'A');
courseState.currentCourseId = 'B';
assert.equal(get(a1).courseId, 'A');
store().switchConversation(b);
store().addAutoMemory(a1, '异步迟到的甲一记忆');
assert(get(a1).memories.some(m => m.content === '异步迟到的甲一记忆'));
assert(!get(b).memories.some(m => m.content === '异步迟到的甲一记忆'));
const bBefore = JSON.stringify(get(b));
store().importMemories(a2, { memories: [{ type: 'flow', content: { text: '导入只影响甲二' } }] });
assert.equal(JSON.stringify(get(b)), bBefore);
assert.throws(() => store().importMemories(a2, { memories: [null] }));
assert.equal(store().exportMemories(a2).memories.length, 1);
store().clearFlowMemories(a1);
assert(get(a1).memories.some(m => m.content === '甲一规则'));
assert(get(a2).memories.some(m => m.type === 'flow'));
store().deleteConversation(a1);
store().addAutoMemory(a1, '删除后迟到');
assert(!get(a1));
assert(!JSON.stringify(store().conversations).includes('删除后迟到'));
const general = store().createConversation(null);
store().addMessage('user', '通用问题', 'B');
assert.equal(get(general).courseId, null);
assert.equal(get(general).messages[0].courseId, undefined);
const saved = JSON.stringify(store().conversations);
useChatStore.persist.rehydrate();
assert.equal(JSON.stringify(store().conversations), saved);
assert(JSON.stringify(disk.get('athena-storage')).includes('不该共享的旧全局记忆'));
console.log('PASS v0/v1 migration, immutable course ownership, per-session memory CRUD/import/export, delayed callbacks, deleted targets, archive and reload persistence');
