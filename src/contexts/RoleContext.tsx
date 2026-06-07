import { createContext, useContext, ReactNode } from 'react'
import { useRole, AppRole } from '@/hooks/useRole'

interface RoleContextValue {
  role: AppRole | null
  flatId: string | null
  hasFlatAssigned: boolean
  loading: boolean
  isAdmin: boolean
  isOwner: boolean
  canWrite: boolean
  canApprove: boolean
}

const RoleContext = createContext<RoleContextValue>({
  role: null, flatId: null, hasFlatAssigned: false,
  loading: true, isAdmin: false, isOwner: false, canWrite: false, canApprove: false,
})

export function RoleProvider({ children }: { children: ReactNode }) {
  const value = useRole()
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export const useRoleCtx = () => useContext(RoleContext)
