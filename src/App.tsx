import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { BookOpen, FolderOpen, HardDrive } from 'lucide-react'
import Sidebar from './components/layout/Sidebar'
import AthenaDrawer from './components/athena/AthenaDrawer'
import AthenaPanelControls from './components/athena/AthenaPanelControls'
import OperationProgressCenter from './components/common/OperationProgress'
import TitleBar from './components/layout/TitleBar'
import GlassFilter from './components/common/GlassFilter'
import Background from './components/layout/Background'
import WelcomeModal from './components/onboarding/WelcomeModal'
import { useAuthStore } from './stores/authStore'
import { useCourseStore } from './stores/courseStore'
import { useAthenaPanelStore } from './stores/athenaPanelStore'
import { useOnboardingStore } from './stores/onboardingStore'
import { useSettingsStore } from './stores/settingsStore'
import { generateAllLessonsInBackground } from './services/lessonGenerator'
import { resumeCourseOptimization } from './services/courseOptimizer'
import { setCourseStorageRoot } from './services/browserFileStore'
import { useGlobalBlurActive } from './utils/useGlobalBlur'
import Dashboard from './pages/Dashboard'
import UploadPage from './pages/UploadPage'
import LessonPathPage from './pages/LessonPathPage'
import LessonDetailPage from './pages/LessonDetailPage'
import { LegacyAthenaRoute } from './components/athena/AthenaDrawer'
import WrongBookPage from './pages/WrongBookPage'
import SettingsPage from './pages/SettingsPage'
import TeacherWorkspace from './pages/TeacherWorkspace'
import ApiSettings from './pages/settings/ApiSettings'
import StorageSettings from './pages/settings/StorageSettings'
import AboutSettings from './pages/settings/AboutSettings'
import styles from './App.module.css'
import { useT } from './i18n'

/**
 * 侧栏导航只让新页面做一次短横移；动画结束立即清理临时方向状态。
 * 另外承担「清除残留选区」：页面禁用文本选择后，Ctrl+A 的全选结果无法像
 * 普通网页那样靠点击空白处消除，需要在这里主动清空。
 */
function PageContainer({ children }: { children: React.ReactNode }) {
  const selectionPointerStart = useRef<{ x: number; y: number } | null>(null)

  const handleAnimationEnd = (event: React.AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    delete document.documentElement.dataset.pageTransitionDirection
  }

  const handleSelectionPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    selectionPointerStart.current = { x: event.clientX, y: event.clientY }
  }

  const handleSelectionClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const start = selectionPointerStart.current
    selectionPointerStart.current = null
    if (!start || event.detail > 1) return

    // 拖动是在框选文字，双击是在选词；只有短按才清除之前残留的蓝色选区。
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (moved > 4) return

    const target = event.target
    if (
      target instanceof Element &&
      target.closest('button, a, input, textarea, select, [contenteditable="true"]')
    ) {
      return
    }
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div
      className={styles.pageWrapper}
      onAnimationEnd={handleAnimationEnd}
      onPointerDown={handleSelectionPointerDown}
      onClick={handleSelectionClick}
    >
      {children}
    </div>
  )
}

export default function App() {
  const location = useLocation()
  const ensureAccount = useAuthStore(s => s.ensureAccount)
  const courses = useCourseStore(s => s.courses)
  const currentCourseId = useCourseStore(s => s.currentCourseId)
  const courseName = courses.find(c => c.course.id === currentCourseId)?.course.name
  const athenaOpen = useAthenaPanelStore(s => s.isOpen)
  const athenaExpanded = useAthenaPanelStore(s => s.isOpen && s.isExpanded)
  const apiKey = useSettingsStore(s => s.apiKey)
  const storagePath = useSettingsStore(s => s.storagePath)
  const setStoragePath = useSettingsStore(s => s.setStoragePath)
  const storageLocationConfirmed = useSettingsStore(s => s.storageLocationConfirmed)
  const setStorageLocationConfirmed = useSettingsStore(s => s.setStorageLocationConfirmed)
  const onboardingStage = useOnboardingStore(s => s.stage)
  const forceWelcome = useOnboardingStore(s => s.forceWelcome)
  const t = useT()
  const [storagePromptOpen, setStoragePromptOpen] = useState(false)
  const [storagePromptPath, setStoragePromptPath] = useState('')
  const [storagePromptBusy, setStoragePromptBusy] = useState(false)
  const workspaceTitle = location.pathname.startsWith('/lessons')
    ? courseName || t('nav.lessons')
    : location.pathname.startsWith('/settings') ? t('nav.settings')
    : location.pathname === '/upload' ? t('nav.upload')
    : location.pathname === '/wrongbook' ? t('nav.wrongbook')
    : location.pathname === '/teacher' ? t('sidebar.workspace')
    : t('nav.dashboard')
  // 弹窗打开时显示全局高斯模糊层（内联样式，行为确定）
  const blurActive = useGlobalBlurActive()
  const welcomeVisible =
    onboardingStage === 'welcome' && ((!apiKey && courses.length === 0) || forceWelcome)

  useEffect(() => {
    document.title = t('app.docTitle')
    // 首次使用自动创建本地账号
    ensureAccount()
  }, [t])

  useEffect(() => {
    const resumePersistedOperations = () => {
      // 刷新后恢复所有课程的长任务，而不仅是当前打开的课程。
      for (const bundle of useCourseStore.getState().courses) {
        const job = bundle.optimizationJob
        if (job?.status === 'running') {
          // 批量优化本身会覆盖全部目标关卡，清理旧版本可能遗留的普通生成假状态。
          if (job.kind === 'batch' && bundle.generatingLessons) {
            useCourseStore.getState().setGeneratingLessons(
              false,
              bundle.generationProgress,
              bundle.course.id,
            )
          }
          resumeCourseOptimization(bundle.course.id)
          continue
        }
        // 暂停中的优化任务优先，避免普通生成器与它争抢同一关卡。
        if (job?.status === 'paused') continue
        if (
          bundle.course.status === 'ready' &&
          bundle.generatingLessons &&
          !bundle.generationPaused &&
          bundle.lessons.some(lesson => !lesson.content)
        ) {
          void generateAllLessonsInBackground(bundle.course.id)
        }
      }
    }

    resumePersistedOperations()
    return useCourseStore.persist.onFinishHydration(resumePersistedOperations)
  }, [currentCourseId])

  useEffect(() => {
    if (storageLocationConfirmed || storagePath || welcomeVisible) return
    const api = window.electronAPI
    if (!api?.getCourseStorageRoot || !api?.openDirectoryDialog) return
    let cancelled = false
    api.getCourseStorageRoot()
      .then(path => {
        if (cancelled || !path) return
        setStoragePromptPath(path)
        setStoragePromptOpen(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [storageLocationConfirmed, storagePath, welcomeVisible])

  const confirmDefaultStorage = async () => {
    if (storagePromptBusy) return
    setStoragePromptBusy(true)
    try {
      const root = await setCourseStorageRoot('')
      if (root) setStoragePromptPath(root)
      setStoragePath('')
      setStorageLocationConfirmed(true)
      setStoragePromptOpen(false)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t('storage.localBackendUnavailable'))
    } finally {
      setStoragePromptBusy(false)
    }
  }

  const chooseStorageFolder = async () => {
    if (storagePromptBusy) return
    setStoragePromptBusy(true)
    try {
      const dir = await window.electronAPI?.openDirectoryDialog()
      if (!dir) return
      const root = await setCourseStorageRoot(dir)
      const nextPath = root || dir
      setStoragePath(nextPath)
      setStoragePromptPath(nextPath)
      setStorageLocationConfirmed(true)
      setStoragePromptOpen(false)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t('storage.localBackendUnavailable'))
    } finally {
      setStoragePromptBusy(false)
    }
  }

  return (
    <>
      <GlassFilter />
      <Background />
      {/*
        全局高斯模糊层：位于页面内容之上、侧边栏与弹窗卡片之下。
        必须渲染在 App 层级，确保覆盖所有页面且不受页面滚动容器裁剪。
      */}
      <div
        className={styles.globalBlur}
        style={{ opacity: blurActive ? 1 : 0 }}
        aria-hidden="true"
      />
      <TitleBar />
      <div className={styles.app}>
        <Sidebar />
        <div className={styles.workspaceShell}>
          {/* 全屏只隐藏学习区，不卸载当前关卡或聊天组件。 */}
          <div className={styles.workspace} hidden={athenaExpanded}>
            <header className={styles.workspaceHeader}>
              <div className={styles.workspaceTitle}>
                <BookOpen size={19} strokeWidth={1.7} />
                <span>{workspaceTitle}</span>
              </div>
              <div className={styles.workspaceActions}>
                <OperationProgressCenter />
                {!athenaOpen && <AthenaPanelControls />}
              </div>
            </header>
            <main className={styles.main}>
              <Routes location={location} key={location.pathname}>
                <Route path="/" element={<PageContainer><Dashboard /></PageContainer>} />
                <Route path="/upload" element={<PageContainer><UploadPage /></PageContainer>} />
                <Route path="/lessons" element={<PageContainer><LessonPathPage /></PageContainer>} />
                <Route path="/lessons/:lessonId" element={<PageContainer><LessonDetailPage /></PageContainer>} />
                <Route path="/chat" element={<LegacyAthenaRoute />} />
                <Route path="/teacher" element={<PageContainer><TeacherWorkspace /></PageContainer>} />
                <Route path="/wrongbook" element={<PageContainer><WrongBookPage /></PageContainer>} />
                <Route path="/settings" element={<PageContainer><SettingsPage /></PageContainer>} />
                <Route path="/settings/api" element={<PageContainer><ApiSettings /></PageContainer>} />
                <Route path="/settings/storage" element={<PageContainer><StorageSettings /></PageContainer>} />
                <Route path="/settings/data" element={<Navigate to="/settings/storage" replace />} />
                <Route path="/settings/about" element={<PageContainer><AboutSettings /></PageContainer>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </div>
          <AthenaDrawer />
        </div>
      </div>
      {/* 首次使用欢迎向导 */}
      <WelcomeModal />
      {storagePromptOpen && (
        <div className={styles.storagePromptOverlay} role="dialog" aria-modal="true">
          <div className={`liquid-glass ${styles.storagePrompt}`}>
            <div className={styles.storagePromptIcon}>
              <HardDrive size={26} strokeWidth={1.8} />
            </div>
            <div className={styles.storagePromptText}>
              <h2>{t('storage.firstRunTitle')}</h2>
              <p>{t('storage.firstRunDesc')}</p>
              <div className={styles.storagePromptPath}>
                <FolderOpen size={16} strokeWidth={1.8} />
                <span title={storagePromptPath}>
                  {t('storage.firstRunDefault').replace('{path}', storagePromptPath)}
                </span>
              </div>
            </div>
            <div className={styles.storagePromptActions}>
              <button
                type="button"
                className={styles.storagePromptSecondary}
                onClick={confirmDefaultStorage}
                disabled={storagePromptBusy}
              >
                {t('storage.firstRunUseDefault')}
              </button>
              <button
                type="button"
                className={styles.storagePromptPrimary}
                onClick={chooseStorageFolder}
                disabled={storagePromptBusy}
              >
                {storagePromptBusy ? t('storage.firstRunChoosing') : t('storage.firstRunChoose')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
