import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useRoleCtx } from '@/contexts/RoleContext'

// ── Resource catalogue ────────────────────────────────────────────────────────
export type Resource =
  | 'transactions.view'   | 'transactions.upload' | 'transactions.tag' | 'transactions.void'
  | 'dues.view'           | 'dues.export'
  | 'corpus.view'         | 'corpus.manage'
  | 'expenses.view'       | 'expenses.add'        | 'expenses.approve'
  | 'reports.view'        | 'reports.download'
  | 'flats.view'          | 'flats.edit'
  | 'settings.view'       | 'settings.edit'
  | 'announcements.view'  | 'announcements.publish'
  | 'activity.view'       | 'activity.export'
  | 'users.view'          | 'users.manage'

type RolePerms = Record<Resource, boolean>
export type PermissionsMap = { committee: RolePerms; auditor: RolePerms }

// ── Defaults (applied when no DB override exists) ─────────────────────────────
export const DEFAULT_PERMISSIONS: PermissionsMap = {
  committee: {
    'transactions.view':    true,  'transactions.upload': false,
    'transactions.tag':     false, 'transactions.void':   false,
    'dues.view':            true,  'dues.export':         true,
    'corpus.view':          true,  'corpus.manage':       false,
    'expenses.view':        true,  'expenses.add':        false, 'expenses.approve': true,
    'reports.view':         true,  'reports.download':    true,
    'flats.view':           true,  'flats.edit':          false,
    'settings.view':        true,  'settings.edit':       false,
    'announcements.view':   true,  'announcements.publish': false,
    'activity.view':        true,  'activity.export':     false,
    'users.view':           false, 'users.manage':        false,
  },
  auditor: {
    'transactions.view':    true,  'transactions.upload': false,
    'transactions.tag':     false, 'transactions.void':   false,
    'dues.view':            true,  'dues.export':         true,
    'corpus.view':          true,  'corpus.manage':       false,
    'expenses.view':        true,  'expenses.add':        false, 'expenses.approve': false,
    'reports.view':         true,  'reports.download':    true,
    'flats.view':           true,  'flats.edit':          false,
    'settings.view':        true,  'settings.edit':       false,
    'announcements.view':   true,  'announcements.publish': false,
    'activity.view':        true,  'activity.export':     false,
    'users.view':           false, 'users.manage':        false,
  },
}

// ── Fetch / save helpers ──────────────────────────────────────────────────────
export async function fetchPermissions(): Promise<PermissionsMap> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'role_permissions')
    .maybeSingle()
  if (!data?.value) return DEFAULT_PERMISSIONS
  try {
    const parsed = JSON.parse(data.value) as PermissionsMap
    // Merge with defaults so new resources are always present
    return {
      committee: { ...DEFAULT_PERMISSIONS.committee, ...parsed.committee },
      auditor:   { ...DEFAULT_PERMISSIONS.auditor,   ...parsed.auditor   },
    }
  } catch {
    return DEFAULT_PERMISSIONS
  }
}

export async function savePermissions(perms: PermissionsMap): Promise<void> {
  await supabase.from('app_settings').upsert(
    { key: 'role_permissions', value: JSON.stringify(perms) },
    { onConflict: 'key' }
  )
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function usePermissions() {
  const { role } = useRoleCtx()
  const qc = useQueryClient()

  const { data: perms = DEFAULT_PERMISSIONS } = useQuery({
    queryKey: ['role-permissions'],
    queryFn: fetchPermissions,
    staleTime: 5 * 60_000,
  })

  function can(resource: Resource): boolean {
    if (role === 'admin') return true
    if (!role) return false
    const roleKey = role as 'committee' | 'auditor'
    return perms[roleKey]?.[resource] ?? DEFAULT_PERMISSIONS[roleKey]?.[resource] ?? false
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['role-permissions'] })
  }

  return { can, perms, invalidate }
}
