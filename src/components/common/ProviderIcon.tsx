// Local LobeHub Icons (MIT). See public/notices/lobehub-icons.txt.
const logos: Record<string, string> = {
  chatgpt: new URL('../../assets/providers/openai.svg', import.meta.url).href,
  'opencode-go': new URL('../../assets/providers/opencode.svg', import.meta.url).href,
  deepseek: new URL('../../assets/providers/deepseek.svg', import.meta.url).href,
  zhipu: new URL('../../assets/providers/zhipu.svg', import.meta.url).href,
  qwen: new URL('../../assets/providers/qwen.svg', import.meta.url).href,
  kimi: new URL('../../assets/providers/kimi.svg', import.meta.url).href,
  doubao: new URL('../../assets/providers/doubao.svg', import.meta.url).href,
  minimax: new URL('../../assets/providers/minimax.svg', import.meta.url).href,
  hunyuan: new URL('../../assets/providers/hunyuan.svg', import.meta.url).href,
  baidu: new URL('../../assets/providers/baidu.svg', import.meta.url).href,
  baichuan: new URL('../../assets/providers/baichuan.svg', import.meta.url).href,
  stepfun: new URL('../../assets/providers/stepfun.svg', import.meta.url).href,
  yi: new URL('../../assets/providers/yi.svg', import.meta.url).href,
  siliconflow: new URL('../../assets/providers/siliconcloud.svg', import.meta.url).href,
}

/** A monochrome brand mark follows the surrounding light/dark theme automatically. */
export default function ProviderIcon({ provider, name, size = 24 }: { provider: string; name?: string; size?: number }) {
  const url = logos[provider]
  return <span aria-hidden="true" data-provider-icon={provider} style={{
    display: 'inline-flex', width: size, height: size, flexShrink: 0, verticalAlign: 'middle',
    alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.65), fontWeight: 600,
    ...(url ? { backgroundColor: 'currentColor', maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")`,
      maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center' } : {}),
  }}>{url ? null : (name || provider).slice(0, 1).toUpperCase()}</span>
}
