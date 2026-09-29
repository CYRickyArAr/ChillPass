// Isolated browser fixture; clipboard APIs are mocked, so the user's clipboard is untouched.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/code-copy-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><input id="focus"><main id="fixture"></main></body></html>' }));
    await page.goto('http://localhost:5174/code-copy-test');
    const code = 'PA:\n    while (true) {\n\tP(empty);  // 保留中文、空格与制表符\n    if (a < b && b > 0) print("<script>not executable</script>");\n    }';
    await page.evaluate(async code => {
      const md = await import('/src/utils/markdown.ts');
      const { setupCodeCopy } = await import('/src/utils/codeCopy.ts');
      window.renderCodeTest = md.renderMarkdown;
      window.cleanupCodeCopy = setupCodeCopy();
      window.copies = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => window.copies.push(text) } });
      document.querySelector('#fixture').innerHTML = md.renderMarkdown('```c\n' + code + '\n```\n\n`inline`\n\n```python\nprint("second")\n```');
    }, code);
    assert.equal(await page.locator('button[data-code-copy]').count(), 2);
    assert.equal(await page.locator('#fixture script').count(), 0);
    await page.getByRole('button', { name: '复制代码', exact: true }).first().click();
    await page.getByText('已复制', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.copies[0]), code);
    await page.getByRole('button', { name: '复制代码', exact: true }).nth(1).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.copies[1]), 'print("second")');
    // Simulate a new completed streaming block and permission-denied fallback.
    await page.evaluate(() => {
      document.querySelector('#fixture').innerHTML = window.renderCodeTest('```\nnew block\n```');
      navigator.clipboard.writeText = async () => { throw Error('denied'); };
      document.execCommand = command => { window.copies.push(document.activeElement.value); return command === 'copy'; };
    });
    await page.getByRole('button', { name: '复制代码', exact: true }).click();
    await page.getByText('已复制', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.copies.at(-1)), 'new block');
    assert.equal(await page.locator('textarea').count(), 0);
    await page.evaluate(() => { document.execCommand = () => false; });
    await page.getByRole('button', { name: '复制代码', exact: true }).click();
    await page.getByText('复制失败，请手动选择', { exact: true }).waitFor();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="10">中文</text></svg>';
    await page.evaluate(svg => { document.querySelector('#fixture').innerHTML = window.renderCodeTest('```svg\n' + svg + '\n```'); }, svg);
    await page.locator('summary').click();
    assert.equal(await page.locator('button[data-code-copy]').count(), 1);
    assert.equal(await page.locator('.chillpassCodeBlock > pre > code').textContent(), svg);
    await page.evaluate(() => window.cleanupCodeCopy());
    assert.deepEqual(errors, []);
    console.log('PASS sanitized code buttons, exact whitespace/Unicode/text, independent blocks, keyboard, dynamic blocks, fallback/failure and SVG source; real clipboard untouched');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
