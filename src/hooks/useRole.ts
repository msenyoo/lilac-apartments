import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type AppRole = 'admin' | 'committee' | 'auditor'

export function useRole() {
  const [role, setRole]       = useState<AppRole | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setRole(null); setLoading(false); return }
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle()
      setRole((data?.role as AppRole) ?? null)
      setLoading(false)
    })
  }, [])

  return {
    role,
    loading,
    isAdmin:     role === 'admin',
    isCommittee: role === 'committee',
    isAuditor:   role === 'auditor',
    canWrite:    role === 'admin',
    canApprove:  role === 'admin' || role === 'committee',
  }
}
