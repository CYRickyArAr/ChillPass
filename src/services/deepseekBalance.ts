const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance'

export interface DeepSeekBalanceInfo {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

export interface DeepSeekBalance {
  isAvailable: boolean
  balances: DeepSeekBalanceInfo[]
}

/** 使用已保存的 DeepSeek API Key 查询官方账户余额。 */
export async function fetchDeepSeekBalance(
  apiKey: string,
  signal?: AbortSignal,
): Promise<DeepSeekBalance> {
  const key = apiKey.trim()
  if (!key) throw new Error('DeepSeek API Key is missing')

  const response = await fetch(DEEPSEEK_BALANCE_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
    signal,
  })

  if (!response.ok) {
    throw new Error(`DeepSeek balance request failed (${response.status})`)
  }

  const data = await response.json() as {
    is_available?: unknown
    balance_infos?: unknown
  }
  if (!Array.isArray(data.balance_infos)) {
    throw new Error('DeepSeek balance response is invalid')
  }

  const balances = data.balance_infos.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const value = item as Record<string, unknown>
    if (typeof value.currency !== 'string' || typeof value.total_balance !== 'string') return []
    return [{
      currency: value.currency,
      totalBalance: value.total_balance,
      grantedBalance: typeof value.granted_balance === 'string' ? value.granted_balance : '0',
      toppedUpBalance: typeof value.topped_up_balance === 'string' ? value.topped_up_balance : '0',
    }]
  })

  if (balances.length === 0) throw new Error('DeepSeek balance response is empty')
  return { isAvailable: data.is_available === true, balances }
}
