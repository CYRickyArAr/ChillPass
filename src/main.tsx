import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import 'katex/dist/katex.min.css'
import './styles/global.css'
import { setupElectronMock } from './utils/electronMock'
import { initializeLearningData } from './services/learningDataStorage'

// 非 Electron 环境下注入 Mock API
setupElectronMock()

async function start() {
  const container = document.getElementById('root')!
  container.textContent = '正在校验并加载本地学习数据…'
  try {
    await initializeLearningData()
    const { default: App } = await import('./App')
    ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
    )
  } catch (error) {
    container.style.cssText = 'padding:40px;white-space:pre-wrap;font:16px/1.7 sans-serif'
    container.textContent = `学习数据暂未加载，未使用空数据覆盖原记录。\n${error instanceof Error ? error.message : error}\n请确认本地服务已更新并运行，然后重试。\n`
    const retry = document.createElement('button')
    retry.textContent = '重新加载'
    retry.onclick = () => window.location.reload()
    container.appendChild(retry)
  }
}
void start()
