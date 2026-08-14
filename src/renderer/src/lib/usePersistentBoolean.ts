import { useEffect, useState } from 'react'

/**
 * Boolean UI state persisted to localStorage (as '1'/'0') so panel
 * visibility and similar toggles survive app restarts.
 */
export function usePersistentBoolean(
  storageKey: string,
  initial: boolean
): readonly [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved === '1') return true
      if (saved === '0') return false
    } catch {
      // localStorage unavailable — fall back to the default.
    }
    return initial
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, value ? '1' : '0')
    } catch {
      // Persisting is best-effort.
    }
  }, [storageKey, value])

  return [value, setValue] as const
}
