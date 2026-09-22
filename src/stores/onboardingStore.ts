import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 引导阶段：
 * - welcome  尚未开始（满足"新用户"条件时显示欢迎弹窗）
 * - done     引导完成
 * - skipped  用户跳过了引导
 * - active   旧版本悬浮任务卡留下的兼容状态，效果等同于 done
 */
export type OnboardingStage = 'welcome' | 'active' | 'done' | 'skipped'

interface OnboardingState {
  stage: OnboardingStage
  /** 从设置页"重新查看新手引导"进入时强制弹出欢迎弹窗（忽略"已有数据"的拦截） */
  forceWelcome: boolean
  /** 完成全部引导步骤 */
  completeGuide: () => void
  /** 跳过引导 */
  skipGuide: () => void
  /** 从设置页重新查看引导（完整重播欢迎弹窗） */
  restartGuide: () => void
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      stage: 'welcome',
      forceWelcome: false,
      completeGuide: () => set({ stage: 'done', forceWelcome: false }),
      skipGuide: () => set({ stage: 'skipped', forceWelcome: false }),
      restartGuide: () => set({ stage: 'welcome', forceWelcome: true }),
    }),
    {
      name: 'chillpass-onboarding',
    }
  )
)
