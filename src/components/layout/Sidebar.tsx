import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Home,
  BookOpen,
  BookX,
  Settings,
  Briefcase,
  ChevronDown,
  ChevronUp,
  FolderPlus,
  Folder,
  Download,
  Trash2,
  Pencil,
  Check,
  X,
  Search,
} from 'lucide-react'
import styles from './Sidebar.module.css'
import { useCourseStore, useCurrentBundle } from '@stores/courseStore'
import { useQuizProgressStore } from '@stores/quizProgressStore'
import { useSettingsStore } from '@stores/settingsStore'
import { useAthenaPanelStore } from '@stores/athenaPanelStore'
import { useT } from '../../i18n'
import type { TranslationKey } from '../../i18n'

const navItems = [
  { path: '/', labelKey: 'nav.dashboard' as TranslationKey, icon: Home },
  { path: '/upload', labelKey: 'nav.upload' as TranslationKey, icon: Download },
  { path: '/lessons', labelKey: 'nav.lessons' as TranslationKey, icon: BookOpen },
  { path: '/wrongbook', labelKey: 'nav.wrongbook' as TranslationKey, icon: BookX },
  { path: '/settings', labelKey: 'nav.settings' as TranslationKey, icon: Settings },
]

const navRouteOrder = ['/', '/upload', '/lessons', '/wrongbook', '/settings', '/teacher']

const courseStatusKeys = {
  empty: 'dashboard.statusEmpty',
  uploaded: 'dashboard.statusUploaded',
  analyzing: 'dashboard.statusAnalyzing',
  ready: 'dashboard.statusReady',
} as const satisfies Record<string, TranslationKey>

type CourseDropPosition = 'before' | 'after'

let pageTransitionCleanupTimer: number | null = null

function getRouteOrder(pathname: string): number {
  const index = navRouteOrder.findIndex(path =>
    path === '/' ? pathname === '/' : pathname.startsWith(path)
  )
  return index === -1 ? 0 : index
}

function getNavigationDirection(currentPath: string, targetPath: string): 'forward' | 'backward' {
  const currentOrder = getRouteOrder(currentPath)
  const targetOrder = getRouteOrder(targetPath)
  if (currentOrder !== targetOrder) return targetOrder < currentOrder ? 'backward' : 'forward'

  const currentDepth = currentPath.split('/').filter(Boolean).length
  const targetDepth = targetPath.split('/').filter(Boolean).length
  return targetDepth < currentDepth ? 'backward' : 'forward'
}

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const bundle = useCurrentBundle()
  const course = bundle?.course
  const progress = bundle?.progress
  const isTeacher = useSettingsStore(s => s.isTeacher)
  const navigationOpen = useAthenaPanelStore(s => s.navigationOpen)
  const t = useT()

  // ── 课程管理（由首页迁移至此：切换 / 重命名 / 删除 / 新建 / 导入课件）──
  const courses = useCourseStore(s => s.courses)
  const currentCourseId = useCourseStore(s => s.currentCourseId)
  const switchCourse = useCourseStore(s => s.switchCourse)
  const renameCourse = useCourseStore(s => s.renameCourse)
  const deleteCourse = useCourseStore(s => s.deleteCourse)
  const clearCourseQuizProgress = useQuizProgressStore(s => s.clearCourse)
  const moveCourse = useCourseStore(s => s.moveCourse)

  const [menuOpen, setMenuOpen] = useState(false)
  const [courseQuery, setCourseQuery] = useState('')
  const [draggedCourseId, setDraggedCourseId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<{ id: string; position: CourseDropPosition } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const visibleCourses = useMemo(() => {
    const query = courseQuery.trim().toLowerCase()
    if (!query) return courses
    return courses.filter(bundle => bundle.course.name.toLowerCase().includes(query))
  }, [courseQuery, courses])

  useEffect(() => {
    if (!navigationOpen) setMenuOpen(false)
  }, [navigationOpen])

  useEffect(() => {
    if (!menuOpen) setCourseQuery('')
  }, [menuOpen])


  /**
   * 侧栏只给即将挂载的新页面标记方向，不再截取两张全尺寸页面快照。
   * React Router 随后同步完成导航，新页面由 CSS 做一次短距离合成动画。
   */
  const handleNavClick = (event: React.MouseEvent<HTMLAnchorElement>, targetPath: string) => {
    const isModifiedClick = event.metaKey || event.altKey || event.ctrlKey || event.shiftKey
    const opensElsewhere = event.currentTarget.target && event.currentTarget.target !== '_self'
    if (event.defaultPrevented || event.button !== 0 || isModifiedClick || opensElsewhere) return
    if (targetPath === '/upload') {
      event.preventDefault()
      navigate('/upload', { state: { importMode: 'append' } })
      return
    }
    if (location.pathname === targetPath) {
      event.preventDefault()
      return
    }

    document.documentElement.dataset.pageTransitionDirection = getNavigationDirection(
      location.pathname,
      targetPath,
    )

    if (pageTransitionCleanupTimer !== null) {
      window.clearTimeout(pageTransitionCleanupTimer)
    }
    pageTransitionCleanupTimer = window.setTimeout(() => {
      delete document.documentElement.dataset.pageTransitionDirection
      pageTransitionCleanupTimer = null
    }, 320)
  }

  // 点击外部或 Esc 关闭课程菜单
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const handleSwitch = (id: string) => {
    switchCourse(id)
    // 点击课程始终进入该课程首页；课程管理保持展开。
    if (location.pathname !== '/') {
      document.documentElement.dataset.pageTransitionDirection = 'backward'
    }
    navigate('/')
  }

  const getDropPosition = (
    event: React.DragEvent<HTMLElement>,
    fallback: CourseDropPosition = 'after',
  ): CourseDropPosition => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.height) return fallback
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }

  const handleCourseDragStart = (event: React.DragEvent<HTMLDivElement>, id: string) => {
    if ((event.target as HTMLElement).closest('[data-no-course-drag="true"]')) {
      event.preventDefault()
      return
    }
    setDraggedCourseId(id)
    setDropHint(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }

  const handleCourseDragOver = (event: React.DragEvent<HTMLDivElement>, targetId: string) => {
    const sourceId = draggedCourseId ?? event.dataTransfer.getData('text/plain')
    if (!sourceId || sourceId === targetId) {
      setDropHint(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropHint({ id: targetId, position: getDropPosition(event) })
  }

  const handleCourseDrop = (event: React.DragEvent<HTMLDivElement>, targetId: string) => {
    event.preventDefault()
    const sourceId = draggedCourseId ?? event.dataTransfer.getData('text/plain')
    if (sourceId && sourceId !== targetId) {
      const position = dropHint?.id === targetId ? dropHint.position : getDropPosition(event)
      moveCourse(sourceId, targetId, position)
    }
    setDraggedCourseId(null)
    setDropHint(null)
  }

  const handleCourseDragEnd = () => {
    setDraggedCourseId(null)
    setDropHint(null)
  }

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(t('dashboard.deleteConfirm').replace('{name}', name))) {
      clearCourseQuizProgress(id)
      deleteCourse(id)
      setMenuOpen(false)
    }
  }


  /** 提交重命名（currentCourseId 可能为 null，做一次收窄） */
  const commitRename = () => {
    if (currentCourseId && renameValue.trim()) {
      renameCourse(currentCourseId, renameValue)
    }
    setRenaming(false)
  }

  return (
    <aside id="app-navigation" className={styles.sidebar} hidden={!navigationOpen}>
      <div className={`${styles.sidebarInner} ${menuOpen ? styles.menuOpen : ''}`}>
        {/* Logo */}
        <div className={styles.logo}>
          <span className={styles.logoText}>ChillPass</span>
        </div>

        {/* 导航 */}
        <nav className={styles.nav}>
          {navItems.map(item => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                onClick={event => handleNavClick(event, item.path)}
                className={({ isActive }) =>
                  `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
                }
              >
                <Icon size={20} strokeWidth={1.8} />
                <span>{t(item.labelKey)}</span>
              </NavLink>
            )
          })}
          {isTeacher && (
            <NavLink
              to="/teacher"
              onClick={event => handleNavClick(event, '/teacher')}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
              }
            >
              <Briefcase size={20} strokeWidth={1.8} />
              <span>{t('sidebar.workspace')}</span>
            </NavLink>
          )}
        </nav>

        {/* 课程管理 + 进度卡片 */}
        {course && (
          <div className={styles.progressCard} ref={menuRef}>
            {/* 课程名：点击展开课程列表 */}
            {renaming ? (
              <div className={styles.renameBar}>
                <input
                  ref={renameInputRef}
                  className={styles.renameInput}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      commitRename()
                    } else if (e.key === 'Escape') {
                      setRenaming(false)
                    }
                  }}
                  onBlur={commitRename}
                  autoFocus
                />
                <button
                  type="button"
                  className={styles.renameConfirm}
                  onClick={commitRename}
                  aria-label={t('common.confirm')}
                >
                  <Check size={13} strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  className={styles.renameCancel}
                  onClick={() => setRenaming(false)}
                  aria-label={t('common.cancel')}
                >
                  <X size={13} strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              <div className={styles.courseRow}>
                <button
                  type="button"
                  className={styles.courseTrigger}
                  onClick={() => setMenuOpen(o => !o)}
                  aria-haspopup="listbox"
                  aria-expanded={menuOpen}
                  title={t('sidebar.courseManage')}
                >
                  <span className={styles.progressCourseName}>{course.name}</span>
                  {menuOpen ? (
                    <ChevronDown size={14} strokeWidth={2.2} />
                  ) : (
                    <ChevronUp size={14} strokeWidth={2.2} />
                  )}
                </button>
                <button
                  type="button"
                  className={styles.courseIconBtn}
                  onClick={() => {
                    setRenameValue(course.name)
                    setRenaming(true)
                    setTimeout(() => renameInputRef.current?.focus(), 0)
                  }}
                  title={t('dashboard.renameCourse')}
                >
                  <Pencil size={12} strokeWidth={2} />
                </button>
              </div>
            )}

            {course.status === 'ready' ? (
              <>
                <div className={styles.progressStats}>
                  <span className={styles.progressNumber}>
                    {progress!.completedLessons}/{progress!.totalLessons}
                  </span>
                  <span className={styles.progressLabel}>{t('nav.levelUnit')}</span>
                </div>
                <div className={styles.progressBar}>
                  <div
                    className={styles.progressFill}
                    style={{
                      width: `${progress!.totalLessons > 0
                        ? (progress!.completedLessons / progress!.totalLessons) * 100
                        : 0}%`
                    }}
                  />
                </div>
              </>
            ) : (
              <div className={styles.progressStatus}>
                <span className={styles.generatingBadge}>{t(courseStatusKeys[course.status])}</span>
              </div>
            )}
            {course.status === 'ready' && bundle!.generatingLessons && (
              <div className={styles.progressStatus}>
                <span className={styles.generatingBadge}>{t('nav.generating')}</span>
              </div>
            )}

            {/* 课程列表与管理操作 */}
            {menuOpen && (
              <div className={styles.courseMenu} role="region" aria-label={t('sidebar.courseManage')}>
                <div className={styles.explorerHeader}>
                  <span>{t('sidebar.courseManage')}</span>
                  <span className={styles.explorerCount}>{courses.length}</span>
                </div>
                <label className={styles.courseSearch}>
                  <Search size={13} strokeWidth={2.1} className={styles.courseSearchIcon} />
                  <input
                    className={styles.courseSearchInput}
                    value={courseQuery}
                    onChange={e => setCourseQuery(e.target.value)}
                    placeholder={t('sidebar.courseSearch')}
                    aria-label={t('sidebar.courseSearch')}
                  />
                </label>
                <div className={styles.courseMenuList} role="list">
                  {visibleCourses.length === 0 ? (
                    <div className={styles.courseEmpty}>{t('sidebar.courseSearchEmpty')}</div>
                  ) : (
                    visibleCourses.map(b => {
                      return (
                        <div
                          key={b.course.id}
                          role="listitem"
                          draggable
                          onDragStart={event => handleCourseDragStart(event, b.course.id)}
                          onDragOver={event => handleCourseDragOver(event, b.course.id)}
                          onDrop={event => handleCourseDrop(event, b.course.id)}
                          onDragEnd={handleCourseDragEnd}
                          className={[
                            styles.courseMenuItem,
                            b.course.id === currentCourseId ? styles.courseMenuItemActive : '',
                            draggedCourseId === b.course.id ? styles.courseMenuItemDragging : '',
                            dropHint?.id === b.course.id && dropHint.position === 'before'
                              ? styles.courseDropBefore
                              : '',
                            dropHint?.id === b.course.id && dropHint.position === 'after'
                              ? styles.courseDropAfter
                              : '',
                          ].filter(Boolean).join(' ')}
                          aria-grabbed={draggedCourseId === b.course.id}
                        >
                          <button
                            type="button"
                            className={styles.courseMenuItemMain}
                            onClick={() => handleSwitch(b.course.id)}
                            title={b.course.name}
                            aria-current={b.course.id === currentCourseId ? 'true' : undefined}
                          >
                            {b.course.id === currentCourseId
                              ? <svg className={styles.courseFolderIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M3 19V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v10Z" fill="var(--bg-elevated)" />
                                  <path d="M3 20 6.5 11H23l-3.5 9Z" fill="var(--bg-elevated)" />
                                </svg>
                              : <Folder className={styles.courseFolderIcon} size={16} strokeWidth={1.7} />}
                            <span className={styles.courseMenuItemName}>{b.course.name}</span>
                          </button>
                          <button
                            type="button"
                            className={styles.courseIconBtn}
                            data-no-course-drag="true"
                            onClick={e => {
                              e.stopPropagation()
                              switchCourse(b.course.id)
                              navigate('/upload', { state: { importMode: 'append', appendCourseId: b.course.id } })
                            }}
                            title={t('nav.upload')}
                            aria-label={t('nav.upload') + '：' + b.course.name}
                          >
                            <Download size={16} strokeWidth={1.8} />
                          </button>
                          <button
                            type="button"
                            className={styles.courseIconBtn + ' ' + styles.courseIconBtnDanger}
                            data-no-course-drag="true"
                            onClick={e => {
                              e.stopPropagation()
                              handleDelete(b.course.id, b.course.name)
                            }}
                            title={t('dashboard.deleteCourse')}
                            aria-label={t('dashboard.deleteCourse') + '：' + b.course.name}
                          >
                            <Trash2 size={16} strokeWidth={1.8} />
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>

                <div className={styles.courseMenuActions}>
                  <button
                    type="button"
                    className={styles.courseMenuBtn}
                    title={t('dashboard.newCourse')}
                    onClick={() => {
                      navigate('/upload', { state: { importMode: 'create' } })
                    }}
                  >
                    <FolderPlus size={16} strokeWidth={1.8} />
                    <span>{t('dashboard.newCourse')}</span>
                  </button>

                </div>
              </div>
            )}
          </div>
        )}
      </div>

    </aside>
  )
}
