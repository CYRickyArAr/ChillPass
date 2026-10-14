import { Moon, Sun, RotateCcw, ExternalLink } from 'lucide-react'
import { useThemeStore } from '@stores/themeStore'
import { useLanguageStore, LANGUAGES } from '@stores/languageStore'
import { UI_FONT_SCALE_DEFAULT, UI_FONT_SCALE_MIN, UI_FONT_SCALE_MAX, UI_FONT_SCALE_STEP, useSettingsStore } from '@stores/settingsStore'
import { useOnboardingStore } from '@stores/onboardingStore'
import { useT } from '../i18n'
import packageJson from '../../package.json'
import styles from './settings/SettingsDialog.module.css'

export default function SettingsPage({ onClose }: { onClose?: () => void }) {
  const theme = useThemeStore(s => s.theme)
  const setTheme = useThemeStore(s => s.setTheme)
  const language = useLanguageStore(s => s.language)
  const setLanguage = useLanguageStore(s => s.setLanguage)
  const settings = useSettingsStore()
  const restartGuide = useOnboardingStore(s => s.restartGuide)
  const t = useT()
  return <div className={styles.general}>
    <section className={styles.intro}>
      <h2>常规</h2>
      <p>ChillPass，让课件变成可以一步步完成的学习任务。</p>
      <p className={styles.muted}>课程、学习进度与对话保存在本机。AI 请求由你选择的模型服务处理。</p>
      <div className={styles.actions} style={{ marginTop: 10 }}>
        <span className={styles.button}>版本 {packageJson.version}</span>
        <a className={styles.button} href="https://github.com/CYRickyArAr/ChillPass" target="_blank" rel="noreferrer">项目地址 <ExternalLink size={14} /></a>
      </div>
    </section>
    <div className={styles.generalColumns}>
      <section className={styles.section}>
        <h3>{t('settings.appearance')}</h3>
        <div className={styles.segmented} aria-label={t('settings.theme')}>
          <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={21} />{t('settings.themeLight')}</button>
          <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={21} />{t('settings.themeDark')}</button>
        </div>
        <div className={styles.row}>
          <label htmlFor="settings-font-size">{t('settings.uiFontSize')}</label>
          <div className={styles.actions}>
            <span className={styles.muted}>{Math.round(settings.uiFontScale * 100)}%</span>
            <button className={styles.iconButton} type="button" onClick={() => settings.setUiFontScale(UI_FONT_SCALE_DEFAULT)} title={t('settings.uiFontSizeReset')} aria-label={t('settings.uiFontSizeReset')}><RotateCcw size={17} /></button>
          </div>
        </div>
        <input id="settings-font-size" className={styles.range} type="range" min={UI_FONT_SCALE_MIN} max={UI_FONT_SCALE_MAX} step={UI_FONT_SCALE_STEP} value={settings.uiFontScale} onChange={event => settings.setUiFontScale(Number(event.target.value))} />
        <p className={styles.muted} title={t('settings.uiFontSizeDesc')}>调整整个应用的文字大小，立即生效。</p>
        <h3 style={{ marginTop: 10 }}>学习与生成</h3>
        <div className={styles.row}>
          <div className={styles.rowCopy}><span>{t('progress.economyLessons')}</span><small title={t('progress.economyLessonsHint')}>精简单次生成内容，减少模型用量。</small></div>
          <button type="button" role="switch" className={styles.switch} aria-checked={settings.economyLessons} aria-label={t('progress.economyLessons')} onClick={() => settings.setEconomyLessons(!settings.economyLessons)} />
        </div>
        <div className={styles.row}>
          <div className={styles.rowCopy}><span>{t('settings.teacher')}</span><small>{settings.isTeacher ? t('settings.teacherOn') : t('settings.teacherOff')}</small></div>
          <button type="button" role="switch" className={styles.switch} aria-checked={settings.isTeacher} aria-label={t('settings.teacher')} onClick={() => settings.setIsTeacher(!settings.isTeacher)} />
        </div>
      </section>
      <section className={styles.section}>
        <h3>{t('settings.language')}</h3>
        <div className={styles.languageList}>
          {LANGUAGES.map(item => <label className={styles.language} key={item.code}>
            <input type="radio" name="settings-language" checked={language === item.code} onChange={() => setLanguage(item.code)} />
            <span>{item.label}</span><code>{item.code}</code>
          </label>)}
        </div>
        <h3 style={{ marginTop: 10 }}>使用帮助</h3>
        <div className={styles.row}>
          <div className={styles.rowCopy}><span>{t('settings.reviewGuide')}</span><small>{t('settings.reviewGuideDesc')}</small></div>
          <button type="button" className={styles.button} onClick={() => { onClose?.(); restartGuide() }}>查看引导</button>
        </div>
      </section>
    </div>
    <p className={styles.muted}>常规选项即时生效，无需保存。</p>
  </div>
}
