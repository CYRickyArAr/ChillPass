import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Key,
  HardDrive,
  Info,
  ChevronRight,
  Sparkles,
  Sun,
  Moon,
  Globe,
  Check,
  Briefcase,
  Info as InfoIcon,
  GraduationCap,
  Type,
} from 'lucide-react'
import { useCourseStore } from '@stores/courseStore'
import { useThemeStore } from '@stores/themeStore'
import { useLanguageStore, LANGUAGES } from '@stores/languageStore'
import {
  UI_FONT_SCALE_DEFAULT,
  UI_FONT_SCALE_MAX,
  UI_FONT_SCALE_MIN,
  UI_FONT_SCALE_STEP,
  useSettingsStore,
} from '@stores/settingsStore'
import { useOnboardingStore } from '@stores/onboardingStore'
import type { Language } from '@stores/languageStore'
import { useT } from '../i18n'
import type { TranslationKey } from '../i18n'
import styles from './SettingsPage.module.css'

export default function SettingsPage() {
  const navigate = useNavigate()
  const courses = useCourseStore(s => s.courses)

  const theme = useThemeStore(s => s.theme)
  const setTheme = useThemeStore(s => s.setTheme)
  const language = useLanguageStore(s => s.language)
  const setLanguage = useLanguageStore(s => s.setLanguage)
  const isTeacher = useSettingsStore(s => s.isTeacher)
  const setIsTeacher = useSettingsStore(s => s.setIsTeacher)
  const uiFontScale = useSettingsStore(s => s.uiFontScale)
  const setUiFontScale = useSettingsStore(s => s.setUiFontScale)
  const restartGuide = useOnboardingStore(s => s.restartGuide)
  const t = useT()

  const [pendingLang, setPendingLang] = useState<Language>(language)
  const [langApplied, setLangApplied] = useState(false)
  const fontScalePercent = Math.round(uiFontScale * 100)

  const handleApplyLanguage = () => {
    setLanguage(pendingLang)
    setLangApplied(true)
    window.setTimeout(() => setLangApplied(false), 2000)
  }

  // 统计数据
  const totalCourses = courses.filter(b => b.course.status === 'ready').length
  const totalFiles = courses.reduce((sum, b) => sum + b.course.files.length, 0)

  const navCards: { path: string; icon: typeof Key; titleKey: TranslationKey; descKey: TranslationKey }[] = [
    {
      path: '/settings/api',
      icon: Key,
      titleKey: 'settings.api',
      descKey: 'settings.apiDesc',
    },
    {
      path: '/settings/storage',
      icon: HardDrive,
      titleKey: 'settings.storage',
      descKey: 'settings.storageDesc',
    },
    {
      path: '/settings/about',
      icon: Info,
      titleKey: 'settings.about',
      descKey: 'settings.aboutDesc',
    },
  ]

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('settings.title')}</h1>
        <p className={styles.subtitle}>{t('settings.subtitle')}</p>
      </header>

      {/* 1. 应用信息卡片 */}
      <section className={`liquid-glass ${styles.card}`}>
        <div className={styles.appInfoTop}>
          <div className={styles.appLogo}>
            <Sparkles size={24} strokeWidth={1.8} />
          </div>
          <div className={styles.appInfoText}>
            <h2 className={styles.appName}>ChillPass</h2>
            <p className={styles.appDesc}>{t('settings.appDesc')}</p>
          </div>
        </div>

        <div className={styles.statRow}>
          <div className={styles.statItem}>
            <span className={styles.statNum}>{totalCourses}</span>
            <span className={styles.statLabel}>{t('settings.statsCourses')}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statNum}>{totalFiles}</span>
            <span className={styles.statLabel}>{t('settings.statsFiles')}</span>
          </div>
        </div>
      </section>

      {/* 2. 本地信息卡片 */}
      <section className={`liquid-glass ${styles.card}`}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>{t('settings.localInfo')}</h2>
          <p className={styles.cardDesc}>{t('settings.localInfoDesc')}</p>
        </div>
        <div className={styles.localInfoContent}>
          <InfoIcon size={20} strokeWidth={1.8} className={styles.localInfoIcon} />
          <div className={styles.localInfoText}>
            <span className={styles.localInfoTitle}>{t('settings.localDataTitle')}</span>
            <span className={styles.localInfoDesc}>{t('settings.localDataDesc')}</span>
          </div>
          <button className={styles.localInfoBtn} onClick={() => navigate('/settings/storage')}>
            <HardDrive size={16} strokeWidth={2} />
            {t('settings.storage')}
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </div>
      </section>

      {/* 3. 外观与语言 */}
      <section className={`liquid-glass ${styles.card}`}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>{t('settings.appearance')}</h2>
          <p className={styles.cardDesc}>{t('settings.appearanceDesc')}</p>
        </div>

        <div className={styles.appearanceRow}>
          <span className={styles.appearanceLabel}>
            <Sun size={16} strokeWidth={2} />
            {t('settings.theme')}
          </span>
          <div className={styles.themeToggle}>
            <button
              type="button"
              className={`${styles.themeOption} ${theme === 'light' ? styles.themeOptionActive : ''}`}
              onClick={() => setTheme('light')}
            >
              <Sun size={14} strokeWidth={2} />
              {t('settings.themeLight')}
            </button>
            <button
              type="button"
              className={`${styles.themeOption} ${theme === 'dark' ? styles.themeOptionActive : ''}`}
              onClick={() => setTheme('dark')}
            >
              <Moon size={14} strokeWidth={2} />
              {t('settings.themeDark')}
            </button>
          </div>
        </div>

        <div className={styles.appearanceRow}>
          <span className={styles.appearanceLabel}>
            <Globe size={16} strokeWidth={2} />
            {t('settings.language')}
          </span>
          <div className={styles.langGrid}>
            {LANGUAGES.map(lang => (
              <button
                key={lang.code}
                type="button"
                className={`${styles.langOption} ${pendingLang === lang.code ? styles.langOptionActive : ''}`}
                onClick={() => setPendingLang(lang.code)}
              >
                <span className={styles.langFlag}>{lang.flag}</span>
                <span className={styles.langLabel}>{lang.label}</span>
              </button>
            ))}
          </div>
        </div>

        {pendingLang !== language && (
          <div className={styles.langApplyRow}>
            {langApplied && (
              <span className={styles.langAppliedHint}>{t('settings.applied')}</span>
            )}
            <button
              type="button"
              className={styles.langApplyBtn}
              onClick={handleApplyLanguage}
            >
              <Check size={15} strokeWidth={2.4} />
              {t('settings.applyLanguage')}
            </button>
          </div>
        )}

        <div className={styles.appearanceRow}>
          <span className={styles.appearanceLabel}>
            <Type size={16} strokeWidth={2} />
            {t('settings.uiFontSize')}
          </span>
          <div className={styles.fontSizeControl}>
            <input
              className={styles.fontSizeSlider}
              type="range"
              min={UI_FONT_SCALE_MIN}
              max={UI_FONT_SCALE_MAX}
              step={UI_FONT_SCALE_STEP}
              value={uiFontScale}
              aria-label={t('settings.uiFontSize')}
              onChange={(event) => setUiFontScale(Number(event.currentTarget.value))}
            />
            <span className={styles.fontSizeValue}>{fontScalePercent}%</span>
            <button
              type="button"
              className={styles.fontSizeReset}
              onClick={() => setUiFontScale(UI_FONT_SCALE_DEFAULT)}
              disabled={uiFontScale === UI_FONT_SCALE_DEFAULT}
            >
              {t('settings.uiFontSizeReset')}
            </button>
          </div>
        </div>
        <p className={styles.fontSizeDesc}>{t('settings.uiFontSizeDesc')}</p>
      </section>

      {/* 4. 新手引导重看入口 */}
      <section className={`liquid-glass ${styles.card}`}>
        <div className={styles.localInfoContent}>
          <GraduationCap size={20} strokeWidth={1.8} className={styles.localInfoIcon} />
          <div className={styles.localInfoText}>
            <span className={styles.localInfoTitle}>{t('settings.reviewGuide')}</span>
            <span className={styles.localInfoDesc}>{t('settings.reviewGuideDesc')}</span>
          </div>
          <button
            className={styles.localInfoBtn}
            onClick={() => {
              restartGuide()
              navigate('/')
            }}
          >
            {t('settings.reviewGuide')}
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </div>
      </section>

      {/* 5. 导航卡片网格 */}
      <section className={styles.navGrid}>
        {navCards.map(item => {
          const Icon = item.icon
          return (
            <button
              key={item.path}
              className={`liquid-glass ${styles.navCard}`}
              onClick={() => navigate(item.path)}
            >
              <div className={styles.navCardIcon}>
                <Icon size={20} strokeWidth={1.8} />
              </div>
              <div className={styles.navCardText}>
                <span className={styles.navCardTitle}>{t(item.titleKey)}</span>
                <span className={styles.navCardDesc}>{t(item.descKey)}</span>
              </div>
              <ChevronRight size={18} strokeWidth={2} className={styles.navCardArrow} />
            </button>
          )
        })}
        {/* 身份设置卡片 - 点击切换教师模式 */}
        <button
          className={`liquid-glass ${styles.navCard} ${isTeacher ? styles.navCardActive : ''}`}
          onClick={() => setIsTeacher(!isTeacher)}
        >
          <div className={styles.navCardIcon}>
            <Briefcase size={20} strokeWidth={1.8} />
          </div>
          <div className={styles.navCardText}>
            <span className={styles.navCardTitle}>{t('settings.teacher')}</span>
            <span className={styles.navCardDesc}>{isTeacher ? t('settings.teacherOn') : t('settings.teacherOff')}</span>
          </div>
          <div className={styles.teacherToggleSmall}>
            <span className={`${styles.teacherToggleThumbSmall} ${isTeacher ? styles.teacherToggleThumbSmallActive : ''}`} />
          </div>
        </button>
      </section>

    </div>
  )
}
