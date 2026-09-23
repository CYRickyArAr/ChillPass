/* Deterministic regression checks. Mock credentials, in-memory storage, no network or user data. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { build } = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { StaticRouter } = require('react-router-dom/server')

async function main() {
  const root = path.resolve(__dirname, '..')
  const storage = new Map()
  global.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  }
  // Minimal asynchronous IndexedDB fixture. The production checkpoint adapter is bundled unchanged.
  const checkpointRecords = new Map()
  let rejectCheckpointWrites = false
  const database = {
    objectStoreNames: { contains: () => true }, close() {},
    transaction() {
      const transaction = { objectStore: () => ({
        get(key) {
          const request = {}
          setTimeout(() => { request.result = structuredClone(checkpointRecords.get(key)); transaction.oncomplete?.() }, 0)
          return request
        },
        put(value) {
          setTimeout(() => {
            if (rejectCheckpointWrites) { transaction.error = new Error('Mock storage full'); transaction.onabort?.(); return }
            checkpointRecords.set(value.key, structuredClone(value))
            transaction.oncomplete?.()
          }, 0)
          return {}
        },
        clear() {
          setTimeout(() => { checkpointRecords.clear(); transaction.oncomplete?.() }, 0)
          return {}
        },
      }) }
      return transaction
    },
  }
  global.indexedDB = { open() {
    const request = {}
    setTimeout(() => { request.result = database; request.onsuccess?.() }, 0)
    return request
  } }
  // Provider settings are fakes. The real course store is tested only against in-memory localStorage.
  const compiled = await build({
    absWorkingDir: root,
    stdin: { contents: `
      export * from './src/services/deepseek';
      export * from './src/services/fileParser';
      export * from './src/stores/operationProgressStore';
      export * from './src/i18n/translations';
      export * from './src/components/common/OperationProgress';
      export { default as OperationProgressCenter } from './src/components/common/OperationProgress';
      export * from './src/services/lessonGenerator';
      export * from './src/services/courseTextSources';
      export * from './src/services/extractionCheckpoint';
      export * from './src/utils/readyLessons';
      export * from './src/utils/generationRecovery';
      export { default as ReadyLessonNotice } from './src/components/common/ReadyLessonNotice';
      export * from './src/services/lessonPlanning';
      export * from './src/services/lessonPedagogy';
      export * from './src/services/aiScheduling';
      export * from './src/services/aiResponse';
      export * from './src/services/lessonEconomy';
      export * from './src/services/lessonOutputBudget';
      export { default as LessonCostEstimate } from './src/components/common/LessonCostEstimate';
      export * from './src/services/courseOptimizer';
      export * from './src/stores/quizProgressStore';
      export { default as LessonPlanCard } from './src/components/common/LessonPlanCard';
      export { useCourseStore as realCourseStore } from './src/stores/courseStore';
      export { useSettingsStore as realSettingsStore } from './src/stores/settingsStore';
    `, resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['react', 'react/jsx-runtime', 'react-dom/server', 'react-router-dom', 'zustand', 'zustand/middleware'],
    plugins: [{ name: 'isolated-fixtures', setup(b) {
      b.onResolve({ filter: /@stores\/(settingsStore|tokenStore|languageStore|courseStore)$/ }, args => ({ path: args.path, namespace: 'mock' }))
      b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => {
        if (name.endsWith('settingsStore')) return { contents: `const getState = () => ({ provider:'deepseek', apiKey:'test-key-not-real', zhipuApiKey:'', model:'test-model', fastResponses:true, economyLessons:false, ...globalThis.fixtureAiSettings }); export const useSettingsStore = Object.assign(select => select(getState()), { getState }); export const getProviderConnection = () => ({ baseUrl:'https://api.deepseek.com', apiKey:'test-key-not-real' })` }
        if (name.endsWith('tokenStore')) return { contents: `export const useTokenStore = { getState: () => ({ recordUsage() {} }) }` }
        if (name.endsWith('courseStore')) return { contents: `export const useCourseStore = Object.assign(select => select(globalThis.fixtureCourseState), { getState: () => globalThis.fixtureCourseState })` }
        return { contents: `export const useLanguageStore = Object.assign(select => select({ language:'zh' }), { getState: () => ({ language:'zh' }) })` }
      })
      b.onResolve({ filter: /\.module\.css$/ }, args => ({ path: args.path, namespace: 'css' }))
      b.onLoad({ filter: /.*/, namespace: 'css' }, () => ({ contents: 'export default {}' }))
      b.onResolve({ filter: /^pdfjs-dist/ }, args => ({ path: args.path, namespace: 'pdf' }))
      b.onLoad({ filter: /.*/, namespace: 'pdf' }, ({ path: name }) => ({ contents: name.includes('?url')
        ? `export default 'mock-worker'`
        : `export const GlobalWorkerOptions = {}; export const getDocument = () => ({ promise: Promise.resolve({ numPages:3, getPage:async i => ({ getTextContent:async () => ({ items:[{str:'page '+i}] }) }) }) })` }))
    } }],
  })
  const loaded = new Module(path.join(root, 'scripts', 'progress-fixture.cjs'), module)
  loaded.filename = path.join(root, 'scripts', 'progress-fixture.cjs')
  loaded.paths = Module._nodeModulePaths(root)
  loaded._compile(compiled.outputFiles[0].text, loaded.filename)
  const api = loaded.exports
  const store = api.useOperationProgressStore
  global.fixtureCourseState = { courses: [] }
  global.fetch = () => { throw new Error('Unexpected request: live network is disabled in this test') }
  const latest = () => store.getState().items[0]
  const reset = () => { store.setState({ items: [], expanded: true }); checkpointRecords.clear(); rejectCheckpointWrites = false }
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 500; attempt++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)) }
    throw new Error('Expected async operation did not start')
  }
  const completion = value => new Response(JSON.stringify({ choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } })
  // Explicit valid generation fixtures; never decorate malformed responses under test.
  const designedQuestion = question => ({ objective: 'Apply the concept under the stated conditions', taskKind: 'Scenario analysis', gradingCriteria: ['Explain the mechanism and justify the result'], ...question })
  const designedLesson = lesson => ({
    keyPoints: ['Point'], examples: [],
    learningDesign: { discipline: 'Fixture subject', objectives: ['Apply the concept under the stated conditions'], approach: 'Analyze a concrete scenario', rationale: 'The material teaches a conditional mechanism' },
    ...lesson,
    quiz: lesson.quiz.map(question => ({ ...designedQuestion(question), objectiveIndex: 0 })),
  })
  const points = title => [{ title, priority: 'must', description: 'test point', keyFormulas: [], pageRefs: [] }]
  const seen = []
  const unsubscribe = store.subscribe(state => seen.push(structuredClone(state.items)))
  let passed = 0
  async function test(name, fn) {
    if (process.argv[2] && !name.includes(process.argv[2])) return
    reset(); seen.length = 0
    await fn()
    passed++
    console.log(`PASS ${name}`)
  }

  await test('request scheduler reserves interactive capacity, prioritizes it and cancels queued work', async () => {
    const scheduler = new api.AiRequestScheduler()
    const releases = await Promise.all(Array.from({ length: 4 }, () => scheduler.acquire('background')))
    let backgroundStarted = false
    let releaseBackground
    const background = scheduler.acquire('background').then(release => { backgroundStarted = true; releaseBackground = release })
    const releaseChat = await scheduler.acquire('interactive')
    const releaseGrade = await scheduler.acquire('interactive')
    assert.equal(backgroundStarted, false, 'four background calls cannot consume the reserved slots')
    let interactiveStarted = false
    let releaseInteractive
    const interactive = scheduler.acquire('interactive').then(release => { interactiveStarted = true; releaseInteractive = release })
    releases[0]()
    await interactive
    assert.equal(interactiveStarted, true)
    assert.equal(backgroundStarted, false, 'interactive queue outranks background queue')
    releaseChat()
    await background
    const controller = new AbortController()
    const cancelled = scheduler.acquire('background', controller.signal).then(() => { throw new Error('Cancelled queued request started') }, error => error)
    controller.abort()
    assert.equal((await cancelled).name, 'AbortError')
    releases.forEach(release => release())
    releaseGrade(); releaseInteractive(); releaseBackground()
    const releaseAfter = await scheduler.acquire('background')
    releaseAfter(); releaseAfter() // release is idempotent
    const delayAbort = new AbortController()
    const delayed = api.abortableDelay(60000, delayAbort.signal)
    delayAbort.abort()
    await assert.rejects(delayed, { name: 'AbortError' })
  })

  await test('worker pool starts independent work before a slow first task and returns source order', async () => {
    const releases = []
    const started = []
    const task = api.mapConcurrent([0, 1, 2, 3, 4, 5], 4, async value => {
      started.push(value)
      await new Promise(resolve => { releases[value] = resolve })
      return value * 2
    })
    try {
      await waitFor(() => started.length === 4)
      assert.deepEqual(started, [0, 1, 2, 3])
      releases[2]()
      await waitFor(() => started.length === 5)
      releases[4]()
      await waitFor(() => started.length === 6)
    } finally { releases.forEach(release => release?.()) }
    assert.deepEqual(await task, [0, 2, 4, 6, 8, 10])
  })

  await test('fast mode is explicit for generation and summaries, configurable and preserves the chosen model', async () => {
    const bodies = []
    global.fetch = async (_url, options) => {
      bodies.push(JSON.parse(options.body))
      return completion({ newAbilities: [], newMemories: [] })
    }
    await api.summarizeAthenaInsights('question', 'reply', [])
    assert.equal(bodies[0].model, 'test-model')
    assert.deepEqual(bodies[0].thinking, { type: 'disabled' })
    assert.equal(bodies[0].stream, true)
    global.fixtureAiSettings = { fastResponses: false }
    await api.summarizeAthenaInsights('question', 'reply', [])
    assert.deepEqual(bodies[1].thinking, { type: 'enabled' })
    global.fixtureAiSettings = { provider: 'zhipu', zhipuApiKey: 'mock-zhipu', fastResponses: true }
    await api.summarizeAthenaInsights('question', 'reply', [])
    assert.equal(bodies[2].thinking, undefined, 'do not send unsupported switches to another provider')
    global.fixtureAiSettings = undefined
    assert.equal(api.realSettingsStore.getState().fastResponses, true)
    api.realSettingsStore.getState().setFastResponses(false)
    await api.realSettingsStore.persist.rehydrate()
    assert.equal(api.realSettingsStore.getState().fastResponses, false)
    api.realSettingsStore.getState().setFastResponses(true)
  })

  await test('stream parser handles byte boundaries, CRLF, usage-only events and a final event without newline', async () => {
    const bytes = new TextEncoder().encode(': keepalive\r\ndata:{"choices":[{"delta":{"content":"中文"}}]}\r\n\r\ndata: {"choices":[],"usage":{"total_tokens":9}}')
    const response = new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
      controller.close()
    } }), { headers: { 'content-type': 'text/event-stream' } })
    const events = []
    for await (const event of api.readAiEvents(response)) events.push(event)
    assert.equal(events[0].choices[0].delta.content, '中文')
    assert.equal(events[1].usage.total_tokens, 9)
  })

  await test('generation receives streamed progress but never saves partial JSON', async () => {
    const content = designedLesson({ explanation: 'A complete explanation', quiz: [{ type: 'short', question: 'Apply the idea', answer: 'Answer', explanation: 'Why' }] })
    const text = JSON.stringify(content)
    let endResponse
    let requestBody
    global.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(0, 35) } }] })}\n\n`))
        endResponse = () => {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(35) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`))
          controller.close()
        }
      } }), { headers: { 'content-type': 'text/event-stream' } })
    }
    let settled = false
    const task = api.generateLessonContent({ id: 'stream-lesson', title: 'Point', description: 'Source', priority: 'must' }, 'source').then(result => { settled = true; return result })
    try {
      await waitFor(() => latest().stage === 'receiving')
      assert.equal(latest().receivedChars, 35)
      assert.equal(settled, false)
      assert.equal(requestBody.thinking.type, 'disabled')
    } finally { endResponse?.() }
    assert.equal((await task).explanation, 'A complete explanation')
    assert.equal(latest().stage, 'done')
  })

  await test('transient HTTP failure retries, and cancellation interrupts Retry-After without another request', async () => {
    let requests = 0
    global.fetch = async () => ++requests === 1 ? new Response('Busy', { status: 503, headers: { 'retry-after': '0' } }) : completion(points('Recovered'))
    await api.extractExamPointsFromSources([{ sourceFile: 'transient.pdf', text: 'source' }], 'Transient')
    assert.equal(requests, 2)
    const controller = new AbortController()
    requests = 0
    global.fetch = async () => { requests++; return new Response('Rate limited', { status: 429, headers: { 'retry-after': '60' } }) }
    const cancelled = api.extractExamPointsFromSources([{ sourceFile: 'backoff.pdf', text: 'source' }], 'Backoff', controller.signal)
    await waitFor(() => latest().stage === 'retrying')
    controller.abort()
    await assert.rejects(cancelled, { name: 'AbortError' })
    assert.equal(requests, 1)
  })

  await test('multi-file extraction reports real section counts and finishes after validation', async () => {
    const input = [{ sourceFile: 'a.pdf', text: 'a'.repeat(16001) }, { sourceFile: 'b.pdf', text: 'b' }]
    let release
    let requests = 0
    global.fetch = async () => {
      const n = requests++
      if (!n) await new Promise(resolve => { release = resolve })
      return completion(points(['进程控制', '虚拟地址', '文件目录', '信号处理'][n]))
    }
    const patches = []
    const task = api.extractExamPointsFromSources(input, 'Test course', undefined, patch => patches.push(patch))
    try {
      await waitFor(() => release && requests === 4 && latest().current === 3)
      assert.equal(latest().stage, 'extracting')
      assert.equal(latest().total, 4)
    } finally { release?.() }
    const result = await task
    assert.equal(result.length, 4)
    assert.equal(requests, 4)
    assert.equal(latest().stage, 'done')
    assert.equal(latest().current, 4)
    assert(patches.some(p => p.fileIndex === 2))
    assert.equal(latest().fileTotal, 2)
    assert(patches.some(p => p.chunkIndex === 3))
    assert(patches.some(p => p.stage === 'validating'))
    assert(latest().finishedAt >= latest().startedAt)
  })

  await test('empty upstream response retries visibly before succeeding', async () => {
    let requests = 0
    global.fetch = async () => completion(++requests === 1 ? '' : points('网络协议'))
    await api.extractExamPointsFromSources([{ sourceFile: 'retry.pdf', text: 'test' }], 'Retry')
    assert.equal(requests, 2)
    assert(seen.some(items => items[0]?.stage === 'retrying'))
    assert.equal(latest().attempt, 2)
    assert.equal(latest().stage, 'done')
  })

  await test('invalid extraction is failed, never marked completed', async () => {
    global.fetch = async () => completion('not JSON')
    await assert.rejects(api.extractExamPointsFromSources([{ sourceFile: 'bad.pdf', text: 'test' }], 'Bad'), /格式异常/)
    assert.equal(latest().stage, 'failed')
    assert.equal(latest().current, 0)
    assert(!seen.some(items => items[0]?.stage === 'done'))
  })

  await test('cancelled extraction is not retried or reported successful', async () => {
    const controller = new AbortController()
    let requests = 0
    global.fetch = (_, options) => new Promise((resolve, reject) => {
      requests++
      options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))
    })
    const task = api.extractExamPointsFromSources([{ sourceFile: 'cancel.pdf', text: 'test' }], 'Cancel', controller.signal)
    await waitFor(() => requests > 0)
    controller.abort()
    await assert.rejects(task, { name: 'AbortError' })
    assert.equal(requests, 1)
    assert.equal(latest().stage, 'cancelled')
  })

  await test('unavailable grading and translation fallback are not false successes', async () => {
    global.fetch = async () => completion({ wrongField: true })
    const grade = await api.gradeAnswer('question', 'student answer', 'reference answer')
    assert.equal(grade.status, 'unavailable')
    assert.equal(latest().stage, 'failed')
    const questions = [{ id: 'q1', type: 'short', question: 'test', answer: 'ok' }]
    const translated = await api.translateExamQuestions(questions, 'en')
    assert.deepEqual(translated, questions)
    assert.equal(latest().stage, 'failed')
  })

  await test('streamed chat exposes waiting and received-character progress', async () => {
    global.fetch = async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"choices":[{"delta":{"content":"世界"}}]}\n\ndata: [DONE]\n\n'))
      controller.close()
    } }))
    let answer = ''
    for await (const chunk of api.callDeepSeekStream([{ role: 'user', content: 'test' }])) answer += chunk
    assert.equal(answer, '你好世界')
    assert.equal(latest().receivedChars, 4)
    assert.equal(latest().stage, 'done')
    assert(seen.some(items => items[0]?.stage === 'waiting'))
    assert(seen.some(items => items[0]?.stage === 'receiving'))
    global.fetch = async () => new Response('data: [DONE]\n\n')
    await assert.rejects(async () => { for await (const chunk of api.callDeepSeekStream([])) void chunk }, /空/)
    assert.equal(latest().stage, 'failed')
  })

  await test('PDF parsing reports individual pages', async () => {
    global.electronAPI = { readFileBuffer: async () => new ArrayBuffer(0) }
    const text = await api.parseFile('test.pdf', '.pdf')
    assert(text.includes('page 3'))
    assert.equal(latest().current, 3)
    assert.equal(latest().total, 3)
    assert.equal(latest().unit, 'pages')
    assert.equal(latest().stage, 'done')
    assert(seen.some(items => items[0]?.current === 1))
  })

  await test('lesson and single-question validation retries remain visible', async () => {
    let requests = 0
    const quiz = designedQuestion({ type: 'short', question: 'Test question', answer: 'Test answer', explanation: 'Test explanation' })
    global.fetch = async () => completion(++requests === 1 ? {} : designedLesson({ keyPoints: ['Test point'], explanation: 'Test lesson', examples: [], quiz: [quiz] }))
    const result = await api.generateLessonContent({ id: 'p1', title: 'Test point', priority: 'must', description: 'test' }, 'test course')
    assert.equal(result.quiz.length, 1)
    assert.equal(latest().stage, 'done')
    assert.equal(latest().validationRetry, 1)
    assert(seen.some(items => items[0]?.stage === 'retrying' && items[0]?.validationRetry === 1))
    requests = 0
    global.fetch = async () => completion(++requests === 1 ? { ...quiz, type: 'choice' } : quiz)
    await api.regenerateQuizQuestion('Test point', 'old question', 'short', 'text', 'q1')
    assert.equal(latest().kind, 'question')
    assert.equal(latest().stage, 'done')
    assert.equal(latest().validationRetry, 1)
  })

  await test('background generation counts failures separately and preserves completed lessons', async () => {
    const bundle = {
      course: { id: 'batch-course', name: 'Batch fixture' }, rawText: 'course text',
      lessons: [{ id: 'l0', examPointId: 'p0', content: { saved: true } }, { id: 'l1', title: 'fail', examPointId: 'p1' }, { id: 'l2', title: 'good', examPointId: 'p2' }],
      examPoints: [{ id: 'p1', title: 'fail', priority: 'must' }, { id: 'p2', title: 'good', priority: 'must' }],
    }
    global.fixtureCourseState = {
      courses: [bundle],
      setGenerationPaused(value) { bundle.generationPaused = value },
      setGeneratingLessons(value, progress) { bundle.generatingLessons = value; bundle.generationProgress = progress },
     setLessonContent(id, content) { bundle.lessons.find(lesson => lesson.id === id).content = content },
      setLessonGenerationError(id, error) { bundle.lessons.find(lesson => lesson.id === id).generationError = error },
    }
    let requests = 0
    global.fetch = async () => ++requests === 1
      ? new Response('Mock error', { status: 400 })
      : completion(designedLesson({ explanation: 'Valid lesson', quiz: [{ type: 'short', question: 'Q', answer: 'A', explanation: 'E' }] }))
    await api.generateAllLessonsInBackground('batch-course')
    const aggregate = store.getState().items.find(item => item.detail === 'Batch fixture')
    assert.equal(aggregate.current, 3)
    assert.equal(aggregate.total, 3)
    assert.equal(aggregate.failed, 1)
    assert.equal(aggregate.stage, 'failed')
    assert.equal(bundle.generationProgress.current, 2)
    assert.equal(bundle.generatingLessons, false)
    assert.deepEqual(bundle.lessons[0].content, { saved: true })
    assert(bundle.lessons[2].content)
    global.fixtureCourseState = { courses: [] }
  })

  await test('ready lesson recommendations skip unavailable content and preserve learning order', async () => {
    const content = { keyPoints: ['point'], explanation: 'lesson', examples: [], quiz: [] }
    const fixture = { lessons: [
      { id: 'waiting', order: 1, status: 'available' },
      { id: 'later', order: 4, status: 'available', content },
      { id: 'ready', order: 2, status: 'available', content },
      { id: 'failed', order: 3, status: 'available' },
    ] }
    const before = JSON.stringify(fixture)
    assert.equal(api.getReadyLessonState(fixture).nextLesson.id, 'ready')
    assert.equal(JSON.stringify(fixture), before, 'selection must not mutate lessons')
    fixture.lessons[2].status = 'completed'
    fixture.lessons[2].completedAt = 123
    assert.equal(api.getReadyLessonState(fixture).nextLesson.id, 'later')
    fixture.optimizationJob = { status: 'running', items: { later: { state: 'processing' } } }
    assert.equal(api.getReadyLessonState(fixture).nextLesson.id, 'ready', 'do not enter content currently being replaced')
    assert.equal(api.getReadyLessonState(fixture).readyLessons.length, 1)
    fixture.optimizationJob.status = 'completed'
    fixture.lessons[1].status = 'completed'
    fixture.lessons[1].completedAt = 456
    assert.equal(api.getReadyLessonState(fixture).nextLesson.id, 'later', 'allow review while waiting for more content')
    // Old courses may have completion status but no content; never offer them as ready.
    assert.equal(api.getReadyLessonState({ lessons: [{ id: 'legacy', status: 'completed', order: 1 }] }).nextLesson, undefined)
    assert.equal(api.getReadyLessonState(null).nextLesson, undefined)
  })

  await test('one ready lesson is immediately available even with progress collapsed or paused', async () => {
    const fixture = {
      course: { id: 'early-course', name: 'Early study', status: 'ready' },
      generatingLessons: true, generationProgress: { current: 47, total: 256 },
      lessons: [{ id: 'ready-one', order: 1, status: 'available' }, { id: 'pending-two', order: 2, status: 'available' }],
    }
    global.fixtureCourseState = { courses: [fixture], currentCourseId: fixture.course.id }
    store.setState({ expanded: false })
    // React SSR reads Zustand's initial snapshot, unlike the browser's live snapshot.
    store.getInitialState().expanded = false
    const renderCenter = () => renderToStaticMarkup(React.createElement(StaticRouter, { location: '/' }, React.createElement(api.OperationProgressCenter)))
    let html = renderCenter()
    assert(html.includes('已有 0/2 关可学习'))
    assert(html.includes('首个关卡生成完成后'))
    assert(!html.includes('href="/lessons/ready-one"'))
    fixture.lessons[0].content = { explanation: 'Ready' }
    html = renderCenter()
    assert(html.includes('已有 1/2 关可学习'), 'count real content, not processed requests')
    assert(html.includes('href="/lessons/ready-one"'))
    assert(html.includes('立即学习'))
    assert(html.includes('其余关卡继续在后台生成'))
    assert(!html.includes('href="/lessons/pending-two"'))
    assert(!html.includes('id="operation-progress-list"'), 'study link remains outside collapsed details')
    fixture.generatingLessons = false
    fixture.generationPaused = true
    fixture.lessons[0].status = 'completed'
    html = renderCenter()
    assert(html.includes('复习已生成关卡'))
    assert(html.includes('已生成的内容可以正常学习'))
    // A stale course task must not open a lesson under the newly selected course.
    global.fixtureCourseState.currentCourseId = 'another-course'
    html = renderCenter()
    assert(!html.includes('href="/lessons/ready-one"'))
    store.getInitialState().expanded = true
    global.fixtureCourseState = { courses: [] }
  })

  await test('first lesson is stored and playable while the next request waits; learning and refresh preserve it', async () => {
    const realStore = api.realCourseStore
    const bundle = {
      course: { id: 'live-course', name: 'Incremental fixture', status: 'ready', files: [] },
      rawText: 'source text', progress: { totalLessons: 2, completedLessons: 0, currentStreak: 0 },
      lessons: [1, 2].map(i => ({ id: `live-${i}`, examPointId: `p${i}`, order: i, status: 'available', title: `Point ${i}` })),
      examPoints: [1, 2].map(i => ({ id: `p${i}`, title: `Point ${i}`, priority: 'must' })),
    }
    realStore.setState({ courses: [bundle], currentCourseId: 'live-course' })
    Object.defineProperty(global, 'fixtureCourseState', { configurable: true, get: () => realStore.getState() })
    let releaseSecond
    let requests = 0
    global.fetch = async () => {
      const count = ++requests
      if (count === 2) await new Promise(resolve => { releaseSecond = resolve })
      return completion(designedLesson({ keyPoints: ['point'], explanation: `Ready lesson ${count}`, examples: [], quiz: [{ type: 'short', question: `Question ${count}`, answer: 'A', explanation: 'E' }] }))
    }
    const task = api.generateAllLessonsInBackground('live-course')
    try {
      await waitFor(() => releaseSecond && realStore.getState().courses[0].lessons[0].content)
      const current = () => realStore.getState().courses[0]
      assert.equal(current().generatingLessons, true)
      assert.equal(api.getReadyLessonState(current()).nextLesson.id, 'live-1')
      assert.equal(current().lessons[1].content, undefined)
      assert.equal(current().generationProgress.current, 1)
      assert(JSON.parse(storage.get('chillpass-course-v2')).state.courses[0].lessons[0].content)
      realStore.getState().completeLesson('live-1')
      const learned = structuredClone(current().lessons[0])
      await realStore.persist.rehydrate()
      assert.deepEqual(current().lessons[0], learned)
      assert.equal(current().lessons[0].content.learningDesign.approach, 'Analyze a concrete scenario')
      assert.deepEqual(current().lessons[0].content.quiz[0].gradingCriteria, ['Explain the mechanism and justify the result'])
      assert.equal(current().generatingLessons, true)
      assert.equal(api.getReadyLessonState(current()).readyLessons.length, 1)
      // Re-entry after route/course changes must not duplicate the active generation request.
      await api.generateAllLessonsInBackground('live-course')
      assert.equal(requests, 2)
      realStore.setState({ currentCourseId: null })
      releaseSecond()
      await task
      assert.equal(current().generatingLessons, false)
      assert.equal(current().generationProgress.current, 2)
      assert.equal(api.getReadyLessonState(current()).nextLesson.id, 'live-2')
      assert.deepEqual(current().lessons[0], learned, 'background writes must preserve study completion')
      await realStore.persist.rehydrate()
      assert.equal(current().progress.completedLessons, 1)
      assert.equal(api.getReadyLessonState(current()).readyLessons.length, 2)
    } finally {
      releaseSecond?.()
      await task
      Object.defineProperty(global, 'fixtureCourseState', { configurable: true, writable: true, value: { courses: [] } })
    }
  })

  await test('parallel optimization waits for the slow last worker and preserves old completions and backups', async () => {
    const realStore = api.realCourseStore
    const bundle = {
      course: { id: 'parallel-opt', name: 'Parallel optimization', status: 'ready', files: [] }, rawText: 'course source',
      generatingLessons: false, generationProgress: { current: 5, total: 5 }, progress: { totalLessons: 5, completedLessons: 2, currentStreak: 0 },
      lessons: Array.from({ length: 5 }, (_, i) => ({ id: `opt-${i}`, examPointId: `op-${i}`, order: i + 1, status: i < 2 ? 'completed' : 'available', title: `Topic ${i}`, content: { keyPoints: ['Old'], explanation: `Original ${i}`, examples: [], quiz: [] } })),
      examPoints: Array.from({ length: 5 }, (_, i) => ({ id: `op-${i}`, title: `Topic ${i}`, priority: 'must', description: 'Test objective' })),
    }
    realStore.setState({ courses: [bundle], currentCourseId: 'parallel-opt' })
    Object.defineProperty(global, 'fixtureCourseState', { configurable: true, get: () => realStore.getState() })
    const current = () => realStore.getState().courses[0]
    let calls = 0
    let releaseSlow
    global.fetch = async () => {
      const count = ++calls
      if (count === 1) await new Promise(resolve => { releaseSlow = resolve })
      return completion(designedLesson({ explanation: `Optimized ${count}`, quiz: [{ type: 'short', question: `Distinct task ${count}`, answer: 'A', explanation: 'E' }] }))
    }
    const id = realStore.getState().beginOptimization('parallel-opt', 'batch')
    realStore.getState().applyOptimizationScan('parallel-opt', id, [], false)
    api.resumeCourseOptimization('parallel-opt')
    try {
      await waitFor(() => calls === 5 && Object.values(current().optimizationJob.items).filter(item => item.state === 'done').length === 4)
      assert.equal(current().optimizationJob.status, 'running', 'no worker may mark a shared job complete while another is in flight')
      assert.equal(current().lessons[0].content.explanation, 'Original 0')
    } finally { releaseSlow?.() }
    await waitFor(() => current().optimizationJob.status === 'completed')
    assert.equal(current().optimizationJob.summary.success, 5)
    assert.equal(current().progress.completedLessons, 2)
    for (let i = 0; i < 5; i++) {
      assert.equal(current().lessons[i].id, `opt-${i}`)
      assert.equal(current().lessons[i].previousContent.explanation, `Original ${i}`)
      assert.equal(current().lessons[i].status, i < 2 ? 'completed' : 'available')
    }
    await realStore.persist.rehydrate()
    assert.equal(current().optimizationJob.summary.success, 5)
    // A second batch can cancel all in-flight workers without replacing their old versions.
    calls = 0
    let aborted = 0
    global.fetch = (_url, options) => new Promise((_resolve, reject) => {
      calls++
      options.signal.addEventListener('abort', () => { aborted++; reject(new DOMException('Cancelled', 'AbortError')) }, { once: true })
    })
    const saved = JSON.stringify(current().lessons)
    const secondId = realStore.getState().beginOptimization('parallel-opt', 'batch')
    realStore.getState().applyOptimizationScan('parallel-opt', secondId, [], false)
    api.resumeCourseOptimization('parallel-opt')
    try {
      await waitFor(() => calls === 4)
    } finally { api.cancelCourseOptimization('parallel-opt') }
    await waitFor(() => aborted === 4)
    assert.equal(current().optimizationJob.status, 'cancelled')
    assert.equal(JSON.stringify(current().lessons), saved)
    assert.equal(calls, 4)
    Object.defineProperty(global, 'fixtureCourseState', { configurable: true, writable: true, value: { courses: [] } })
  })

  await test('background lesson cancellation keeps completed work and only resumes unfinished lessons', async () => {
    const bundle = {
      course: { id: 'cancel-batch', name: 'Cancel fixture' }, rawText: 'course source',
      lessons: Array.from({ length: 9 }, (_, i) => ({ id: `cancel-${i}`, examPointId: `cp-${i}`, title: `Point ${i}`, ...(i === 0 ? { content: { explanation: 'Saved lesson' } } : {}) })),
      examPoints: Array.from({ length: 9 }, (_, i) => ({ id: `cp-${i}`, title: `Point ${i}`, priority: 'must', description: 'Test' })),
    }
    global.fixtureCourseState = {
      courses: [bundle],
      setGenerationPaused(value) { bundle.generationPaused = value },
      setGeneratingLessons(value, progress) { bundle.generatingLessons = value; bundle.generationProgress = progress },
     setLessonContent(id, content) { bundle.lessons.find(lesson => lesson.id === id).content = content },
      setLessonGenerationError(id, error) { bundle.lessons.find(lesson => lesson.id === id).generationError = error },
    }
    let calls = 0
    global.fetch = (_url, options) => new Promise((_resolve, reject) => {
      calls++
      options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
    })
    const task = api.generateAllLessonsInBackground('cancel-batch')
    try { await waitFor(() => calls === 4) } finally { api.cancelLessonGeneration('cancel-batch') }
    await task
    assert.equal(calls, 4)
    assert.equal(bundle.generationPaused, true)
    assert.equal(bundle.generationProgress.current, 1)
    assert.equal(bundle.lessons.filter(item => item.content).length, 1)
    calls = 0
    global.fetch = async () => completion(designedLesson({ explanation: 'New lesson', quiz: [{ type: 'short', question: `Task ${++calls}`, answer: 'A', explanation: 'E' }] }))
    await api.generateAllLessonsInBackground('cancel-batch')
    assert.equal(calls, 8)
    assert.equal(bundle.generationProgress.current, 9)
    assert.equal(bundle.lessons[0].content.explanation, 'Saved lesson')
    global.fixtureCourseState = { courses: [] }
  })

  await test('lesson count advice scales with content and custom plans preserve every source topic', async () => {
    const topics = Array.from({ length: 8 }, (_, index) => ({
      id: `source-${index}`, title: `Topic ${index}`, description: `Details ${index}`,
      priority: index < 4 ? 'must' : 'know', sourceFile: index < 4 ? 'a.pdf' : 'b.pdf', keyFormulas: [`f${index}`],
    }))
    const original = JSON.stringify(topics)
    const advice = api.recommendLessonCount(topics)
    assert(advice.min > 0 && advice.min <= advice.suggested && advice.suggested <= advice.max)
    const larger = api.recommendLessonCount([...topics, ...topics, ...topics])
    assert(larger.suggested > advice.suggested)
    for (const count of [1, 2, 4, 8, 12, 27]) {
      const plan = api.createLessonPlan(topics, count)
      assert.equal(plan.length, count)
      assert.equal(new Set(plan.map(point => point.id)).size, count)
      const coverage = plan.flatMap(point => point.coveredPoints)
      assert.deepEqual(new Set(coverage.map(point => point.id)), new Set(topics.map(point => point.id)))
      for (const point of topics) assert(coverage.some(covered => covered.id === point.id && covered.sourceFile === point.sourceFile && covered.description === point.description))
      if (count <= topics.length) assert.equal(coverage.length, topics.length, 'grouping must not duplicate or discard source topics')
      if (count > topics.length) assert(plan.some(point => point.practiceSequence?.total > 1))
    }
    assert.equal(JSON.stringify(topics), original)
    assert.equal(api.parseLessonCount('75'), 75)
    assert.equal(api.parseLessonCount(' 75 '), 75)
    assert.equal(api.parseLessonCount('300'), 300, 'recommended range is not an arbitrary 25/40 cap')
    for (const value of ['', '0', '-2', '3.5', 'abc', '1e3', '9007199254740992']) assert.equal(api.parseLessonCount(value), null)
  })

  await test('custom count waits for confirmation, survives refresh and never replaces an existing course', async () => {
    const realStore = api.realCourseStore
    realStore.setState({ courses: [], currentCourseId: null })
    const id = realStore.getState().createCourse('Plan fixture')
    const topics = [1, 2, 3, 4].map(i => ({ id: `point-${i}`, title: `Distinct topic ${i}`, description: `Details ${i}`, priority: 'must', sourceFile: `${i}.pdf` }))
    const current = () => realStore.getState().courses.find(item => item.course.id === id)
    realStore.getState().prepareLessonPlan(topics, id)
    realStore.getState().setLessonPlanCount(id, '2.5')
    assert.equal(realStore.getState().confirmLessonPlan(id), false)
    assert.equal(current().lessons.length, 0)
    realStore.getState().setLessonPlanCount(id, '2')
    assert.equal(current().lessons.length, 0)
    assert.equal(current().generatingLessons, false, 'no requests before confirmation')
    await realStore.persist.rehydrate()
    assert.equal(current().lessonPlanDraft.countInput, '2')
    assert.deepEqual(current().lessonPlanDraft.points, topics)
    global.fixtureCourseState = realStore.getState()
    const html = renderToStaticMarkup(React.createElement(StaticRouter, {}, React.createElement(api.LessonPlanCard, { bundle: current() })))
    assert(html.includes('建议'))
    assert(html.includes('value="2"'))
    assert(html.includes('确认并生成 2 关'))
    assert(html.includes('保留全部考点和来源'))
    assert.equal(realStore.getState().confirmLessonPlan(id), true)
    assert.equal(current().lessons.length, 2)
    assert.equal(current().lessonPlanDraft, undefined)
    assert.equal(current().generationProgress.total, 2)
    assert.equal(current().generatingLessons, true)
    assert(current().lessons.every(lesson => !lesson.content))
    realStore.getState().setLessonContent(current().lessons[0].id, { keyPoints: ['saved'], explanation: 'Saved content', examples: [], quiz: [] }, id)
    realStore.getState().completeLesson(current().lessons[0].id)
    const oldLessons = structuredClone(current().lessons)
    realStore.getState().prepareLessonPlan(topics, id)
    assert.equal(current().lessonPlanDraft, undefined)
    assert.equal(realStore.getState().confirmLessonPlan(id), false)
    assert.deepEqual(current().lessons, oldLessons)
    // A later coverage scan recognizes the original topics inside merged units.
    realStore.getState().mergeExamPoints(topics.map(point => ({ ...point, id: `${point.id}-rescanned` })), id)
    assert.equal(current().lessons.length, 2)
    assert.deepEqual(current().lessons, oldLessons)
    await realStore.persist.rehydrate()
    assert.equal(current().lessonPlan.targetCount, 2)
    assert.equal(current().progress.completedLessons, 1)
    assert.equal(current().generatingLessons, true)
    global.fixtureCourseState = { courses: [] }
  })

  await test('lessons require explicit goals, aligned tasks and criteria instead of subject-wide quotas', async () => {
    const point = { id: 'writing', title: '讨论双方并表达立场', description: '论据如何支持观点', priority: 'must', sourceFile: '雅思写作.pdf' }
    const requestBodies = []
    const short = { type: 'short', question: 'Rewrite this claim with a reason and example: University education improves career prospects.', answer: 'A supported claim with an appropriate example. Alternative positions are acceptable.', explanation: 'Evaluate relevance, support and language, not copied phrases.' }
    global.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body))
      const lesson = { keyPoints: ['Develop both views'], explanation: 'Use evidence to support the position.', examples: [], quiz: [short] }
      return completion(requestBodies.length === 1 ? lesson : designedLesson(lesson))
    }
    const content = await api.generateLessonContent(point, 'An essay should develop relevant arguments.', undefined, '雅思')
    assert.equal(requestBodies.length, 2)
    assert.equal(content.quiz.length, 1, 'one substantial task can suffice, regardless of priority')
    assert.equal(content.quiz[0].objective, content.learningDesign.objectives[0])
    assert.deepEqual(content.quiz[0].gradingCriteria, ['Explain the mechanism and justify the result'])
    const prompt = requestBodies[0].messages[0].content
    assert(prompt.includes('不设置固定题数、题型比例'))
    assert(prompt.includes('不把固定句式'))
    assert(prompt.includes('当前考点优先于课程名称'))
    assert(!prompt.includes('60%'))
    assert(requestBodies[1].messages[1].content.includes('缺少完整的本关学习目标'))
    assert.equal(latest().validationRetry, 1)
    assert.equal(latest().stage, 'done')
  })

  await test('quality guards catch duplicates without forcing all subjects into writing tasks', async () => {
    const short = { type: 'short', question: 'Explain the race condition.', answer: 'Unsynchronized shared access', explanation: 'Concurrent access can lose updates.' }
    const content = { keyPoints: [], explanation: 'Thread safety', examples: [], quiz: [short] }
    assert.deepEqual(api.lessonQualityIssues(content), [])
    assert(api.lessonQualityIssues({ ...content, quiz: [short, { ...short, question: ' Explain the race condition! ' }] }).length)
    assert(api.lessonQualityIssues(content, [short.question]).length)
    assert(api.lessonQualityIssues({ ...content, examples: [{ question: short.question, answer: 'A' }] }).length)
    assert(api.lessonQualityIssues({ ...content, quiz: [{ type: 'choice', question: 'Choose', options: ['Same', ' Same ', 'Other', 'Last'] }] }).length)
    assert.deepEqual(api.lessonQualityIssues({ ...content, quiz: [{ type: 'choice', question: 'Choose a formula', options: ['x+1', 'x-1', 'X+1', 'x/1'] }] }), [])
    assert.deepEqual(api.lessonQualityIssues({ ...content, quiz: [{ type: 'choice', question: 'Compare two cases', options: ['Case one', 'Case two'] }] }), [])
  })

  await test('method suggestions cover disciplines but remain optional and allow interdisciplinary lessons', async () => {
    const point = title => ({ id: 'method', title, description: '', priority: 'must' })
    for (const [title, hint] of [
      ['矩阵证明', '反例'], ['操作系统线程同步', '并发'], ['计算机网络TCP', '报文'],
      ['机器学习回归', '数据泄漏'], ['物理实验', '量纲'], ['英语词汇', '语境词汇'],
      ['历史史料', '证据'], ['经济决策', '风险'], ['医学病理', '教学案例'], ['建筑设计', '形式与功能'],
    ]) assert(api.relevantPracticeHints(point(title)).some(text => text.includes(hint)), title)
    const mixed = api.relevantPracticeHints(point('机器学习算法的矩阵推导'))
    assert(mixed.some(text => text.startsWith('数学：')))
    assert(mixed.some(text => text.startsWith('计算机：')))
    assert(mixed.some(text => text.startsWith('统计与机器学习：')))
    const domainOverride = api.relevantPracticeHints(point('概率证明'), 'IELTS')
    assert(domainOverride[0].startsWith('数学：'), 'the local objective is considered before a broad course label')
    const unknown = api.practiceGuidance(point('自定义专题'))
    assert(unknown.includes('无预设线索'))
    assert(unknown.includes('库外方法'))
    assert(unknown.includes('不回退到通用五题模板'))
    const language = api.practiceGuidance(point('语境词汇'), '雅思')
    assert(language.includes('不因课程叫雅思就一律写作文'))
    assert(language.includes('主动回忆'))
    assert(!language.includes('60%'))
  })

  await test('one vocabulary retrieval task can be valid in IELTS without a writing quota', async () => {
    const response = designedLesson({ explanation: 'Use collocations in context.', quiz: [{ type: 'fill', question: 'Complete the collocation: draw a ____.', answer: 'conclusion', acceptableAnswers: [], explanation: 'Draw a conclusion is the collocation.' }] })
    response.learningDesign = { discipline: '英语词汇', objectives: ['在语境中提取正确搭配'], approach: '主动回忆搭配', rationale: '本关训练词汇提取而非作文结构' }
    response.quiz[0].taskKind = '语境填词'
    response.quiz[0].gradingCriteria = ['填入与给定语境匹配的词形成完整搭配']
    let calls = 0
    global.fetch = async () => { calls++; return completion(response) }
    const result = await api.generateLessonContent({ id: 'vocab', title: '搭配提取', description: '英语词汇搭配', priority: 'must' }, 'draw a conclusion', undefined, '雅思')
    assert.equal(calls, 1, 'design and content are returned by the same request')
    assert.equal(result.quiz.length, 1)
    assert.equal(result.quiz[0].type, 'fill')
    assert.equal(result.quiz[0].objective, '在语境中提取正确搭配')
  })

  await test('missing objectives, criteria and malformed questions cannot silently enter new lessons', async () => {
    const response = designedLesson({ explanation: 'Prove a claim.', quiz: [{ type: 'short', question: 'Prove the stated claim.', answer: 'Proof', explanation: 'Reasoning' }] })
    const point = { id: 'proof', title: '证明', description: '数学证明', priority: 'must' }
    for (const damage of [
      value => { delete value.learningDesign },
      value => { value.learningDesign.objectives.push('A second untested goal') },
      value => { value.quiz[0].objectiveIndex = 19 },
      value => { value.quiz[0].gradingCriteria = [] },
      value => { value.quiz[0].taskKind = '' },
      value => { value.quiz.push({ type: 'short', question: 'Incomplete question' }) },
      value => { value.quiz[0].type = 'unsupported' },
    ]) {
      let calls = 0
      const invalid = structuredClone(response)
      damage(invalid)
      global.fetch = async () => { calls++; return completion(invalid) }
      await assert.rejects(api.generateLessonContent(point, 'source'))
      assert.equal(calls, 2, 'bounded validation retry; no incomplete save')
      assert.equal(latest().stage, 'failed')
    }
  })

  await test('grading uses task criteria and never auto-passes an open task for a keyword', async () => {
    const requests = []
    global.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body))
      return completion({ correct: false, feedback: '给出了术语，但没有说明因果过程。' })
    }
    const context = { questionType: 'short', discipline: '操作系统', objective: '解释陷入内核过程', taskKind: '机制解释', gradingCriteria: ['说明系统调用号、特权态切换与返回路径'] }
    const grade = await api.gradeAnswer('Explain a system call', '内核', '完整过程', ['内核'], context)
    assert.equal(grade.status, 'incorrect')
    assert.equal(requests.length, 1)
    assert(requests[0].messages[0].content.includes(context.gradingCriteria[0]))
    assert(requests[0].messages[0].content.includes(context.objective))
    assert(requests[0].messages[0].content.includes('替代解法'))
    await api.gradeAnswer('Case-sensitive identifier', 'X', 'x', [], { questionType: 'fill' })
    await api.gradeAnswer('Decimal value', '1.2', '12', [], { questionType: 'fill' })
    await api.gradeAnswer('Python indentation matters', 'x y', 'xy', [], { questionType: 'short' })
    assert.equal(requests.length, 4, 'case, punctuation and inner spaces are not stripped for exact matching')
    const fill = await api.gradeAnswer('Give an equivalent name', ' TCP ', 'Transmission Control Protocol', ['TCP'], { questionType: 'fill' })
    assert.equal(fill.status, 'correct')
    assert.equal(requests.length, 4, 'a complete exact fill synonym can avoid a request')
    await api.gradeAnswer('Legacy open question', 'term', 'full answer', ['term'])
    assert.equal(requests.length, 5, 'unknown legacy type must not use keyword shortcut')
  })

  await test('independent answer review receives the same objective and task-specific criteria', async () => {
    let body
    global.fetch = async (_url, options) => {
      body = JSON.parse(options.body)
      return completion({ userCorrect: true, correctedAnswer: null, additionalAcceptableAnswers: [], feedback: '另一种证明满足条件。' })
    }
    const assessment = { discipline: '数学', objective: '构造反例', taskKind: '反例构造', gradingCriteria: ['满足全部前提，但结论不成立'] }
    const result = await api.adjudicateTextAnswer({ question: 'Find a counterexample', userAnswer: 'Alternative example', referenceAnswer: 'One example', assessment })
    assert.equal(result.userCorrect, true)
    assert(body.messages[0].content.includes(assessment.gradingCriteria[0]))
    assert(body.messages[0].content.includes('参考答案不唯一'))
  })

  await test('single-question replacement retains the course goal and refreshes the concrete task criteria', async () => {
    const objective = '分析共享数据的并发访问'
    const questions = []
    const question = designedQuestion({ type: 'short', question: 'Trace these two interleaved updates.', answer: 'One update is lost.', explanation: 'Both read the old value.', objective, taskKind: '执行追踪', gradingCriteria: ['逐步解释读写交错和最终值'] })
    const design = { discipline: '操作系统', objectives: [objective], approach: '追踪执行', rationale: '从交错读写理解竞态' }
    global.fetch = async (_url, options) => {
      questions.push(JSON.parse(options.body))
      return completion({ ...question, objective: questions.length === 1 ? 'unrelated goal' : objective })
    }
    const result = await api.regenerateQuizQuestion('竞态条件', 'Old question', 'short', 'source', 'old-id', 'old explanation', {
      courseName: '操作系统', learningDesign: design, assessment: { objective, taskKind: '代码排错', gradingCriteria: ['解释错误来源'] },
    })
    assert.equal(questions.length, 2, 'a goal-changing response is retried')
    assert.equal(result.objective, objective)
    assert.equal(result.type, 'short')
    assert.equal(result.taskKind, '执行追踪')
    assert.deepEqual(result.gradingCriteria, ['逐步解释读写交错和最终值'])
    assert(questions[0].messages[0].content.includes('【课程】操作系统'))
    assert(questions[0].messages[0].content.includes('保留原能力目标'))
    assert.notEqual(result.id, 'old-id')
  })

  await test('legacy progress survives upgrade; only changed task criteria invalidate new grading', async () => {
    const question = { id: 'legacy-q', type: 'short', question: 'Old question', answer: 'Answer', explanation: 'Explanation' }
    const legacyHash = value => {
      let hash = 2166136261
      for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619) }
      return (hash >>> 0).toString(36)
    }
    const refs = api.makeQuizQuestionRefs('legacy-lesson', [question])
    assert.equal(refs[0].fingerprint, legacyHash(JSON.stringify(['short', 'Old question', []])))
    const quizStore = api.useQuizProgressStore
    const key = api.quizProgressKey('legacy-course', 'legacy-lesson')
    quizStore.getState().patchAttempt('legacy-course', 'legacy-lesson', refs, 'legacy-q', { textAnswer: 'Saved answer', solved: true })
    await quizStore.persist.rehydrate()
    quizStore.getState().syncLesson('legacy-course', 'legacy-lesson', api.makeQuizQuestionRefs('legacy-lesson', [question]))
    assert.equal(quizStore.getState().byLesson[key].attempts['legacy-q'].textAnswer, 'Saved answer')
    assert.equal(quizStore.getState().byLesson[key].attempts['legacy-q'].solved, true)
    const designed = designedQuestion(question)
    const designedRefs = api.makeQuizQuestionRefs('legacy-lesson', [designed])
    assert.notEqual(designedRefs[0].fingerprint, refs[0].fingerprint)
    assert.equal(api.makeQuizQuestionRefs('legacy-lesson', [{ ...designed, answer: 'Corrected reference', acceptableAnswers: ['Alternative'] }])[0].fingerprint, designedRefs[0].fingerprint)
    assert.notEqual(api.makeQuizQuestionRefs('legacy-lesson', [{ ...designed, gradingCriteria: ['Changed condition'] }])[0].fingerprint, designedRefs[0].fingerprint)
  })

  await test('merged lesson uses source excerpts from every covered topic, not only the first file', async () => {
    const points = [
      { id: 'p1', title: 'Mutex', description: 'Mutual exclusion', sourceFile: 'first.pdf', priority: 'must' },
      { id: 'p2', title: 'Semaphore', description: 'Synchronization', sourceFile: 'second.pdf', priority: 'must' },
    ]
    const unit = api.createLessonPlan(points, 1)[0]
    let body
    global.fetch = async (_url, options) => {
      body = JSON.parse(options.body)
      return completion(designedLesson({ keyPoints: ['Mutex', 'Semaphore'], explanation: 'Compare these synchronization tools.', examples: [], quiz: [{ type: 'short', question: 'Explain when you would choose each tool.', answer: 'Choose based on the resource count.', explanation: 'Mutual exclusion versus counting resources.' }] }))
    }
    await api.generateLessonContent(unit, '===== 来源文件：first.pdf =====\nONLY_FIRST_SOURCE\n===== 来源文件：second.pdf =====\nONLY_SECOND_SOURCE', undefined, 'Operating systems')
    const prompt = body.messages[1].content
    assert(prompt.includes('ONLY_FIRST_SOURCE'))
    assert(prompt.includes('ONLY_SECOND_SOURCE'))
    assert(body.messages[0].content.includes('当前考点优先于课程名称'))
    assert(!body.messages[0].content.includes('【写作类课程】'))
  })

  await test('refresh retains counts and marks terminated requests interrupted', async () => {
    const op = api.beginOperation('extract', 'saved')
    op.report({ stage: 'waiting', current: 3, total: 8, unit: 'chunks' })
    await store.persist.rehydrate()
    assert.equal(latest().stage, 'interrupted')
    assert.equal(latest().current, 3)
    assert.equal(latest().total, 8)
    assert(!api.isOperationActive(latest()))
    const saved = storage.get('chillpass-operation-progress')
    assert(!saved.includes('test-key'))
  })

  await test('empty final merge keeps every extracted point instead of losing the whole import', async () => {
    let requests = 0
    let mergeRequests = 0
    global.fetch = async (_, options) => {
      requests++
      const body = JSON.parse(options.body)
      if (body.messages.some(message => message.content.includes('待合并考点'))) {
        mergeRequests++
        return completion('')
      }
      return completion(Array.from({ length: 12 }, (_, index) => ({ ...points(`主题${requests}-${index}`)[0], description: `Explanation ${requests}-${index}` })))
    }
    const result = await api.extractExamPointsFromSources([{ sourceFile: 'merge.pdf', text: 'a'.repeat(9000) }], 'Final merge')
    assert.equal(requests, 3)
    assert.equal(mergeRequests, 1)
    assert.equal(result.length, 24)
    assert.equal(new Set(result.map(point => point.id)).size, 24)
    assert.equal(latest().stage, 'done')
    assert.equal(latest().localMerge, true)
    assert.equal(checkpointRecords.size, 2)
  })

  await test('75 completed sections do not trigger one giant final AI request', async () => {
    let requests = 0
    global.fetch = async (_, options) => {
      const body = JSON.parse(options.body)
      assert(!body.messages.some(message => message.content.includes('待合并考点')))
      return completion(points(`Independent topic ${++requests}`))
    }
    const result = await api.extractExamPointsFromSources([{ sourceFile: 'large.pdf', text: 'a'.repeat(75 * 8000) }], '75-section fixture')
    assert.equal(requests, 75)
    assert.equal(result.length, 75)
    assert.equal(latest().current, 75)
    assert.equal(latest().total, 75)
    assert.equal(latest().stage, 'done')
    assert.equal(latest().localMerge, true)
  })

  await test('new module after refresh reuses committed sections from the home-page retry entry', async () => {
    const source = { sourceFile: 'resume.pdf', text: 'a'.repeat(16001) }
    let requests = 0
    global.fetch = async () => ++requests === 1 ? completion(points('Saved first topic')) : new Response('Mock API failure', { status: 400 })
    await assert.rejects(api.extractExamPointsFromSources([source], 'Resume fixture'))
    assert.equal(latest().current, 1)
    assert.equal(checkpointRecords.size, 1)
    const savedId = [...checkpointRecords.values()][0].points[0].id
    // Recompile a fresh module: no extraction function or in-memory array survives.
    const refreshed = new Module(loaded.filename, module)
    refreshed.filename = loaded.filename; refreshed.paths = loaded.paths
    refreshed._compile(compiled.outputFiles[0].text, loaded.filename)
    requests = 0
    global.fetch = async () => completion(points(`Remaining topic ${++requests}`))
    const result = await refreshed.exports.extractExamPoints(`===== 来源文件：${source.sourceFile} =====\n${source.text}`, 'Resume fixture')
    assert.equal(requests, 2)
    assert.equal(result.length, 3)
    assert(result.some(point => point.id === savedId))
    const progress = refreshed.exports.useOperationProgressStore.getState().items[0]
    assert.equal(progress.reusedChunks, 1)
    assert.equal(progress.stage, 'done')
  })

  await test('storage failure stops API spending before advancing progress', async () => {
    rejectCheckpointWrites = true
    let requests = 0
    global.fetch = async () => { requests++; return completion(points('Unsaved result')) }
    await assert.rejects(api.extractExamPointsFromSources([{ sourceFile: 'storage.pdf', text: 'a'.repeat(160000) }], 'Storage fixture'), /无法保存/)
    assert(requests > 0 && requests <= api.BACKGROUND_CONCURRENCY, 'only already-started workers may consume a request; stop scheduling on storage failure')
    assert.equal(latest().current, 0)
    assert.equal(checkpointRecords.size, 0)
    assert.equal(latest().stage, 'failed')
  })

  await test('scanned page labels and duplicate sources never trigger extraction requests', async () => {
    const scanned = { sourceFile: 'scan.pdf', text: '\n--- 第 1 页 ---\n\n--- 第 2 页 ---\n\n--- 第 3 页 ---\n' }
    let requests = 0
    global.fetch = async () => { requests++; return completion(points('Readable topic')) }
    await assert.rejects(api.extractExamPointsFromSources([scanned], 'Scanned fixture'), /OCR/)
    assert.equal(requests, 0)
    const readable = { sourceFile: 'readable.pdf', text: 'Real course text' }
    const result = await api.extractExamPointsFromSources([scanned, readable, readable], 'Mixed fixture')
    assert.equal(result.length, 1)
    assert.equal(requests, 1)
    assert.equal(latest().total, 1)
    assert.deepEqual(latest().skippedSources, ['scan.pdf'])
    assert.equal(latest().duplicateSources, 1)
  })

  await test('changed source text cannot reuse stale section contents', async () => {
    let requests = 0
    global.fetch = async () => completion(points(`Revision ${++requests}`))
    await api.extractExamPointsFromSources([{ sourceFile: 'revision.pdf', text: 'first revision' }], 'Revision fixture')
    await api.extractExamPointsFromSources([{ sourceFile: 'revision.pdf', text: 'second revision' }], 'Revision fixture')
    assert.equal(requests, 2)
    assert.equal(latest().reusedChunks, undefined)
  })

  await test('all-empty extracted arrays can be retried instead of reusing empty results forever', async () => {
    let requests = 0
    global.fetch = async () => completion(++requests === 1 ? [] : points('Now available'))
    const sources = [{ sourceFile: 'empty-result.pdf', text: 'Readable source text' }]
    await assert.rejects(api.extractExamPointsFromSources(sources, 'Empty fixture'), /未提炼/)
    const result = await api.extractExamPointsFromSources(sources, 'Empty fixture')
    assert.equal(requests, 2)
    assert.equal(result.length, 1)
  })

  await test('explicit clear-all removes stored extraction checkpoints', async () => {
    global.fetch = async () => completion(points('Clearable test topic'))
    await api.extractExamPointsFromSources([{ sourceFile: 'clear.pdf', text: 'Test course' }], 'Clear fixture')
    assert.equal(checkpointRecords.size, 1)
    await api.clearExtractionCheckpoints()
    assert.equal(checkpointRecords.size, 0)
  })

  await test('progress markup does not display 100% during final consolidation', async () => {
    const item = { id: 'fixture', kind: 'extract', detail: 'Course', stage: 'consolidating', current: 4, total: 4, unit: 'chunks', startedAt: 1000, updatedAt: 2000 }
    const markup = renderToStaticMarkup(React.createElement(api.OperationProgressCard, { item, now: 61000 }))
    assert(markup.includes('正在合并重复考点'))
    assert(markup.includes('已处理 4/4'))
    assert(markup.includes('1:00'))
    assert(!markup.includes('aria-valuenow="100"'))
    assert(!markup.includes('100%'))
    const failed = renderToStaticMarkup(React.createElement(api.OperationProgressCard, { item: { ...item, stage: 'failed', phase: 'consolidating' } }))
    assert(!failed.includes('100%'))
    const completed = renderToStaticMarkup(React.createElement(api.OperationProgressCard, { item: { ...item, stage: 'done', finishedAt: 61000 } }))
    assert(completed.includes('aria-valuenow="100"'))
  })

  await test('cross-page progress includes persisted optimization counts and failures', async () => {
    global.fixtureCourseState.courses = [{ course: { id: 'c', name: 'Mock course' }, optimizationJob: {
      id: 'job', kind: 'batch', status: 'running', phase: 'optimizing', targetLessonIds: ['a', 'b', 'c'],
      items: { a: { state: 'done' }, b: { state: 'failed' }, c: { state: 'pending' } }, startedAt: 1, updatedAt: 2,
    } }]
    let html = renderToStaticMarkup(React.createElement(api.OperationProgressCenter))
    assert(html.includes('已处理 2/3'))
    assert(html.includes('失败 1 项'))
    global.fixtureCourseState.courses[0].optimizationJob.status = 'completed'
    html = renderToStaticMarkup(React.createElement(api.OperationProgressCenter))
    assert(html.includes('未完成，请重试'))
    global.fixtureCourseState.courses = []
  })

  await test('economy lessons reduce the request payload, use Flash only for lessons and retain quality checks', async () => {
    const bodies = []
    const point = { id: 'econ', title: '线程同步', description: '用互斥保护共享计数器', priority: 'must' }
    const source = '线程同步：两个线程共享计数器。读、改、写之间可能被抢占，临界区需要互斥。\n'.repeat(400)
    global.fetch = async (_url, options) => { bodies.push(JSON.parse(options.body)); return completion(designedLesson({ explanation: 'Use a mutex.', quiz: [{ type: 'short', question: 'Identify the lost update in this trace: T1 reads 0, T2 reads 0, both write 1.', answer: 'One increment is lost.', explanation: 'Both read the same old value.' }] })) }
    await api.generateLessonContent(point, source, undefined, '操作系统')
    const full = bodies[0]
    global.fixtureAiSettings = { economyLessons: true, fastResponses: false, model: 'deepseek-v4-pro' }
    try {
      const result = await api.generateLessonContent(point, source, undefined, '操作系统')
      const concise = bodies[1]
      assert.equal(concise.model, 'deepseek-flash')
      assert.equal(concise.thinking.type, 'disabled')
      assert.equal(concise.max_tokens, 8192)
      assert.equal(concise.max_tokens, full.max_tokens, 'the limit is a ceiling, not a spending target')
      const chars = body => body.messages.reduce((n, message) => n + message.content.length, 0)
      assert(chars(concise) < chars(full) * 0.5)
      assert.equal(result.quiz[0].objective, result.learningDesign.objectives[0])
      assert(concise.messages[0].content.includes('不设置固定题数、题型比例'))
      assert(concise.messages[0].content.includes('不能只给关键词'))
      console.log(`Fixture prompt characters: full ${chars(full)}, concise ${chars(concise)}; no token/cost measurement implied`)
      global.fetch = async (_url, options) => { bodies.push(JSON.parse(options.body)); return completion({ newAbilities: [], newMemories: [] }) }
      await api.summarizeAthenaInsights('question', 'reply', [])
      assert.equal(bodies.at(-1).model, 'deepseek-v4-pro', 'do not change summaries/chat/assessment model')
      assert.equal(bodies.at(-1).thinking.type, 'enabled')
      global.fixtureAiSettings = { economyLessons: true, provider: 'zhipu', model: 'glm-5.3', zhipuApiKey: 'fake' }
      global.fetch = async (_url, options) => { bodies.push(JSON.parse(options.body)); return completion(designedLesson({ explanation: 'E', quiz: [{ type: 'short', question: 'Zhipu task', answer: 'A', explanation: 'E' }] })) }
      await api.generateLessonContent(point, source)
      assert.equal(bodies.at(-1).model, 'glm-5.3')
      assert.equal(bodies.at(-1).thinking, undefined)
    } finally { global.fixtureAiSettings = undefined }
  })

  await test('economy network and format retries share a two-request total; invalid content is never accepted', async () => {
    global.fixtureAiSettings = { economyLessons: true }
    try {
      let calls = 0
      global.fetch = async () => ++calls === 1 ? new Response('Busy', { status: 503 }) : completion('{invalid')
      await assert.rejects(api.generateLessonContent({ id: 'retry-budget', title: 'Point', description: 'Test', priority: 'must' }, 'Source'), /2 次|JSON/)
      assert.equal(calls, 2, 'no multiplied network x validation retries')
      assert.equal(latest().stage, 'failed')
      calls = 0
      const bodies = []
      global.fetch = async (_url, options) => { calls++; bodies.push(JSON.parse(options.body)); return completion({ explanation: 'No objectives or valid questions', quiz: [] }) }
      await assert.rejects(api.generateLessonContent({ id: 'invalid-budget', title: 'Point', description: 'Test', priority: 'must' }, 'Source'))
      assert.equal(calls, 2)
      assert(bodies.every(body => body.max_tokens === 8192), 'format retry does not silently raise the output allowance')
    } finally { global.fixtureAiSettings = undefined }
  })

  await test('economy context retains each merged source and the focused passage near a chunk boundary', async () => {
    global.fixtureAiSettings = { economyLessons: true }
    const bodies = []
    const topics = ['Alpha', 'Beta', 'Gamma'].map(name => ({ id: name, title: name, description: `${name} mechanism`, priority: 'must', sourceFile: `${name}.pdf`, keyFormulas: [`${name}=1`] }))
    global.fetch = async (_url, options) => { bodies.push(JSON.parse(options.body)); return completion(designedLesson({ explanation: 'All topics', quiz: [{ type: 'short', question: 'Compare supplied mechanisms', answer: 'A', explanation: 'E' }] })) }
    try {
      const merged = { ...topics[0], coveredPoints: topics }
      const source = topics.map(point => `===== 来源文件：${point.sourceFile} =====\n${point.title} evidence and conditions`).join('\n')
      await api.generateLessonContent(merged, source)
      const prompt = bodies[0].messages[1].content
      for (const topic of topics) { assert(prompt.includes(`${topic.title} evidence`)); assert(prompt.includes(`${topic.title}=1`)) }
      assert.equal(bodies[0].max_tokens, 8192, 'merged units begin with the same generous ceiling')
      const boundary = { id: 'boundary', title: 'FOCUSED_TOKEN', description: 'Important rule', priority: 'must' }
      await api.generateLessonContent(boundary, 'unrelated filler '.repeat(106) + '\nFOCUSED_TOKEN means use the marked rule.\n' + 'more filler '.repeat(500))
      assert(bodies[1].messages[1].content.includes('means use the marked rule'))
    } finally { global.fixtureAiSettings = undefined }
  })

  await test('economy runs all 109 lessons without a one-yuan stop or replacing existing progress', async () => {
    global.fixtureAiSettings = { economyLessons: true }
    const saved = { keyPoints: ['saved'], explanation: 'Previously generated', examples: [], quiz: [] }
    const bundle = { course: { id: 'econ109', name: 'Cost fixture' }, rawText: 'course source',
      lessons: Array.from({ length: 109 }, (_, i) => ({ id: `lesson-${i}`, examPointId: `point-${i}`, title: `Point ${i}`, status: i === 0 ? 'completed' : 'unlocked', ...(i === 0 ? { content: saved } : {}) })),
      examPoints: Array.from({ length: 109 }, (_, i) => ({ id: `point-${i}`, title: `Point ${i}`, description: 'Test', priority: 'must' })),
    }
    global.fixtureCourseState = { courses: [bundle], setGenerationPaused(value) { bundle.generationPaused = value }, setGeneratingLessons(value, progress) { bundle.generatingLessons = value; bundle.generationProgress = progress }, setLessonContent(id, content) { bundle.lessons.find(lesson => lesson.id === id).content = content }, setLessonGenerationError(id, error) { bundle.lessons.find(lesson => lesson.id === id).generationError = error } }
    let requests = 0
    global.fetch = async () => completion(designedLesson({ explanation: 'Concise, complete explanation', quiz: [{ type: 'short', question: `Distinct task ${++requests}`, answer: 'Valid answer', explanation: 'Reason' }] }))
    try {
      await api.generateAllLessonsInBackground('econ109')
      assert.equal(requests, 108)
      assert.equal(bundle.lessons.length, 109)
      assert.equal(bundle.generationProgress.current, 109)
      assert(bundle.lessons.every(lesson => lesson.content))
      assert.equal(bundle.lessons[0].content, saved)
      assert.equal(bundle.lessons[0].status, 'completed')
    } finally { global.fixtureAiSettings = undefined; global.fixtureCourseState = { courses: [] } }
  })

  await test('economy setting persists and cost hints distinguish estimates, excluded operations and providers', async () => {
    const settings = api.realSettingsStore
    assert.equal(settings.getState().economyLessons, true)
    settings.getState().setEconomyLessons(false)
    await settings.persist.rehydrate()
    assert.equal(settings.getState().economyLessons, false)
    settings.getState().setEconomyLessons(true)
    const persisted = JSON.parse(storage.get('chillpass-settings'))
    delete persisted.state.economyLessons
    storage.set('chillpass-settings', JSON.stringify(persisted))
    await settings.persist.rehydrate()
    assert.equal(settings.getState().economyLessons, true, 'old settings receive the new default')
    const estimate = api.estimateEconomyLessons(109)
    assert(estimate.offPeak[0] < 1 && estimate.offPeak[1] < 1)
    assert.equal(estimate.peak[0], estimate.offPeak[0] * 2)
    assert(api.estimateEconomyLessons(109, 200).peak[1] > estimate.peak[1])
    assert.equal(api.isDeepSeekPeak(new Date('2026-09-15T01:00:00Z')), true)
    assert.equal(api.isDeepSeekPeak(new Date('2026-09-15T04:00:00Z')), false)
    assert.equal(api.isDeepSeekPeak(new Date('2026-09-19T02:00:00Z')), false)
    global.fixtureAiSettings = { economyLessons: true }
    try {
      const html = renderToStaticMarkup(React.createElement(api.LessonCostEstimate, { count: 109 }))
      assert(html.includes('109'))
      assert(html.includes('非账单或费用上限'))
      assert(html.includes('不含课件提炼'))
      assert(html.includes('¥0.55–0.90'))
      assert(html.includes('¥1.09–1.81'))
      const example = renderToStaticMarkup(React.createElement(api.LessonCostEstimate, { count: 109, example: true }))
      assert(example.includes('不是当前队列'))
      assert(!example.includes('待生成 109'))
      global.fixtureAiSettings = { economyLessons: true, provider: 'zhipu' }
      assert(!renderToStaticMarkup(React.createElement(api.LessonCostEstimate, { count: 109 })).includes('¥'))
      global.fixtureAiSettings = { economyLessons: false }
      assert.equal(renderToStaticMarkup(React.createElement(api.LessonCostEstimate, { count: 109 })), '')
    } finally { global.fixtureAiSettings = undefined }
  })

  await test('confirmed truncation retries once automatically, then waits for a manual retry', async () => {
    global.fixtureAiSettings = { economyLessons: true }
    const bodies = []
    const truncated = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"explanation":"partial' }, finish_reason: 'length' }] }), { headers: { 'content-type': 'application/json' } })
    const point = { id: 'truncated-economy', title: 'Point', priority: 'must', description: 'Test' }
    try {
      global.fetch = async (_url, options) => {
        bodies.push(JSON.parse(options.body))
        return bodies.length === 1 ? truncated() : completion(designedLesson({ explanation: 'Complete explanation', quiz: [{ type: 'short', question: 'Apply the rule', answer: 'Complete answer', explanation: 'Reason' }] }))
      }
      assert.equal((await api.generateLessonContent(point, 'Source')).explanation, 'Complete explanation')
      assert.deepEqual(bodies.map(body => body.max_tokens), [8192, 16384])
      assert(bodies.every(body => body.model === 'deepseek-flash'))
      assert(latest().retryHint.includes('16384'))
      assert.equal(latest().truncationRetries, 1)
      assert.equal(latest().validationRetry, 0, 'truncation is not a malformed-JSON failure')
      assert.equal(latest().outputTokens, 16384)
      assert.equal(latest().attempt, 2)
      assert.equal(latest().maxAttempts, undefined, 'do not display a misleading 1/2 total')
      const markup = renderToStaticMarkup(React.createElement(api.OperationProgressCard, { item: { ...latest(), stage: 'receiving' } }))
      assert(markup.includes('16384'))
      assert(markup.includes('第 2 次请求'))
      assert.equal(latest().stage, 'done')
      bodies.length = 0
      global.fetch = async (_url, options) => { bodies.push(JSON.parse(options.body)); return truncated() }
      await assert.rejects(api.generateLessonContent(point, 'Source'), /自动加额重试 1 次/)
      assert.deepEqual(bodies.map(body => body.max_tokens), [8192, 16384])
      assert.equal(latest().stage, 'failed')
      assert(latest().error.includes('16384'))
      assert(latest().error.includes('手动重试'))
      bodies.length = 0
      const raised = []
      await assert.rejects(api.generateLessonContent(point, 'Source', undefined, '', [], {
        savedBudget: { key: 'deepseek:deepseek-flash:concise', maxTokens: 16384 },
        previousError: latest().error,
        onBudgetChange: budget => raised.push(budget.maxTokens),
      }), /自动加额重试 1 次/)
      assert.deepEqual(bodies.map(body => body.max_tokens), [32768, 65536])
      assert.deepEqual(raised, [32768, 65536], 'manual retry resumes above the failed allowance')
    } finally { global.fixtureAiSettings = undefined }
  })

  await test('10/24 legacy stopped batch remains recoverable after refresh and retries only its missing 14', async () => {
    const realStore = api.realCourseStore
    const bundle = {
      course: { id: 'recovery24', name: 'Recovery fixture', status: 'ready', files: [] }, rawText: 'source',
      generatingLessons: false, generationProgress: { current: 10, total: 24 },
      progress: { totalLessons: 24, completedLessons: 2, currentStreak: 3 },
      lessons: Array.from({ length: 24 }, (_, i) => ({ id: `recovery-${i}`, examPointId: `rp-${i}`, order: i + 1, title: `Topic ${i}`, status: i < 2 ? 'completed' : 'available', ...(i < 10 ? { content: { keyPoints: ['Saved'], explanation: `Saved content ${i}`, examples: [], quiz: [] } } : {}) })),
      examPoints: Array.from({ length: 24 }, (_, i) => ({ id: `rp-${i}`, title: `Topic ${i}`, description: 'Test', priority: 'must' })),
    }
    const preserved = structuredClone(bundle.lessons.slice(0, 10))
    realStore.setState({ courses: [bundle], currentCourseId: 'recovery24' })
    Object.defineProperty(global, 'fixtureCourseState', { configurable: true, get: () => realStore.getState() })
    const current = () => realStore.getState().courses[0]
    let calls = 0
    global.fixtureAiSettings = { economyLessons: true }
    const renderCenter = () => renderToStaticMarkup(React.createElement(StaticRouter, { location: '/lessons' }, React.createElement(api.OperationProgressCenter)))
    global.fetch = async () => { calls++; return new Response('Mock provider rejection', { status: 400 }) }
    store.getInitialState().expanded = false
    try {
      await realStore.persist.rehydrate()
      assert.equal(api.getGenerationRecovery(current()).canRetry, true, 'legacy failures did not set generationPaused')
      assert.equal(api.getGenerationRecovery(current()).pending.length, 14)
      let html = renderCenter()
      assert(html.includes('仅重试未完成 14 关'))
      assert(html.includes('旧记录未保存具体原因'))
      assert(!html.includes('id="operation-progress-list"'), 'retry is available even with progress history collapsed')
      assert.equal(calls, 0, 'render and rehydrate must not incur requests')
      for (const status of ['running', 'paused']) {
        const optimizing = { ...current(), optimizationJob: { status, items: {}, targetLessonIds: [] } }
        assert.equal(api.getGenerationRecovery(optimizing).canRetry, false)
        const notice = renderToStaticMarkup(React.createElement(StaticRouter, null, React.createElement(api.ReadyLessonNotice, { bundle: optimizing })))
        assert(!notice.includes('仅重试未完成'))
      }
      await api.generateAllLessonsInBackground('recovery24')
      assert.equal(calls, 14)
      assert.equal(current().generatingLessons, false)
      assert.equal(current().generationPaused, true)
      assert.equal(current().generationProgress.current, 10)
      assert(current().lessons.slice(10).every(lesson => lesson.generationError))
      assert.deepEqual(current().lessons.slice(0, 10), preserved)
      const errors = current().lessons.slice(10).map(lesson => lesson.generationError)
      await realStore.persist.rehydrate()
      assert.deepEqual(current().lessons.slice(10).map(lesson => lesson.generationError), errors)
      assert.equal(current().generatingLessons, false, 'App auto-resume condition is false for failed batches')
      assert.equal(current().generationPaused, true)
      html = renderCenter()
      assert(html.includes('仅重试未完成 14 关'))
      assert(!html.includes('旧记录未保存具体原因'), 'new failures show their saved diagnostics')
      assert.equal(calls, 14, 'rehydration and display do not automatically retry failures')
      calls = 0
      global.fetch = async () => completion(designedLesson({ explanation: 'Recovered content', quiz: [{ type: 'short', question: `Recovery task ${++calls}`, answer: 'Complete answer', explanation: 'Reason' }] }))
      await api.generateAllLessonsInBackground('recovery24')
      assert.equal(calls, 14, 'the ten ready lessons are not regenerated')
      assert.equal(current().generationProgress.current, 24)
      assert.equal(current().generationPaused, false)
      assert.equal(current().generatingLessons, false)
      assert(current().lessons.every(lesson => lesson.content && !lesson.generationError))
      assert.deepEqual(current().lessons.slice(0, 10), preserved)
      assert.deepEqual(current().progress, bundle.progress)
      await realStore.persist.rehydrate()
      assert(current().lessons.every(lesson => lesson.content && !lesson.generationError))
      assert.equal(api.getGenerationRecovery(current()).canRetry, false)
      assert.deepEqual(current().lessons.slice(0, 10), preserved)
    } finally {
      store.getInitialState().expanded = true
      global.fixtureAiSettings = undefined
      Object.defineProperty(global, 'fixtureCourseState', { configurable: true, writable: true, value: { courses: [] } })
    }
  })

  await test('failed operation diagnostics are bounded, redacted, persisted and displayed', async () => {
    const diagnostic = 'Provider rejected Bearer token-value; key sk-private123. ' + 'detail '.repeat(180)
    await assert.rejects(api.trackOperation('lesson', 'Diagnostic fixture', async () => { throw new Error(diagnostic) }))
    const error = latest().error
    assert(error.length <= 800)
    assert(error.includes('[redacted]'))
    assert(!error.includes('token-value'))
    assert(!error.includes('sk-private123'))
    await store.persist.rehydrate()
    assert.equal(latest().error, error)
    const html = renderToStaticMarkup(React.createElement(api.OperationProgressCard, { item: latest() }))
    assert(html.includes('失败原因'))
    assert(html.includes('Provider rejected'))
    assert(!html.includes('token-value'))
  })

  await test('invalid quiz diagnostics identify the rejected field and never accept malformed questions', async () => {
    global.fixtureAiSettings = { economyLessons: true }
    const point = { id: 'invalid-fields', title: 'Point', description: 'Test', priority: 'must' }
    try {
      let calls = 0
      global.fetch = async () => { calls++; return completion(designedLesson({ explanation: 'Valid explanation', quiz: [{ type: 'short', question: 'Missing answer', explanation: 'Reason' }] })) }
      await assert.rejects(api.generateLessonContent(point, 'Source'), /quiz\[1\]\.answer/)
      assert.equal(calls, 2)
      assert(latest().error.includes('quiz[1].answer'))
      calls = 0
      global.fetch = async () => { calls++; return completion(designedLesson({ explanation: 'Valid explanation', quiz: [{ type: 'choice', question: 'Invalid index', options: ['A', 'B'], correctIndex: 8, explanation: 'Reason' }] })) }
      await assert.rejects(api.generateLessonContent(point, 'Source'), /correctIndex/)
      assert.equal(calls, 2)
      assert.equal(latest().stage, 'failed')
    } finally { global.fixtureAiSettings = undefined }
  })

  await test('late failures from replaced source material do not contaminate the new course', async () => {
    const realStore = api.realCourseStore
    const bundle = { course: { id: 'stale-error', name: 'Source change', status: 'ready', files: [] }, rawText: 'original source',
      lessons: [{ id: 'stale-lesson', examPointId: 'stale-point', title: 'Original point', status: 'available' }],
      examPoints: [{ id: 'stale-point', title: 'Original point', description: 'Test', priority: 'must' }], progress: {} }
    realStore.setState({ courses: [bundle], currentCourseId: 'stale-error' })
    Object.defineProperty(global, 'fixtureCourseState', { configurable: true, get: () => realStore.getState() })
    let release
    global.fetch = () => new Promise(resolve => { release = () => resolve(new Response('Old failure', { status: 400 })) })
    const task = api.generateAllLessonsInBackground('stale-error')
    try {
      await waitFor(() => release)
      realStore.setState({ courses: [{ ...bundle, rawText: 'replacement source', generatingLessons: false }] })
      release()
      await task
      assert.equal(realStore.getState().courses[0].lessons[0].generationError, undefined)
      assert.equal(realStore.getState().courses[0].lessons[0].content, undefined)
      assert.equal(realStore.getState().courses[0].generatingLessons, false)
    } finally {
      release?.(); await task
      Object.defineProperty(global, 'fixtureCourseState', { configurable: true, writable: true, value: { courses: [] } })
    }
  })

  await test('raised lesson budget survives cancel/refresh and is reused by generation and optimization', async () => {
    const realStore = api.realCourseStore
    const content = { keyPoints: ['Saved'], explanation: 'Existing content', examples: [], quiz: [] }
    const bundle = { course: { id: 'adaptive', name: 'Adaptive fixture', status: 'ready', files: [] }, rawText: 'source',
      progress: { totalLessons: 2, completedLessons: 1, currentStreak: 2 },
      lessons: [{ id: 'adaptive-lesson', examPointId: 'adaptive-point', title: 'Large point', status: 'available', order: 1, generationError: '关卡内容自动重试后仍未生成成功：AI 返回内容过长被截断' },
        { id: 'preserved-lesson', examPointId: 'preserved-point', title: 'Saved point', status: 'completed', order: 2, content }],
      examPoints: [{ id: 'adaptive-point', title: 'Large point', priority: 'must', description: 'Source' }],
    }
    const preserved = structuredClone(bundle.lessons[1])
    realStore.setState({ courses: [bundle], currentCourseId: 'adaptive' })
    Object.defineProperty(global, 'fixtureCourseState', { configurable: true, get: () => realStore.getState() })
    global.fixtureAiSettings = { economyLessons: true }
    const current = () => realStore.getState().courses[0]
    const limits = []
    const truncated = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"partial":' }, finish_reason: 'length' }] }), { headers: { 'content-type': 'application/json' } })
    global.fetch = async (_url, options) => {
      limits.push(JSON.parse(options.body).max_tokens)
      if (limits.length === 1) return truncated()
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }))
    }
    let task = api.generateAllLessonsInBackground('adaptive')
    try {
      await waitFor(() => limits.length === 2)
      assert.deepEqual(limits, [4096, 8192], 'legacy 2304 truncation failures resume above the old failed limit')
      assert.equal(current().lessons[0].generationBudget.maxTokens, 8192)
      assert.equal(JSON.parse(storage.get('chillpass-course-v2')).state.courses[0].lessons[0].generationBudget.maxTokens, 8192)
      api.cancelLessonGeneration('adaptive')
      await task
      assert.equal(current().generationPaused, true)
      await realStore.persist.rehydrate()
      assert.equal(limits.length, 2, 'refresh alone does not restart cancelled work')
      assert.equal(current().lessons[0].generationBudget.maxTokens, 8192)
      assert.equal(current().lessons[0].content, undefined, 'partial JSON was never saved')
      global.fetch = async (_url, options) => {
        limits.push(JSON.parse(options.body).max_tokens)
        return completion(designedLesson({ explanation: 'Recovered', quiz: [{ type: 'short', question: 'Use the rule in this trace', answer: 'Complete', explanation: 'Because' }] }))
      }
      task = api.generateAllLessonsInBackground('adaptive')
      await task
      assert.deepEqual(limits, [4096, 8192, 8192])
      assert(current().lessons[0].content)
      assert.equal(current().lessons[0].generationError, undefined)
      assert.deepEqual(current().lessons[1], preserved)
      const savedBudget = structuredClone(current().lessons[0].generationBudget)
      await realStore.persist.rehydrate()
      assert.deepEqual(current().lessons[0].generationBudget, savedBudget)
      let optimizeCalls = 0
      global.fetch = async (_url, options) => {
        limits.push(JSON.parse(options.body).max_tokens)
        return ++optimizeCalls <= 2 ? truncated() : completion(designedLesson({ explanation: 'Optimized', quiz: [{ type: 'short', question: 'New scenario with competing events', answer: 'New answer', explanation: 'Reason' }] }))
      }
      const jobId = realStore.getState().beginOptimization('adaptive', 'single', 'adaptive-lesson')
      api.resumeCourseOptimization('adaptive')
      await waitFor(() => current().optimizationJob?.status === 'completed')
      assert.equal(current().optimizationJob.id, jobId)
      assert.deepEqual(limits.slice(-3), [8192, 16384, 32768])
      assert.equal(current().lessons[0].generationBudget.maxTokens, 32768)
      assert.equal(current().lessons[0].previousContent.explanation, 'Recovered')
      assert.equal(current().lessons[0].content.explanation, 'Optimized')
      assert.deepEqual(current().lessons[1], preserved)
      assert.equal(current().progress.completedLessons, 1)
    } finally {
      api.cancelLessonGeneration('adaptive'); await task
      global.fixtureAiSettings = undefined
      Object.defineProperty(global, 'fixtureCourseState', { configurable: true, writable: true, value: { courses: [] } })
    }
  })

  await test('full-mode output can escalate too; providers/models and malformed saved values stay isolated', async () => {
    const point = { id: 'full-adaptive', title: 'Large topic', description: 'Source', priority: 'must' }
    const savedBudget = { key: 'deepseek:deepseek-flash:concise', maxTokens: 32768 }
    assert.equal(api.lessonOutputPolicy(point, 'deepseek', 'deepseek-flash', true, { savedBudget }).maxTokens, 32768)
    assert.equal(api.lessonOutputPolicy(point, 'deepseek', 'deepseek-v4-pro', false, { savedBudget }).maxTokens, 8192)
    assert.equal(api.lessonOutputPolicy(point, 'zhipu', 'glm-5.3', true, { savedBudget }).maxTokens, 8192)
    for (const maxTokens of [NaN, Infinity, -1]) assert.equal(api.lessonOutputPolicy(point, 'deepseek', 'deepseek-flash', true, { savedBudget: { ...savedBudget, maxTokens } }).maxTokens, 8192)
    assert.equal(api.lessonOutputPolicy(point, 'deepseek', 'deepseek-flash', true, { savedBudget: { ...savedBudget, maxTokens: Number.MAX_SAFE_INTEGER } }).maxTokens, 393216)
    assert.equal(api.lessonOutputCeiling('zhipu', 'glm-5.3'), 131072)
    assert.equal(api.lessonOutputCeiling('zhipu', 'glm-4.5'), 98304)
    assert.equal(api.nextLessonOutputLimit(65536, 98304), 98304)
    assert.equal(api.nextLessonOutputLimit(98304, 98304), 98304)
    assert.equal(api.lessonOutputCeiling('deepseek', 'unknown-model'), 393216)
    assert.equal(api.lessonOutputCeiling('custom:opencode', 'deepseek-v4.1-flash'), 393216)
    assert.equal(api.lessonOutputCeiling('custom', 'unknown-model'), 393216)
    assert.equal(api.lessonOutputCeiling('zhipu', 'unknown-model'), 131072)
    assert.equal(api.nextLessonOutputLimit(8192, api.lessonOutputCeiling('custom:opencode', 'deepseek-v4.1-flash')), 16384)
    const openCodeBudget = { key: 'custom:opencode:deepseek-v4.1-flash:concise', maxTokens: 8192 }
    assert.equal(api.lessonOutputPolicy(point, 'custom:opencode', 'deepseek-v4.1-flash', true, { savedBudget: openCodeBudget }).maxTokens, 8192)
    assert.equal(api.lessonOutputPolicy(point, 'custom:opencode', 'deepseek-v4.1-flash', true, {
      savedBudget: openCodeBudget, previousError: '已达到当前模型/接口输出上限 8192 tokens，仍被截断',
    }).maxTokens, 16384)
    global.fixtureAiSettings = { economyLessons: false, model: 'deepseek-v4-pro' }
    const bodies = []
    try {
      global.fetch = async (_url, options) => {
        bodies.push(JSON.parse(options.body))
        return bodies.length === 1
          ? new Response(JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }), { headers: { 'content-type': 'application/json' } })
          : completion(designedLesson({ explanation: 'Full content', quiz: [{ type: 'short', question: 'Concrete task', answer: 'Answer', explanation: 'Reason' }] }))
      }
      await api.generateLessonContent(point, 'Source', undefined, '', [], { savedBudget })
      assert.deepEqual(bodies.map(body => body.max_tokens), [8192, 16384])
      assert(bodies.every(body => body.model === 'deepseek-v4-pro'))
    } finally { global.fixtureAiSettings = undefined }
  })

  await test('truncation does not grant endless retries for malformed JSON or authentication failures', async () => {
    global.fixtureAiSettings = { economyLessons: true }
    const point = { id: 'mixed-errors', title: 'Topic', description: 'Source', priority: 'must' }
    const bodies = []
    const truncated = () => new Response(JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }), { headers: { 'content-type': 'application/json' } })
    try {
      global.fetch = async (_url, options) => {
        bodies.push(JSON.parse(options.body))
        return bodies.length === 1 ? truncated() : completion('{invalid JSON')
      }
      await assert.rejects(api.generateLessonContent(point, 'Source'), /JSON/)
      assert.deepEqual(bodies.map(body => body.max_tokens), [8192, 16384, 16384])
      bodies.length = 0
      global.fetch = async (_url, options) => {
        bodies.push(JSON.parse(options.body))
        return bodies.length === 1 ? truncated() : new Response('Unauthorized', { status: 401 })
      }
      await assert.rejects(api.generateLessonContent(point, 'Source'), /401/)
      assert.deepEqual(bodies.map(body => body.max_tokens), [8192, 16384])
      bodies.length = 0
      global.fetch = async (_url, options) => { bodies.push(JSON.parse(options.body)); return truncated() }
      await assert.rejects(api.generateLessonContent(point, 'Source', undefined, '', [], { onBudgetChange: () => { throw new Error('Mock storage full') } }), /Mock storage full/)
      assert.equal(bodies.length, 1, 'do not spend on the next attempt if its recovery checkpoint could not be saved')
      const controller = new AbortController()
      bodies.length = 0
      await assert.rejects(api.generateLessonContent(point, 'Source', controller.signal, '', [], { onBudgetChange: () => controller.abort() }), { name: 'AbortError' })
      assert.equal(bodies.length, 1, 'cancellation between escalation rounds prevents another request')
      bodies.length = 0
      await assert.rejects(api.generateLessonContent(point, 'Source', undefined, '', [], { onBudgetChange: () => { global.fixtureAiSettings = { economyLessons: true, provider: 'zhipu', model: 'glm-5.3' } } }), /设置已改变/)
      assert.equal(bodies.length, 1, 'do not carry a provider-specific raised budget into a switched provider mid-run')
    } finally { global.fixtureAiSettings = undefined }
  })

  await test('long lesson streaming renews the idle deadline instead of failing after 90 total seconds', async () => {
    const originalSetTimeout = global.setTimeout
    const originalClearTimeout = global.clearTimeout
    const deadlines = new Map()
    let now = 0
    global.setTimeout = (callback, delay, ...args) => {
      if (delay !== 90000) return originalSetTimeout(callback, delay, ...args)
      const token = {}
      deadlines.set(token, { expires: now + delay, callback })
      return token
    }
    global.clearTimeout = token => { if (!deadlines.delete(token)) originalClearTimeout(token) }
    const lesson = designedLesson({ explanation: 'A fully streamed lesson', quiz: [{ type: 'short', question: 'Use the example', answer: 'Complete answer', explanation: 'Reason' }] })
    const json = JSON.stringify(lesson)
    let send, finish, requestSignal
    global.fetch = async (_url, options) => {
      requestSignal = options.signal
      return new Response(new ReadableStream({ start(controller) {
        send = content => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`))
        finish = () => { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')); controller.close() }
        send(json.slice(0, 40))
      } }), { headers: { 'content-type': 'text/event-stream' } })
    }
    let task
    try {
      task = api.generateLessonContent({ id: 'idle', title: 'Point', description: 'Source', priority: 'must' }, 'Source')
      await waitFor(() => latest().receivedChars === 40)
      for (const [time, content] of [[80000, json.slice(40, 80)], [160000, json.slice(80)]]) {
        now = time
        for (const deadline of deadlines.values()) if (deadline.expires <= now) deadline.callback()
        assert.equal(requestSignal.aborted, false)
        send(content)
        await waitFor(() => [...deadlines.values()].every(deadline => deadline.expires === now + 90000))
      }
      finish()
      assert.equal((await task).explanation, 'A fully streamed lesson')
      assert.equal(deadlines.size, 0, 'idle timer is cleaned up')
    } finally {
      global.setTimeout = originalSetTimeout
      global.clearTimeout = originalClearTimeout
    }
  })

  await test('all literal translation keys have Chinese and English entries', async () => {
    const ts = require('typescript')
    const keys = new Set()
    function scan(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) scan(file)
        else if (/\.tsx?$/.test(file)) {
          const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
          function visit(node) {
            if (ts.isStringLiteralLike(node) && /^[a-zA-Z]+\.[a-zA-Z][\w.]*$/.test(node.text)) {
              const key = node.text
              // Restrict to dictionary namespaces; avoid CSS, domain names, and file names.
              if (['upload', 'progress', 'service', 'parse'].includes(key.split('.')[0])) keys.add(key)
            }
            ts.forEachChild(node, visit)
          }
          visit(ast)
        }
      }
    }
    scan(path.join(root, 'src'))
    for (const key of keys) for (const lang of ['zh', 'en']) assert.notEqual(api.translate(lang, key), key, `${lang}: missing ${key}`)
    assert.equal(api.translate('zh', 'upload.stepExtract'), '提炼考点')
    console.log(`Checked ${keys.size} upload/progress/service/parse keys in both languages`)
  })

  unsubscribe()
  console.log(`\n${passed} progress regression checks passed; no live API calls.`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
