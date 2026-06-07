import { Navigate } from 'react-router-dom'
import { useRoleCtx } from '@/contexts/RoleContext'
import OwnerPortalPage from './OwnerPortalPage'

export default function MyFlatPage() {
  const { hasFlatAssigned, loading } = useRoleCtx()
  if (loading) return null
  if (!hasFlatAssigned) return <Navigate to="/dashboard" replace />
  return <OwnerPortalPage />
}
