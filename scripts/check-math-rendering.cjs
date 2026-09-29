// Exercise the Markdown/KaTeX pipeline without a browser, user data or AI requests.
// DOMPurify is stubbed here: these checks cover math recognition, not sanitization.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const katex = require('katex')
const formulas = []
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/markdown.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const sandbox = {
  exports: {},
  require(id) {
    if (id === 'marked') return require('marked')
    if (id === 'dompurify') return { default: { sanitize: html => html } }
    if (id === 'katex') return { default: { renderToString(math, options) {
      formulas.push(math)
      return katex.renderToString(math, { ...options, throwOnError: true })
    } } }
    if (id.includes('translations')) return { translate: (_, key) => key }
    if (id.includes('languageStore')) return { useLanguageStore: { getState: () => ({ language: 'zh' }) } }
    throw new Error(`Unexpected dependency: ${id}`)
  },
}
vm.runInNewContext(compiled, sandbox)
const { renderInlineMarkdown, renderMarkdown } = sandbox.exports
function expectFormula(input, expected) {
  formulas.length = 0
  const html = renderInlineMarkdown(input)
  assert.equal(formulas.length, 1, input)
  assert.equal(formulas[0], expected, input)
  assert(html.includes('class="katex"'), `KaTeX failed: ${input}`)
  assert(!html.includes('katex-error'), input)
}
expectFormula('奈奎斯特公式 C=2Blog₂M 适用于理想无噪声信道', 'C=2B\\log_{2}M')
expectFormula('香农公式C=Blog₂(1+S/N)适用于有噪声信道', 'C=B\\log_{2}(1+S/N)')
expectFormula('分贝换算：(S/N)dB=10log₁₀(S/N)，', '(S/N)dB=10\\log_{10}(S/N)')
expectFormula('故 S/N=10^((S/N)dB/10)', '\\frac{S}{N}=10^{(S/N)dB/10}')
expectFormula('代入得 C=B·log₂(1001)≈B·9.97，因此约20Mbps。', 'C=B\\cdot \\log_{2}(1001)\\approx B\\cdot 9.97')
expectFormula('能量E=mc²。', 'E=mc^{2}')
expectFormula('$a/b+c$', 'a/b+c')
expectFormula('$C=B\\log_{2}(1+\\frac{S}{N})$', 'C=B\\log_{2}(1+\\frac{S}{N})')
expectFormula('softmax(s[i])=exp(s[i])', '\\operatorname{softmax}(s_{i})=\\exp(s_{i})')
for (const text of ['带宽2 MHz，速率20 Mbps，单位 b/s (bps)', 'API Base URL', '`C=2Blog₂M`', '```js\nconst x = 10; // $x$\n```']) {
  formulas.length = 0
  renderMarkdown(text)
  assert.equal(formulas.length, 0, `Unexpected formula: ${text}`)
}
console.log('PASS: channel-capacity formulas, Unicode scripts, grouped exponents, explicit LaTeX, code and units')
