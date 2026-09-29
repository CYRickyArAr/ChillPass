// Exercise the real prompt builders without network, personal data or paid model calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'src/services/deepseek.ts'), 'utf8');
const ast = ts.createSourceFile('deepseek.ts', service, ts.ScriptTarget.Latest, true);
const names = ['chatWithAthena', 'summarizeAthenaInsights'];
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(functions.length, 2);
let chatRequest, memoryRequest;
let modelReply = { newMemories: ['喜欢先看示例'], newAbilities: [{ name: '不应收录', description: '旧格式模型输出' }] };
const context = {
  exports: {},
  buildUserContent: (message, images) => ({ message, images }),
  callDeepSeekStream: async function* (messages, options) { chatRequest = { messages, options }; yield '测试回答'; },
  callDeepSeek: async messages => { memoryRequest = messages; return JSON.stringify(modelReply); },
  trackOperation: async (_kind, _label, task) => task(() => {}),
};
vm.runInNewContext(ts.transpileModule(functions.map(node => node.getText(ast)).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
(async () => {
  const images = ['test-image'];
  let reply = '';
  for await (const chunk of context.exports.chatWithAthena('问题', '课件内容', [], ['回答规则'], ['用户偏好'], images, { model: 'test-model', thinkingMode: 'high' })) reply += chunk;
  assert.equal(reply, '测试回答');
  const system = chatRequest.messages[0].content;
  for (const expected of ['课件内容', '回答规则', '用户偏好']) assert(system.includes(expected));
  assert(!/技能|abilities|ability/i.test(system));
  assert.equal(chatRequest.messages.at(-1).content.images, images);
  assert.equal(chatRequest.options.model, 'test-model');
  const result = await context.exports.summarizeAthenaInsights('问题', '回答');
  assert.equal(JSON.stringify(result), JSON.stringify({ newMemories: ['喜欢先看示例'] }));
  assert(!/newAbilities|已存在的技能|新发现的技能/.test(JSON.stringify(memoryRequest)));
  modelReply = { newMemories: {} };
  assert.equal(JSON.stringify(await context.exports.summarizeAthenaInsights('问题', '回答')), '{"newMemories":[]}');
  const ui = fs.readFileSync(path.join(root, 'src/pages/AIChatPage.tsx'), 'utf8');
  assert(!/AbilityPanel|addAutoAbility|newAbilities|abilityList|athena\.abilities|s\.abilities/.test(ui));
  assert(ui.includes('function MemoryPanel('));
  console.log('PASS skill UI removed, no skills in chat or extraction prompts, old skill output ignored, memory/options/images preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });
