// Isolated, headless DOM test. No screenshots, personal profile or network requests.
// Requires Playwright with Chromium (as do the existing browser smoke checks).
const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')
const { chromium } = require('playwright')

async function main() {
  const root = path.resolve(__dirname, '..')
  const bundle = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, contents: `
      import 'katex/contrib/copy-tex';
      import { renderInlineMarkdown, renderMarkdown } from './src/utils/markdown';
      window.mathFixture = { renderInlineMarkdown, renderMarkdown };
    ` },
    bundle: true, format: 'iife', platform: 'browser', write: false,
    plugins: [{ name: 'isolated-language', setup(b) {
      b.onResolve({ filter: /languageStore$/ }, () => ({ path: 'language', namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useLanguageStore = { getState: () => ({ language: "zh" }) };' }))
    } }],
  })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => route.abort())
    await page.setContent('<div id="content"></div><textarea id="input"></textarea>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const result = await page.evaluate(() => {
      const content = document.getElementById('content')
      function copy(markdown, partial = false, block = false) {
        content.innerHTML = block
          ? window.mathFixture.renderMarkdown(markdown)
          : window.mathFixture.renderInlineMarkdown(markdown)
        const range = document.createRange()
        if (partial) {
          const node = content.querySelector('.katex-html .mord').firstChild
          range.setStart(node, 0)
          range.setEnd(node, 1)
        } else range.selectNodeContents(content)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        const clipboardData = new DataTransfer()
        const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData })
        content.dispatchEvent(event)
        return { text: clipboardData.getData('text/plain'), handled: event.defaultPrevented }
      }
      const single = copy('$C=2B\\log_{2}M$')
      const mixed = copy('奈奎斯特公式 C=2Blog₂M 适用于理想信道')
      const partial = copy('$C=2B\\log_{2}M$', true)
      const display = copy('$$\\frac{S}{N}=10^{30/10}$$', false, true)
      const ordinary = copy('普通文字不改变复制行为')
      const input = document.getElementById('input')
      input.value = single.text
      return { single, mixed, partial, display, ordinary, pasted: input.value }
    })
    assert.equal(result.single.text, '$C=2B\\log_{2}M$')
    assert.equal(result.mixed.text, '奈奎斯特公式 $C=2B\\log_{2}M$ 适用于理想信道')
    assert.equal(result.partial.text, result.single.text)
    assert.equal(result.display.text.trim(), '$$\\frac{S}{N}=10^{30/10}$$')
    assert.equal(result.ordinary.handled, false)
    assert.equal(result.pasted, result.single.text)
    console.log('PASS: full/partial formulas, mixed prose, display math, plaintext input and ordinary copy behavior')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
