// Browser-only integration against Vite. All API/model requests intercepted; no real data/API keys.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const origin = process.env.CHILLPASS_TEST_URL || 'http://localhost:5174';
const makeCourse = (id, name, text) => ({ course: { id, name, files: [], status: 'ready', createdAt: 1, updatedAt: 1 }, rawText: text, lessons: [], examPoints: [], progress: { totalLessons: 0, completedLessons: 0, currentStreak: 0 }, generatingLessons: false, preparationProgress: { stage: 'idle', current: 0, total: 0 } });
const wrap = (state, version) => JSON.stringify({ state, version });
const entries = {
  'chillpass-course-v2': { value: wrap({ courses: [makeCourse('A', '课程甲', 'COURSE_A_ONLY'), makeCourse('B', '课程乙', 'COURSE_B_ONLY'), makeCourse('C', '课程丙', 'COURSE_C_ONLY')], currentCourseId: 'B' }, 2), revision: '1' },
  'chillpass-chat': { value: wrap({ currentId: 'legacy', conversations: [{ id: 'legacy', title: '甲的历史会话', messages: [{ id: 'm1', role: 'user', content: '甲历史', courseId: 'A' }], createdAt: 1, updatedAt: 1 }, { id: 'orphan', title: '已删课程的旧会话', messages: [{ id: 'm2', role: 'user', content: '旧会话', courseId: 'GONE' }], createdAt: 1, updatedAt: 1 }] }, 1), revision: '1' },
  'athena-storage': { value: wrap({ memories: [{ id: 'old', type: 'flow', content: 'OLD_GLOBAL_PRIVATE' }], abilities: [], model: '', thinkingMode: 'off' }, 0), revision: '1' },
};
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const requests = [], errors = [];
    let releaseSummary;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.endsWith('/chat/completions')) {
        const body = request.postDataJSON(); requests.push(body);
        const summary = body.messages[0].content.includes('newMemories');
        if (summary) await new Promise(resolve => { releaseSummary = resolve; });
        const content = summary ? JSON.stringify({ newMemories: ['ASYNC_MEMORY_FOR_A_ONLY'] }) : '隔离测试回答';
        return route.fulfill({ contentType: 'text/event-stream', body: 'data: '+JSON.stringify({ choices: [{ delta: { content } }] })+'\n\ndata: [DONE]\n\n' });
      }
      if (url.origin === origin && url.pathname === '/api/learningData') {
        if (request.method() === 'GET') return route.fulfill({ json: { root: 'isolated-test', entries } });
        const body = request.postDataJSON();
        if (body.backup) return route.fulfill({ json: { ok: true } });
        if ((entries[body.key]?.revision ?? null) !== body.expectedRevision) return route.fulfill({ status: 409, json: { error: 'test revision conflict' } });
        const entry = { value: body.value, revision: String(Number(entries[body.key]?.revision || 0) + 1) };
        entries[body.key] = entry;
        return route.fulfill({ json: entry });
      }
      if (url.origin === origin && url.pathname.startsWith('/api/')) return route.fulfill({ json: { path: 'isolated-test', version: '0.2.1', available: false } });
      if (url.origin === origin) return route.continue();
      return route.fulfill({ status: 200, json: {} });
    });
    await context.addInitScript(() => {
      if (!localStorage.getItem('chillpass-onboarding')) {
        localStorage.setItem('chillpass-onboarding', JSON.stringify({ version: 0, state: { stage: 'done', forceWelcome: false } }));
        localStorage.setItem('chillpass-settings', JSON.stringify({ version: 7, state: { storageLocationConfirmed: true, provider: 'deepseek', providerConnections: { deepseek: { apiKey: 'isolated-fake-key', baseUrl: 'https://api.deepseek.com' } }, model: 'deepseek-chat' } }));
      }
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/#/chat');
    await page.getByTitle('记忆管理', { exact: true }).waitFor();
    await page.getByText('基于「课程甲」课件', { exact: true }).waitFor();
    await page.getByTitle('记忆管理', { exact: true }).click();
    await page.locator('textarea[class*="panelTextarea"]').fill('MEMORY_A_ONLY');
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await page.locator('button[class*="modalClose"]').click();
    await page.getByText('基于「课程甲」课件', { exact: true }).waitFor();
    await page.locator('textarea').fill('验证所属课程和独立记忆');
    await page.locator('textarea').press('Enter');
    await page.waitForFunction(() => !document.querySelector('textarea').disabled);
    for (let i = 0; i < 100 && !releaseSummary; i++) await page.waitForTimeout(100);
    if (!releaseSummary) console.log('DEBUG', errors, requests, await page.evaluate(() => JSON.parse(localStorage.getItem('chillpass-chat')).state.conversations));
    assert(releaseSummary, 'Background memory extraction started');
    const sent = requests.find(request => request.stream);
    assert(sent);
    assert(sent.messages[0].content.includes('COURSE_A_ONLY'));
    assert(sent.messages[0].content.includes('MEMORY_A_ONLY'));
    assert(!sent.messages[0].content.includes('COURSE_B_ONLY'));
    assert(!sent.messages[0].content.includes('OLD_GLOBAL_PRIVATE'));
    await page.getByTitle('会话', { exact: true }).click();
    // 分组标题可见：课程名 + 会话计数 + 每课程独立的新建按钮
    const groupA = page.getByRole('region', { name: '会话分组：课程甲' });
    await groupA.waitFor();
    await page.getByRole('button', { name: '在「课程甲」中新建会话', exact: true }).waitFor();
    assert(await page.getByText('记忆与课件仅限本组会话', { exact: true }).count() >= 2);
    // 课程被删除后，旧会话仍可见并标注，不借用其他课程课件。
    const orphanGroup = page.getByRole('region', { name: '会话分组：原课程（课程已删除）' });
    await orphanGroup.getByText('已删课程的旧会话', { exact: true }).waitFor();
    // 空课程不报错，提供明确的“新会话”入口而不是空白。
    const groupC = page.getByRole('region', { name: '会话分组：课程丙' });
    await groupC.getByRole('button', { name: '新会话', exact: true }).click();
    await page.getByText('基于「课程丙」课件', { exact: true }).waitFor();
    const courseC = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('chillpass-chat')).state; return s.conversations.find(c => c.id === localStorage.getItem('chillpass-chat-current')); });
    assert.equal(courseC.courseId, 'C');
    // 重新打开：当前分组高亮、当前会话带标记，且会话按最近更新排序。
    await page.getByTitle('会话', { exact: true }).click();
    assert.equal(await page.locator('[data-active-group="true"]').getAttribute('aria-label'), '会话分组：课程丙');
    assert.equal(await page.getByLabel('当前会话', { exact: true }).count(), 1);
    // 层级可辨识：分组标题在自己的底色块上、加粗、带计数，会话条目右缩进且次要文字更小。
    const groupHeader = groupA.locator('[class*="convGroupHeader"]').first();
    const convTitle = groupA.locator('[class*="convItemTitle"]').first();
    const convMeta = groupA.locator('[class*="convItemMeta"]').first();
    assert(await groupHeader.boundingBox() && await convTitle.boundingBox());
    assert((await convTitle.boundingBox()).x > (await groupHeader.boundingBox()).x, '会话应相对分组标题缩进');
    assert(parseInt(await groupA.locator('[class*="convGroupName"]').first().evaluate(node => getComputedStyle(node).fontWeight), 10) >= 700);
    assert(await groupA.locator('[class*="convGroupCount"]').count() === 1);
    assert(parseFloat(await convMeta.evaluate(node => getComputedStyle(node).fontSize)) < parseFloat(await convTitle.evaluate(node => getComputedStyle(node).fontSize)));
    assert.notEqual(await groupA.evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
    // 菜单保持打开，直接点另一个课程分组的新建按钮。
    await page.getByRole('button', { name: '在「课程乙」中新建会话', exact: true }).click();
    await page.getByText('基于「课程乙」课件', { exact: true }).waitFor();
    releaseSummary();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('chillpass-chat')).state.conversations.find(c => c.id === 'legacy').memories.some(m => m.content === 'ASYNC_MEMORY_FOR_A_ONLY'));
    const state = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('chillpass-chat')).state;
      const id = localStorage.getItem('chillpass-chat-current');
      return { id, current: s.conversations.find(c => c.id === id) };
    });
    assert.equal(state.current.courseId, 'B');
    assert(!JSON.stringify(state.current.memories).includes('MEMORY_A_ONLY'));
    assert(!JSON.stringify(state.current.memories).includes('ASYNC_MEMORY_FOR_A_ONLY'));
    await page.getByTitle('记忆管理', { exact: true }).click();
    await page.getByText(/仅当前会话使用这些记忆/).waitFor();
    assert.equal(await page.getByText('MEMORY_A_ONLY', { exact: true }).count(), 0);
    await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('chillpass-disk-pending:')));
    await page.reload();
    await page.locator('#reload-snapshot').waitFor({ state: 'detached' });
    await page.getByText('基于「课程乙」课件', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('chillpass-chat-current')), state.id);
    assert.deepEqual(errors, []);
    console.log('PASS browser groups/new session, course-pinned actual requests, independent memories, delayed summary ownership and reload persistence');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
