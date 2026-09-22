/* In-memory store + actual page handlers/SSR. No browser, user data, or live AI. */
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const React = require('react')
const runtime = require('react/jsx-runtime')
const { renderToStaticMarkup } = require('react-dom/server')
const { StaticRouter } = require('react-router-dom/server')
const { Routes, Route } = require('react-router-dom')
const { build } = require('esbuild')

async function main() {
  const root = path.resolve(__dirname, '..')
  const storage = new Map()
  global.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  }
  global.fetch = () => { throw new Error('Live requests forbidden') }
  global.quizFixture = { language: 'zh', calls: [], bundle: null }
  const compiled = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, contents: `
      export * from './src/stores/quizProgressStore';
      export * from './src/i18n/translations';
      export { default as Page } from './src/pages/LessonDetailPage';
    ` },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['react', 'react/jsx-runtime', 'react-router-dom', 'zustand/vanilla', 'zustand/middleware'],
    plugins: [{ name: 'quiz-fixtures', setup(b) {
      b.onResolve({ filter: /^zustand$/ }, () => ({ path: 'store', namespace: 'client-store' }))
      b.onLoad({ filter: /.*/, namespace: 'client-store' }, () => ({ contents: `
        import { createStore } from 'zustand/vanilla';
        import { useSyncExternalStore } from 'react';
        const bind = init => {
          const store = createStore(init);
          return Object.assign((selector = s => s) => selector(useSyncExternalStore(store.subscribe, store.getState, store.getState)), store);
        };
        export const create = init => init ? bind(init) : bind;
      ` }))
      b.onResolve({ filter: /@stores\/(courseStore|wrongQuestionStore|languageStore)$/ }, args => ({ path: args.path, namespace: 'stores' }))
      b.onLoad({ filter: /.*/, namespace: 'stores' }, ({ path: name }) => {
        if (name.endsWith('languageStore')) return { contents: `export const useLanguageStore = select => select({ language: globalThis.quizFixture.language });` }
        if (name.endsWith('wrongQuestionStore')) return { contents: `export const useWrongQuestionStore = select => select({ addWrongQuestion: () => {globalThis.quizFixture.calls.push('wrong'); return 'wrong-id'}, removeQuestion: () => globalThis.quizFixture.calls.push('removeWrong') });` }
        return { contents: `
          export const useCurrentBundle = () => globalThis.quizFixture.bundle;
          export const useCourseStore = select => select({ completeLesson: () => globalThis.quizFixture.calls.push('complete'), setLessonContent: () => {throw new Error('Unexpected content rewrite')}, restorePreviousLessonContent: () => false });
        ` }
      })
      b.onResolve({ filter: /(@services\/deepseek|services\/courseOptimizer)$/ }, args => ({ path: args.path, namespace: 'ai' }))
      b.onLoad({ filter: /.*/, namespace: 'ai' }, () => ({ contents: `
        const fail = () => { throw new Error('Unexpected AI request'); };
        export const adjudicateAnswer = fail, adjudicateTextAnswer = fail, gradeAnswer = fail, regenerateQuizQuestion = fail, cancelCourseOptimization = fail, startSingleLessonOptimization = fail;
      ` }))
      b.onResolve({ filter: /@services\/sound$/ }, args => ({ path: args.path, namespace: 'sound' }))
      b.onLoad({ filter: /.*/, namespace: 'sound' }, () => ({ contents: `export const playClickSound = () => {}; export const playCorrectSound = () => globalThis.quizFixture.calls.push('correctSound');` }))
      b.onResolve({ filter: /ReadyLessonNotice$/ }, args => ({ path: args.path, namespace: 'notice' }))
      b.onLoad({ filter: /.*/, namespace: 'notice' }, () => ({ contents: 'export default () => null' }))
      b.onResolve({ filter: /utils\/markdown$/ }, args => ({ path: args.path, namespace: 'markdown' }))
      b.onLoad({ filter: /.*/, namespace: 'markdown' }, () => ({ contents: `export const renderMarkdown = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;'); export const renderInlineMarkdown = renderMarkdown;` }))
      b.onResolve({ filter: /\.module\.css$/ }, args => ({ path: args.path, namespace: 'css' }))
      b.onLoad({ filter: /.*/, namespace: 'css' }, () => ({ contents: 'export default new Proxy({}, { get: (_, key) => String(key) })' }))
    } }],
  })
  let elements = []
  function load() {
    const fixture = new Module(path.join(root, 'scripts/quiz-fixture.cjs'), module)
    fixture.filename = path.join(root, 'scripts/quiz-fixture.cjs')
    fixture.paths = Module._nodeModulePaths(root)
    const originalRequire = fixture.require.bind(fixture)
    fixture.require = name => name === 'react/jsx-runtime' ? {
      ...runtime,
      ...Object.fromEntries(['jsx', 'jsxs'].map(method => [method, (type, props, key) => {
        elements.push({ type, props })
        return runtime[method](type, props, key)
      }])),
    } : originalRequire(name)
    fixture._compile(compiled.outputFiles[0].text, fixture.filename)
    return fixture.exports
  }
  let api = load()
  const questions = [
    { id: 'choice', type: 'choice', question: 'Choose', options: ['A. Wrong', 'B. Right'], correctIndex: 1, explanation: 'Choice explanation' },
    { id: 'multi', type: 'multi', question: 'Select all', options: ['A. First', 'B. Distractor', 'C. Third'], correctIndices: [2, 0], explanation: 'Multi explanation' },
    { id: 'fill', type: 'fill', question: 'Fill', answer: 'positive', explanation: 'Fill explanation' },
    { id: 'short', type: 'short', question: 'Explain Softmax', answer: '$e^3 > e^2 > e^1 > 0$', explanation: 'Normalize by the same positive sum.' },
  ]
  let refs
  function setup(q) {
    global.quizFixture.calls = []
    api.useQuizProgressStore.setState({ byLesson: {}, previousByLesson: {}, archiveOperationByLesson: {} })
    global.quizFixture.bundle = { course: { id: 'c', name: 'Course' }, examPoints: [{ id: 'ep', title: 'Point' }], rawText: '', lessons: [
      { id: 'l', examPointId: 'ep', order: 1, title: 'Lesson', priority: 'must', status: 'available', content: { keyPoints: [], examples: [], explanation: '', quiz: [q, { ...questions[3], id: 'next' }] } },
    ] }
    refs = api.makeQuizQuestionRefs('l', global.quizFixture.bundle.lessons[0].content.quiz)
    api.useQuizProgressStore.getState().setActiveTab('c', 'l', refs, 'quiz')
  }
  function render() {
    elements = []
    return renderToStaticMarkup(React.createElement(StaticRouter, { location: '/lessons/l' },
      React.createElement(Routes, null, React.createElement(Route, { path: '/lessons/:lessonId', element: React.createElement(api.Page) }))))
  }
  const button = () => elements.find(e => e.type === 'button' && e.props['aria-controls'] === 'quiz-reference-answer').props
  const attempt = () => api.useQuizProgressStore.getState().byLesson['c:l'].attempts[refs[0].id]
  const toggle = () => { render(); button().onClick(); return render() }
  let count = 0
  function test(label, run) { run(); console.log(`PASS ${label}`); count++ }
  for (const q of questions) {
    test(`${q.type}: reveal is immediate, neutral, and preserves the existing attempt`, () => {
      setup(q)
      api.useQuizProgressStore.getState().patchAttempt('c', 'l', refs, q.id, { textAnswer: 'My draft', multiSelected: [0] })
      const before = { ...attempt() }
      assert.ok(!render().includes('id="quiz-reference-answer"'))
      assert.equal(button().disabled, false)
      const html = toggle()
      assert.equal(button()['aria-expanded'], true)
      assert.deepEqual(attempt(), { ...before, answerVisible: true })
      assert.match(html, /已看答案/)
      assert.ok(html.includes(q.explanation))
      assert.deepEqual(global.quizFixture.calls, [])
      assert.ok(!html.includes('回答错误'))
      assert.ok(!html.includes('回答正确'))
      if (q.type === 'choice') assert.match(html, /B\. Right/)
      if (q.type === 'multi') { assert.match(html, /A\. First/); assert.match(html, /C\. Third/) }
      if (q.type === 'fill') assert.match(html, /positive/)
      if (q.type === 'short') assert.ok(html.includes('$e^3 &gt;') || html.includes('$e^3 >'))
    })
  }
  test('Collapse hides the reference without clearing the draft or grading', () => {
    const html = toggle()
    assert.equal(attempt().answerVisible, false)
    assert.equal(attempt().textAnswer, 'My draft')
    assert.equal(attempt().solved, false)
    assert.ok(!html.includes('id="quiz-reference-answer"'))
  })
  test('Refresh restores the open reference and the selected question', () => {
    toggle()
    api = load()
    assert.equal(attempt().answerVisible, true)
    assert.match(render(), /已看答案/)
    assert.equal(api.useQuizProgressStore.getState().byLesson['c:l'].currentQuestionId, 'short')
  })
  test('Question navigation isolates visibility and restores it on return', () => {
    api.useQuizProgressStore.getState().setCurrentQuestion('c', 'l', refs, 'next')
    assert.ok(!render().includes('id="quiz-reference-answer"'))
    api.useQuizProgressStore.getState().setCurrentQuestion('c', 'l', refs, 'short')
    assert.match(render(), /已看答案/)
  })
  test('Old saved progress defaults to hidden without losing solved status', () => {
    api.useQuizProgressStore.getState().patchAttempt('c', 'l', refs, 'short', { solved: true })
    const saved = JSON.parse(storage.get(api.QUIZ_PROGRESS_STORAGE_KEY))
    delete saved.state.byLesson['c:l'].attempts.short.answerVisible
    storage.set(api.QUIZ_PROGRESS_STORAGE_KEY, JSON.stringify(saved))
    api = load()
    assert.ok(!render().includes('id="quiz-reference-answer"'))
    api.useQuizProgressStore.getState().syncLesson('c', 'l', refs)
    assert.equal(attempt().answerVisible, false)
    assert.equal(attempt().solved, true)
  })
  test('Reset and new question fingerprints hide the previous answer', () => {
    toggle()
    api.useQuizProgressStore.getState().resetAttempt('c', 'l', refs, 'short')
    assert.equal(attempt().answerVisible, false)
    toggle()
    api.useQuizProgressStore.getState().syncLesson('c', 'l', refs.map(ref => ({ ...ref, fingerprint: 'new' })))
    assert.equal(attempt(), undefined)
  })
  test('Reference-key corrections keep visibility, drafts and archived state', () => {
    setup(questions[3]); toggle()
    api.useQuizProgressStore.getState().archiveLesson('c', 'l')
    const changed = api.makeQuizQuestionRefs('l', global.quizFixture.bundle.lessons[0].content.quiz.map(q => ({ ...q, answer: 'Updated reference' })))
    assert.deepEqual(changed, refs)
    api.useQuizProgressStore.getState().syncLesson('c', 'l', changed)
    assert.equal(attempt().answerVisible, true)
    api.useQuizProgressStore.getState().resetAttempt('c', 'l', refs, 'short')
    api.useQuizProgressStore.getState().restoreArchivedLesson('c', 'l')
    assert.equal(attempt().answerVisible, true)
  })
  test('Viewing after an incorrect attempt does not erase its feedback or wrong-entry ID', () => {
    setup(questions[3])
    const patch = { feedback: { correct: false, status: 'incorrect', text: 'Existing feedback' }, wrongEntryId: 'saved-wrong' }
    api.useQuizProgressStore.getState().patchAttempt('c', 'l', refs, 'short', patch)
    toggle()
    assert.deepEqual(attempt().feedback, patch.feedback)
    assert.equal(attempt().wrongEntryId, 'saved-wrong')
    assert.equal(attempt().solved, false)
    assert.deepEqual(global.quizFixture.calls, [])
  })
  test('Choice answering still works after viewing; only submission marks it correct', () => {
    setup(questions[0]); toggle()
    assert.equal(attempt().choiceSelected, null)
    const options = elements.filter(e => e.type === 'button' && e.props.className === 'quizOption')
    assert.equal(options[1].props.disabled, false)
    options[1].props.onClick()
    assert.equal(attempt().solved, true)
    assert.deepEqual(global.quizFixture.calls, ['correctSound'])
  })
  test('Skip remains available after viewing and advances without an AI request', () => {
    setup(questions[3]); toggle()
    const skip = elements.find(e => e.type === 'button' && e.props.className === 'skipBtn').props
    assert.equal(skip.disabled, false)
    skip.onClick()
    assert.equal(attempt().skipped, true)
    assert.equal(api.useQuizProgressStore.getState().byLesson['c:l'].currentQuestionId, 'next')
    assert.deepEqual(global.quizFixture.calls, [])
  })
  test('Mutation lock disables the control and guards the handler', () => {
    setup(questions[3])
    global.quizFixture.bundle.optimizationJob = { status: 'paused', kind: 'batch', targetLessonIds: ['l'], items: { l: { state: 'pending' } } }
    render(); assert.equal(button().disabled, true); button().onClick()
    assert.equal(attempt(), undefined)
  })
  test('Missing answers and invalid choice indices show a clear fallback, never undefined', () => {
    for (const q of [{ ...questions[3], answer: '' }, { ...questions[0], correctIndex: 99 }]) {
      setup(q)
      const html = toggle()
      assert.match(html, /暂无可用的参考答案/)
      assert.ok(!html.includes('undefined'))
    }
  })
  test('Text questions can use an existing acceptable answer when the primary is missing', () => {
    setup({ ...questions[2], answer: '', acceptableAnswers: ['', 'Alternative'] })
    assert.match(toggle(), /Alternative/)
  })
  test('Both languages have complete answer-control labels', () => {
    for (const language of ['zh', 'en']) {
      for (const key of ['showAnswer', 'hideAnswer', 'answerViewed', 'answerViewHint', 'referenceUnavailable']) {
        assert.notEqual(api.translate(language, `lesson.${key}`), `lesson.${key}`)
      }
    }
    global.quizFixture.language = 'en'
    assert.match(render(), /Answer viewed/)
  })
  console.log(`\n${count} quiz-answer checks passed. No visual checks or live AI calls.`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
