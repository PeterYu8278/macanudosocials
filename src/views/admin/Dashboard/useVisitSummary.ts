import { useCallback, useEffect, useState } from 'react'
import { getDashboardVisitSummary, type DashboardVisitSummary } from '../../../services/firebase/dashboardVisitStats'

// Scope is part of the state identity so switching stores cannot flash another store's counts.
export function useVisitSummary(userId: string | undefined, isSuperAdmin: boolean, storeId?: string) {
  const scope = userId && (isSuperAdmin || storeId) ? JSON.stringify([userId, isSuperAdmin, storeId]) : null
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<{ scope: string | null; data: DashboardVisitSummary | null; loading: boolean }>({ scope: null, data: null, loading: true })
  const refresh = useCallback(() => setRequest(value => value + 1), [])
  useEffect(() => {
    if (!scope) { setState({ scope, data: null, loading: false }); return }
    let active = true
    let revision = 0
    const load = async (initial = false) => {
      const current = ++revision
      if (initial) setState({ scope, data: null, loading: true })
      try {
        const data = await getDashboardVisitSummary(isSuperAdmin ? undefined : storeId)
        if (active && current === revision) setState({ scope, data, loading: false })
      } catch {
        if (active && current === revision) setState({ scope, data: null, loading: false })
      }
    }
    void load(true)
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60000)
    const onVisibility = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { active = false; revision++; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [scope, isSuperAdmin, storeId, request])
  return { data: state.scope === scope ? state.data : null, loading: !!scope && (state.scope !== scope || state.loading), refresh }
}
