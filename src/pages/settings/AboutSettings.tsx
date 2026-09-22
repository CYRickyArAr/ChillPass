import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  MessageCircle,
  Copy,
  Check,
} from 'lucide-react'
import { useT } from '../../i18n'
import styles from './SettingsSub.module.css'

export default function AboutSettings() {
  const navigate = useNavigate()
  const t = useT()

  const [copied, setCopied] = useState(false)

  const handleCopyWechat = () => {
    navigator.clipboard.writeText('Eikawa_Koi').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div className={styles.subPage}>
      <header className={styles.subHeader}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => navigate('/settings')}
          aria-label={t('about.backToSettings')}
        >
          <ArrowLeft size={18} strokeWidth={2} />
        </button>
        <div className={styles.headerText}>
          <h1 className={styles.title}>{t('settings.about')}</h1>
          <p className={styles.subtitle}>{t('about.subtitle')}</p>
        </div>
      </header>

      {/* 应用信息 */}
      <section className={`liquid-glass ${styles.card}`}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>{t('about.appInfo')}</h2>
        </div>

        <div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>{t('about.appName')}</span>
            <span className={styles.infoValue}>ChillPass</span>
          </div>
        </div>
      </section>

      {/* 加入我们 */}
      <section className={`liquid-glass ${styles.card}`}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>{t('about.joinUs')}</h2>
          <p className={styles.cardDesc}>{t('about.joinUsDesc')}</p>
        </div>

        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>{t('about.wechat')}</span>
          <span className={styles.infoValue} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <MessageCircle size={16} strokeWidth={2} />
            Eikawa_Koi
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleCopyWechat}
              style={{ marginLeft: 8, padding: '6px 14px', fontSize: 14 }}
            >
              {copied ? (
                <>
                  <Check size={14} strokeWidth={2} />
                  {t('about.copied')}
                </>
              ) : (
                <>
                  <Copy size={14} strokeWidth={2} />
                  {t('about.copy')}
                </>
              )}
            </button>
          </span>
        </div>
      </section>
    </div>
  )
}
