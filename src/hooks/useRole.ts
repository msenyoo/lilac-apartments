import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type AppRole = 'admin' | 'committee' | 'auditor' | 'owner'

export function useRole() {
  const [role, setRole]     = useState<AppRole | null>(null)
  const [flatId, setFlatId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setRole(null); setFlatId(null); setLoading(false); return }
      const [roleRes, profileRes] = await Promise.all([
        supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle(),
        supabase.from('profiles').select('flat_id').eq('id', user.id).maybeSingle(),
      ])
      setRole((roleRes.data?.role as AppRole) ?? null)
      setFlatId(profileRes.data?.flat_id ?? null)
      setLoading(false)
    })
  }, [])

  return {
    role,
    flatId,
    loading,
    isAdmin:         role === 'admin',
    isCommittee:     role === 'committee',
    isAuditor:       role === 'auditor',
    isOwner:         role === 'owner',
    canWrite:        role === 'admin',
    canApprove:      role === 'admin' || role === 'committee',
    hasFlatAssigned: flatId !== null,
  }
}
