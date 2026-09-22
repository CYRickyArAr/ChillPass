import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Language = 'zh' | 'en'

export interface LanguageOption {
  code: Language
  label: string
  flag: string
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'zh', label: '简体中文', flag: '🇨🇳' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
]

const normalizeLanguage = (language: unknown): Language => language === 'en' ? 'en' : 'zh'

interface LanguageState {
  language: Language
  setLanguage: (lang: Language) => void
}

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      language: 'zh',
      setLanguage: (language) => set({ language: normalizeLanguage(language) }),
    }),
    {
      name: 'chillpass-language',
      version: 1,
      migrate: (persisted) => {
        const saved = (persisted ?? {}) as Partial<LanguageState>
        return { ...saved, language: normalizeLanguage(saved.language) }
      },
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<LanguageState>
        return { ...current, ...saved, language: normalizeLanguage(saved.language) }
      },
    }
  )
)
