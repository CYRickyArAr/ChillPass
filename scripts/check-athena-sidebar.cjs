/* Side-chat regression checks: in-memory data + server-rendered markup, no browser or AI calls. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { StaticRouter } = require('react-router-dom/server')
const { build } = require('esbuild')
const postcss = require('postcss')
const ts = require('typescript')

async function main() {
  const root = path.resolve(__dirname, '..')
  const storage = new Map()
  global.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  }
  global.window = { electronAPI: { platform: 'browser' } }
  global.fetch = () => { throw new Error('Live requests are disabled in these tests') }
  const compiled = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, contents: `
      export * from './src/stores/athenaPanelStore';
      export * from './src/stores/chatStore';
      export * from './src/i18n/translations';
      export { default as Drawer } from './src/components/athena/AthenaDrawer';
      export { default as Chat } from './src/pages/AIChatPage';
      export { default as Sidebar } from './src/components/layout/Sidebar';
      export { default as TitleBar } from './src/components/layout/TitleBar';
      export { default as Controls } from './src/components/athena/AthenaPanelControls';
    ` },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-router-dom', 'zustand/vanilla', 'zustand/middleware'],
    plugins: [{ name: 'isolated-ui-fixtures', setup(b) {
      // Use the real vanilla stores/persistence, but expose the client snapshot to
      // SSR. Zustand's normal SSR hook deliberately renders pre-hydration defaults.
      b.onResolve({ filter: /^zustand$/ }, () => ({ path: 'client-snapshot', namespace: 'zustand-client' }))
      b.onLoad({ filter: /.*/, namespace: 'zustand-client' }, () => ({ contents: `
        import { createStore } from 'zustand/vanilla';
        import { useSyncExternalStore } from 'react';
        const bind = init => {
          const store = createStore(init);
          const hook = (selector = state => state) => selector(useSyncExternalStore(store.subscribe, store.getState, store.getState));
          return Object.assign(hook, store);
        };
        export const create = init => init ? bind(init) : bind;
      ` }))
      b.onResolve({ filter: /@stores\/courseStore$/ }, args => ({ path: args.path, namespace: 'course' }))
      b.onLoad({ filter: /.*/, namespace: 'course' }, () => ({ contents: `
        export const useCourseStore = Object.assign(select => select({ courses: [], currentCourseId: null }), { getState: () => ({ courses: [] }) });
        export const useCurrentBundle = () => null;
      ` }))
      b.onResolve({ filter: /@services\/deepseek$/ }, args => ({ path: args.path, namespace: 'ai' }))
      b.onLoad({ filter: /.*/, namespace: 'ai' }, () => ({ contents: `
        const fail = () => { throw new Error('Unexpected AI call'); };
        export const chatWithAthena = fail, executeTask = fail, summarizeAthenaInsights = fail;
      ` }))
      b.onResolve({ filter: /utils\/markdown$/ }, args => ({ path: args.path, namespace: 'markdown' }))
      b.onLoad({ filter: /.*/, namespace: 'markdown' }, () => ({ contents: `
        export const renderMarkdown = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
      ` }))
      b.onResolve({ filter: /\.module\.css$/ }, args => ({ path: args.path, namespace: 'css' }))
      b.onLoad({ filter: /.*/, namespace: 'css' }, () => ({ contents: `export default new Proxy({}, { get: (_, key) => String(key) })` }))
    } }],
  })
  const load = () => {
    const fixture = new Module(path.join(root, 'scripts', 'sidebar-fixture.cjs'), module)
    fixture.filename = path.join(root, 'scripts', 'sidebar-fixture.cjs')
    fixture.paths = Module._nodeModulePaths(root)
    fixture._compile(compiled.outputFiles[0].text, fixture.filename)
    return fixture.exports
  }
  const html = (Component, props = {}) => renderToStaticMarkup(
    React.createElement(StaticRouter, { location: '/lessons' }, React.createElement(Component, props)),
  )
  let checked = 0
  const test = (label, fn) => { fn(); checked++; console.log(`PASS ${label}`) }
  let api = load()
  const panel = api.useAthenaPanelStore
  const chat = api.useChatStore
  test('Default layout keeps navigation visible and chat collapsed', () => {
    assert.equal(panel.getState().navigationOpen, true)
    assert.equal(panel.getState().isOpen, false)
    assert.equal(panel.getState().isExpanded, false)
  })
  test('Left and right toggles are independent', () => {
    panel.getState().toggleNavigation()
    panel.getState().toggle()
    assert.equal(panel.getState().navigationOpen, false)
    assert.equal(panel.getState().isOpen, true)
    panel.getState().toggleNavigation()
    assert.equal(panel.getState().isOpen, true)
  })
  test('Prefill is consumed once and regular open preserves the draft', () => {
    panel.getState().open('Explain this question')
    assert.equal(panel.getState().consumePrefill(), 'Explain this question')
    assert.equal(panel.getState().consumePrefill(), null)
    panel.getState().setDraft('Unsent question')
    panel.getState().open()
    assert.equal(panel.getState().draft, 'Unsent question')
  })
  test('Closing does not clear pending prefill or draft', () => {
    panel.getState().open('Another question')
    panel.getState().close()
    assert.equal(panel.getState().pendingPrefill, 'Another question')
    assert.equal(panel.getState().draft, 'Unsent question')
  })
  test('Panel and navigation states are restored by a fresh store', () => {
    panel.getState().open()
    panel.getState().toggleNavigation()
    const restored = load().useAthenaPanelStore.getState()
    assert.equal(restored.isOpen, true)
    assert.equal(restored.navigationOpen, false)
    assert.equal(restored.draft, 'Unsent question')
    assert.equal(typeof restored.toggle, 'function')
  })
  test('Closing does not stop a stream or delete conversation data', () => {
    chat.getState().addMessage('user', 'Saved question')
    chat.getState().addMessage('assistant', 'Saved answer')
    chat.getState().setStreaming(true)
    const before = JSON.stringify(chat.getState().conversations)
    panel.getState().close()
    assert.equal(chat.getState().isStreaming, true)
    assert.equal(JSON.stringify(chat.getState().conversations), before)
    chat.getState().setStreaming(false)
  })
  test('A reply updates its original conversation even if active conversation changed', () => {
    const conversationId = chat.getState().currentId
    const messageId = chat.getState().addMessage('assistant', '')
    const otherId = chat.getState().createConversation()
    chat.getState().updateMessage(messageId, 'Finished in background', conversationId)
    assert.equal(chat.getState().getMessages().length, 0)
    assert.equal(chat.getState().conversations.find(c => c.id === conversationId).messages.at(-1).content, 'Finished in background')
    chat.getState().switchConversation(conversationId)
    assert.notEqual(otherId, conversationId)
  })
  test('Refresh preserves existing conversation content', () => {
    api = load()
    assert.match(JSON.stringify(api.useChatStore.getState().conversations), /Saved question/)
    assert.match(JSON.stringify(api.useChatStore.getState().conversations), /Finished in background/)
  })
  test('Collapsed chat has no focusable message input before first open', () => {
    const markup = html(api.Drawer)
    assert.match(markup, /id="athena-side-chat"[^>]*hidden=""/)
    assert.doesNotMatch(markup, /<textarea/)
  })
  test('Open chat owns the panel toggle and fullscreen button inside its header', () => {
    api.useAthenaPanelStore.getState().open()
    api = load()
    const markup = html(api.Drawer)
    assert.match(markup, /Saved question/)
    assert.match(markup, /Saved answer/)
    assert.match(markup, /Unsent question/)
    assert.match(markup, /<header[\s\S]*id="athena-panel-toggle"[\s\S]*<\/header>/)
    assert.equal((markup.match(/id="athena-panel-toggle"/g) || []).length, 1)
    assert.match(markup, /收起 Athena 侧边聊天/)
    assert.match(markup, /全屏显示/)
    assert.match(markup, /aria-pressed="false"/)
    assert.ok(markup.includes(api.translate('zh', 'athena.newChat')))
    assert.match(markup, /aria-haspopup="listbox"/)
    assert.match(markup, /accept="image\/\*"/)
    assert.doesNotMatch(markup, /打开完整聊天页|href="\/chat"/)
  })
  test('Fullscreen keeps navigation, conversation, draft and active streaming unchanged', () => {
    const state = api.useAthenaPanelStore
    const messages = api.useChatStore
    messages.getState().setStreaming(true)
    const before = JSON.stringify(messages.getState().conversations)
    const navBefore = state.getState().navigationOpen
    const draftBefore = state.getState().draft
    state.getState().toggleExpanded()
    assert.equal(state.getState().isExpanded, true)
    assert.equal(state.getState().isOpen, true)
    assert.equal(state.getState().navigationOpen, navBefore)
    assert.equal(state.getState().draft, draftBefore)
    assert.equal(messages.getState().isStreaming, true)
    assert.equal(JSON.stringify(messages.getState().conversations), before)
    const markup = html(api.Drawer)
    assert.match(markup, /drawerExpanded/)
    assert.match(markup, /退出全屏/)
    assert.match(markup, /aria-pressed="true"/)
    assert.equal((markup.match(/id="athena-panel-toggle"/g) || []).length, 1)
    messages.getState().setStreaming(false)
  })
  test('Refresh restores expanded chat; exit returns to the open side panel', () => {
    api = load()
    assert.equal(api.useAthenaPanelStore.getState().isExpanded, true)
    assert.equal(api.useAthenaPanelStore.getState().isOpen, true)
    assert.match(JSON.stringify(api.useChatStore.getState().conversations), /Saved answer/)
    api.useAthenaPanelStore.getState().exitExpanded()
    assert.equal(api.useAthenaPanelStore.getState().isExpanded, false)
    assert.equal(api.useAthenaPanelStore.getState().isOpen, true)
    assert.match(html(api.Drawer), /全屏显示/)
    assert.doesNotMatch(html(api.Drawer), /drawerExpanded/)
  })
  test('Closing fullscreen restores study; reopening starts in side-panel mode', () => {
    const state = api.useAthenaPanelStore
    state.getState().toggleExpanded()
    state.getState().toggle()
    assert.equal(state.getState().isOpen, false)
    assert.equal(state.getState().isExpanded, false)
    assert.doesNotMatch(html(api.Chat, { visible: false }), /id="athena-panel-toggle"/)
    const closedControl = html(api.Controls)
    assert.match(closedControl, /aria-expanded="false"/)
    assert.doesNotMatch(closedControl, /athena-panel-expand"/)
    state.getState().toggleExpanded()
    assert.equal(state.getState().isExpanded, false)
    state.getState().open()
    assert.equal(state.getState().isOpen, true)
    assert.equal(state.getState().isExpanded, false)
  })
  test('Old saved layouts default to side-panel mode without losing the draft', () => {
    const key = 'chillpass-panel-layout'
    const saved = storage.get(key)
    try {
      storage.set(key, JSON.stringify({ version: 0, state: { isOpen: true, navigationOpen: false, draft: 'Old draft' } }))
      const migrated = load().useAthenaPanelStore.getState()
      assert.equal(migrated.isExpanded, false)
      assert.equal(migrated.isOpen, true)
      assert.equal(migrated.draft, 'Old draft')
      storage.set(key, JSON.stringify({ version: 0, state: { isOpen: false, isExpanded: true } }))
      assert.equal(load().useAthenaPanelStore.getState().isExpanded, false)
    } finally { storage.set(key, saved) }
  })
  test('Navigation is collapsible and contains no full-chat entry', () => {
    const markup = html(api.Sidebar)
    assert.match(markup, /id="app-navigation"[^>]*hidden=""/)
    assert.doesNotMatch(markup, /href="\/chat"|>Athena</)
    const titlebar = html(api.TitleBar)
    assert.match(titlebar, /aria-controls="app-navigation" aria-expanded="false"/)
    assert.match(titlebar, /展开导航栏/)
  })
  test('All new labels are translated in both supported languages', () => {
    for (const lang of ['zh', 'en']) {
      for (const key of ['layout.showNavigation', 'layout.hideNavigation', 'athena.showSidebar', 'athena.hideSidebar', 'athena.sidebarDescription', 'athena.expandPanel', 'athena.restorePanel']) {
        assert.notEqual(api.translate(lang, key), key)
      }
    }
  })
  const source = file => fs.readFileSync(path.join(root, file), 'utf8')
  const appTree = ts.createSourceFile('App.tsx', source('src/App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const findNodes = (node, predicate) => {
    const found = []
    const visit = child => {
      if (predicate(child)) found.push(child)
      ts.forEachChild(child, visit)
    }
    visit(node)
    return found
  }
  const classElement = name => findNodes(appTree, node => ts.isJsxElement(node) &&
    node.openingElement.attributes.properties.some(attr => ts.isJsxAttribute(attr) &&
      attr.name.getText(appTree) === 'className' && attr.initializer?.getText(appTree) === `{styles.${name}}`))[0]
  test('Study and chat have separate headers; fullscreen hides rather than unmounts study', () => {
    const shell = classElement('workspaceShell')
    const header = classElement('workspaceHeader')
    const study = classElement('workspace')
    assert.ok(shell && header && study)
    assert.equal(header.parent, study)
    assert.equal(study.parent, shell)
    assert.match(study.openingElement.getText(appTree), /hidden=\{athenaExpanded\}/)
    const drawers = findNodes(appTree, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(appTree) === 'AthenaDrawer')
    assert.equal(drawers.length, 1)
    assert.equal(drawers[0].parent, shell)
    assert.doesNotMatch(drawers[0].getText(appTree), /key=/)
  })
  test('The same control component belongs to study only when chat is closed', () => {
    assert.match(classElement('workspaceHeader').getText(appTree), /!athenaOpen && <AthenaPanelControls \/>/)
    const chatSource = source('src/pages/AIChatPage.tsx')
    const chatTree = ts.createSourceFile('Chat.tsx', chatSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const chatHeader = findNodes(chatTree, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(chatTree) === 'header')[0]
    assert.match(chatHeader.getText(chatTree), /visible && <AthenaPanelControls \/>/)
    const controlsTree = ts.createSourceFile('Controls.tsx', source('src/components/athena/AthenaPanelControls.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const toggles = findNodes(controlsTree, node => ts.isJsxElement(node) &&
      node.openingElement.attributes.properties.some(attr => ts.isJsxAttribute(attr) &&
        attr.name.getText(controlsTree) === 'id' && attr.initializer?.text === 'athena-panel-toggle'))
    assert.equal(toggles.length, 1)
    const toggle = toggles[0]
    const content = toggle.children.filter(node => !ts.isJsxText(node) || node.text.trim())
    assert.equal(content.length, 1)
    assert.ok(ts.isJsxSelfClosingElement(content[0]))
    assert.equal(content[0].tagName.getText(controlsTree), 'PanelRight')
    assert.match(toggle.getText(controlsTree), /toggle\(\)/)
    assert.match(toggle.getText(controlsTree), /aria-expanded=\{isOpen\}/)
    assert.doesNotMatch(source('src/components/athena/AthenaPanelControls.tsx'), /requestFullscreen|exitFullscreen|navigate\(/)
  })
  test('Old /chat bookmarks use a redirect, not a second chat component', () => {
    assert.match(source('src/App.tsx'), /path="\/chat" element=\{<LegacyAthenaRoute \/>\}/)
    assert.doesNotMatch(source('src/App.tsx'), /<AIChatPage/)
    assert.match(source('src/components/athena/AthenaDrawer.tsx'), /<Navigate to="\/" replace/)
  })
  test('Drawer remains mounted after first open; route changes cannot close it', () => {
    const drawer = source('src/components/athena/AthenaDrawer.tsx')
    assert.match(drawer, /\(isOpen \|\| hasOpened\) && <AIChatPage/)
    assert.doesNotMatch(drawer, /chatWithAthena|pathname === '\/chat'|navigate\('/)
    assert.match(source('src/App.tsx'), /<AthenaDrawer \/>/)
  })
  test('Both old entry points now open the panel without navigation', () => {
    assert.match(source('src/pages/WrongBookPage.tsx'), /openAthena\(prefill\)/)
    assert.match(source('src/pages/Dashboard.tsx'), /useAthenaPanelStore.getState\(\).open\(\)/)
    for (const file of ['src/pages/WrongBookPage.tsx', 'src/pages/Dashboard.tsx']) {
      assert.doesNotMatch(source(file), /navigate\('\/chat'/)
    }
  })
  test('Unified sender pins the conversation and respects Chinese IME composition', () => {
    const chatSource = source('src/pages/AIChatPage.tsx')
    assert.match(chatSource, /updateMessage\(assistantId, finalContent, conversationId\)/)
    assert.match(chatSource, /!e.nativeEvent.isComposing/)
    assert.match(chatSource, /getElementById\('athena-panel-toggle'\)\?\.focus/)
  })
  const hasDeclaration = (file, selector, property, value) => {
    let found = false
    postcss.parse(source(file)).walkRules(rule => {
      if (!rule.selector.split(',').map(s => s.trim()).includes(selector)) return
      rule.walkDecls(property, decl => { if (decl.value === value) found = true })
    })
    return found
  }
  test('Hidden panels use display:none so keyboard focus cannot enter them', () => {
    assert.ok(hasDeclaration('src/components/athena/AthenaDrawer.module.css', '.drawer[hidden]', 'display', 'none'))
    assert.ok(hasDeclaration('src/components/layout/Sidebar.module.css', '.sidebar[hidden]', 'display', 'none'))
    assert.ok(hasDeclaration('src/App.module.css', '.workspace[hidden]', 'display', 'none'))
  })
  test('Side chat uses a two-row composer and dark blue user messages', () => {
    assert.ok(hasDeclaration('src/pages/AIChatPage.module.css', '.sideChat .inputWrapper', 'display', 'grid'))
    assert.ok(hasDeclaration('src/pages/AIChatPage.module.css', '[data-theme="dark"] .sideChat .bubbleUser', 'background', '#293f6d'))
  })
  test('Both headers share geometry so the control stays at the same right/top coordinates', () => {
    assert.ok(hasDeclaration('src/App.module.css', '.workspaceShell', 'flex-direction', 'row'))
    assert.ok(hasDeclaration('src/App.module.css', '.workspaceShell', '--workspace-header-height', '54px'))
    assert.ok(hasDeclaration('src/App.module.css', '.workspaceShell', '--workspace-header-inset', '22px'))
    assert.ok(hasDeclaration('src/App.module.css', '.workspaceHeader', 'flex', '0 0 var(--workspace-header-height)'))
    assert.ok(hasDeclaration('src/App.module.css', '.workspaceHeader', 'padding', '0 var(--workspace-header-inset)'))
    assert.ok(hasDeclaration('src/pages/AIChatPage.module.css', '.sideChat .header', 'grid-template-rows', 'var(--workspace-header-height, 54px) auto'))
    assert.ok(hasDeclaration('src/pages/AIChatPage.module.css', '.sideChat .header', 'padding', '0 var(--workspace-header-inset, 22px) 6px 14px'))
    assert.ok(hasDeclaration('src/components/athena/AthenaPanelControls.module.css', '.button', 'width', 'var(--panel-control-size, 34px)'))
    assert.ok(hasDeclaration('src/App.module.css', '.workspaceHeader', 'justify-content', 'space-between'))
    assert.ok(hasDeclaration('src/components/athena/AthenaDrawer.module.css', '.drawer', 'top', '0'))
  })
  test('Expanded drawer fills its workspace and Escape restores the split before closing', () => {
    assert.ok(hasDeclaration('src/components/athena/AthenaDrawer.module.css', '.drawerExpanded', 'flex', '1 1 0'))
    assert.ok(hasDeclaration('src/components/athena/AthenaDrawer.module.css', '.drawerExpanded', 'width', '100%'))
    assert.match(source('src/pages/AIChatPage.tsx'), /if \(isExpanded\) \{\s*exitExpanded\(\)/)
  })
  console.log(`\n${checked} side-chat regression checks passed. No visual inspection or live AI requests.`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
