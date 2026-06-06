import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Plus, Pencil, Trash2, Shield, Eye, Users, UserCircle, Lock, RefreshCw, Copy, MessageCircle } from 'lucide-react'
import {
  Dialog, DialogContent, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useRoleCtx } from '@/contexts/RoleContext'
import { toast } from 'sonner'
import {
  fetchPermissions, savePermissions, DEFAULT_PERMISSIONS,
  type PermissionsMap, type Resource,
} from '@/hooks/usePermissions'

const ROLE_OPTIONS = [
  { value: 'admin',     label: 'Admin (Treasurer)' },
  { value: 'committee', label: 'Committee' },
  { value: 'auditor',   label: 'Auditor' },
]

function roleTone(role: string) {
  if (role === 'admin')     return 'ds-badge-brand'
  if (role === 'committee') return 'ds-badge-info'
  return 'ds-badge-neutral'
}

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const hue = ((name || '').charCodeAt(0) * 47) % 360
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold shrink-0"
      style={{
        width: size, height: size, fontSize: size * 0.36,
        background: `oklch(0.93 0.05 ${hue})`, color: `oklch(0.45 0.13 ${hue})`,
      }}
    >
      {initials}
    </div>
  )
}

type UsersTab = 'users' | 'permissions'

export default function UsersPage() {
  const { isAdmin } = useRoleCtx()
  const qc = useQueryClient()
  const [tab, setTab]               = useState<UsersTab>('users')
  const [addOpen, setAddOpen]         = useState(false)
  const [editTarget, setEditTarget]   = useState<any | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  const [deleting, setDeleting]       = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['v_users'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_users').select('*').order('created_at', { ascending: false })
      if (error) { console.warn('v_users:', error.message); return [] }
      return data ?? []
    },
  })

  function invalidate() { qc.invalidateQueries({ queryKey: ['v_users'] }) }

  const totals = {
    admin:     (users as any[]).filter(u => u.role === 'admin').length,
    committee: (users as any[]).filter(u => u.role === 'committee').length,
    auditor:   (users as any[]).filter(u => u.role === 'auditor').length,
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-5 fade-in">
        <div>
          <h1 className="text-[24px] font-extrabold">Users & access</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>Admin only</p>
        </div>
        <div className="surface !p-12 text-center">
          <Shield size={36} className="mx-auto mb-3" style={{ color: 'var(--ink-300)' }} />
          <p className="font-semibold" style={{ color: 'var(--ink-600)' }}>Admin access required</p>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ink-400)' }}>Contact the treasurer to manage users.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-extrabold">Users & access</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>
            Create logins, assign roles, control permissions · admin only
          </p>
        </div>
        {tab === 'users' && (
          <button
            className="flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-white font-semibold text-[14px]"
            style={{ background: 'var(--brand-600)' }}
            onClick={() => setAddOpen(true)}
          >
            <Plus size={15} /> Add user
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-[12px] self-start" style={{ background: 'var(--ink-100)' }}>
        {(['users', 'permissions'] as UsersTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-1.5 rounded-[9px] text-[13.5px] font-medium transition-colors capitalize"
            style={tab === t
              ? { background: '#fff', color: 'var(--ink-900)', boxShadow: '0 1px 4px rgba(26,24,32,.10)' }
              : { color: 'var(--ink-500)' }
            }
          >
            {t === 'permissions' ? 'Permissions' : 'Users'}
          </button>
        ))}
      </div>

      {tab === 'permissions' && <PermissionsTab />}

      {tab === 'users' && <>
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {[
          { icon: <Users size={18} />, label: 'Total users', value: users.length, tone: 'brand' },
          { icon: <Shield size={18} />, label: 'Admins', value: totals.admin, tone: 'brand' },
          { icon: <UserCircle size={18} />, label: 'Committee', value: totals.committee, tone: 'info' },
          { icon: <Eye size={18} />, label: 'Auditors', value: totals.auditor, tone: 'neutral' },
        ].map(({ icon, label, value, tone }) => (
          <div key={label} className="surface !p-4 sm:!p-5 flex flex-col gap-3">
            <div
              className="w-9 h-9 rounded-[10px] flex items-center justify-center"
              style={{
                background: tone === 'brand' ? 'var(--brand-50)' : tone === 'info' ? 'var(--info-bg)' : 'var(--ink-100)',
                color: tone === 'brand' ? 'var(--brand-600)' : tone === 'info' ? 'var(--info)' : 'var(--ink-600)',
              }}
            >
              {icon}
            </div>
            <div>
              <p className="text-[12.5px] font-medium leading-tight" style={{ color: 'var(--ink-500)' }}>{label}</p>
              <p className="text-[26px] font-bold leading-tight mt-1 tnum">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Users table */}
      {isLoading ? (
        <div className="surface !p-8 text-center" style={{ color: 'var(--ink-400)' }}>Loading…</div>
      ) : (
        <div className="surface !p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="ds-tbl">
              <thead>
                <tr>
                  {['User', 'Role', 'Last sign-in', ''].map(c => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(users as any[]).map(u => {
                  const loginId = u.auth_email ?? u.email ?? ''
                  const isMobile = loginId.endsWith('@lilac.com')
                  const displayId = isMobile ? loginId.replace('@lilac.com', '') : loginId
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={u.display_name ?? displayId} size={34} />
                          <div className="min-w-0">
                            <p className="font-semibold" style={{ color: 'var(--ink-900)' }}>{u.display_name ?? '—'}</p>
                            <p className="text-[11.5px]" style={{ color: 'var(--ink-400)' }}>{displayId}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`ds-badge ${roleTone(u.role)}`}>{u.role ?? '—'}</span>
                      </td>
                      <td className="text-[12px] mono" style={{ color: 'var(--ink-500)' }}>
                        {u.last_sign_in_at
                          ? new Date(u.last_sign_in_at).toLocaleDateString('en-IN', { dateStyle: 'short' })
                          : 'never'}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditTarget(u)}
                            className="p-1.5 rounded-lg hover:bg-[var(--ink-100)] transition-colors"
                            style={{ color: 'var(--ink-500)' }}
                            title="Edit user"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            onClick={() => { setDeleteError(''); setDeleteTarget(u) }}
                            className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                            style={{ color: 'var(--bad)' }}
                            title="Delete user"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AddUserDialog open={addOpen} onClose={() => setAddOpen(false)} onSuccess={invalidate} />
      <EditUserDialog key={editTarget?.id ?? 'none'} user={editTarget} onClose={() => setEditTarget(null)} onSuccess={invalidate} />

      <AlertDialog open={!!deleteTarget} onOpenChange={v => { if (!v) { setDeleteTarget(null); setDeleteError('') } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{deleteTarget?.display_name ?? deleteTarget?.auth_email}</strong> and revoke their access. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-sm text-red-500 px-1">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={async () => {
                setDeleting(true)
                setDeleteError('')
                try {
                  const { error: fnErr } = await supabase.functions.invoke('delete-user', {
                    body: { userId: deleteTarget.id },
                  })
                  if (fnErr) throw fnErr
                  toast.success(`${deleteTarget.display_name ?? deleteTarget.auth_email} deleted`)
                  setDeleteTarget(null)
                  invalidate()
                } catch (e: any) {
                  setDeleteError(e.message ?? 'Failed to delete user')
                } finally {
                  setDeleting(false)
                }
              }}
            >
              {deleting ? 'Deleting…' : 'Delete user'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </>}
    </div>
  )
}

function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghjkmnpqrstuvwxyz'
  const digits = '23456789'
  const syms = '@#!$'
  const all = upper + lower + digits + syms
  let pw = upper[Math.floor(Math.random() * upper.length)]
         + lower[Math.floor(Math.random() * lower.length)]
         + digits[Math.floor(Math.random() * digits.length)]
         + syms[Math.floor(Math.random() * syms.length)]
  for (let i = 4; i < 12; i++) pw += all[Math.floor(Math.random() * all.length)]
  return pw.split('').sort(() => Math.random() - 0.5).join('')
}

function AddUserDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [phone, setPhone]       = useState('')
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [role, setRole]         = useState('committee')
  const [flatId, setFlatId]     = useState('')
  const [password, setPw]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [created, setCreated]   = useState(false)
  const [copied, setCopied]     = useState(false)
  const [error, setError]       = useState('')

  const { data: flats = [] } = useQuery({
    queryKey: ['flats-list'],
    queryFn: async () => {
      const { data } = await supabase.from('flats').select('id, code').order('code')
      return data ?? []
    },
  })

  function reset() {
    setPhone(''); setName(''); setEmail(''); setRole('committee')
    setFlatId(''); setPw(''); setError(''); setCreated(false); setCopied(false)
  }

  async function handleSubmit() {
    setError('')
    if (!/^\d{10}$/.test(phone.trim())) { setError('Mobile must be exactly 10 digits'); return }
    if (!name.trim())                   { setError('Full name is required'); return }
    const pw = generatePassword()
    setPw(pw)
    setSaving(true)
    try {
      const { error: fnErr } = await supabase.functions.invoke('create-user', {
        body: { mobile: phone.trim(), name: name.trim(), contactEmail: email.trim() || null, password: pw, role, flatId: flatId || null },
      })
      if (fnErr) throw fnErr
      onSuccess()
      setCreated(true)
    } catch (e: any) { setError(e.message ?? 'Failed to create user') }
    finally { setSaving(false) }
  }

  const loginId = `${phone}@lilac.com`
  const waMessage = encodeURIComponent(
    `Welcome to Lilac Apartments! Your login credentials:\nMobile: ${phone}\nPassword: ${password}\nApp: https://lilac-apartments.vercel.app\nPlease change your password after first login.`
  )
  const waUrl = phone.length === 10 ? `https://wa.me/91${phone}?text=${waMessage}` : ''

  function handleCopy() {
    navigator.clipboard.writeText(`Mobile: ${phone}\nPassword: ${password}\nApp: https://lilac-apartments.vercel.app`)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  function handleDone() { reset(); onClose() }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="max-w-md p-0">
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
          <DialogTitle>Add user</DialogTitle>
        </div>
        <div className="px-6 py-5 space-y-4">
          {/* Phone — full width, primary */}
          <div className="space-y-1.5">
            <Label>Phone (WhatsApp) *</Label>
            <Input
              value={phone}
              onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile number"
              inputMode="numeric"
              disabled={created}
            />
            {phone.length > 0 && (
              <p className="text-[11.5px]" style={{ color: 'var(--ink-400)' }}>Login ID: {loginId}</p>
            )}
          </div>

          {/* Name + Email — 2 columns */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Full name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rajesh Kumar" disabled={created} />
            </div>
            <div className="space-y-1.5">
              <Label>Email (optional)</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="for notifications" disabled={created} />
            </div>
          </div>

          {/* Role + Flat — 2 columns */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole} disabled={created}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Flat (optional)</Label>
              <Select value={flatId || 'none'} onValueChange={v => setFlatId(v === 'none' ? '' : v)} disabled={created}>
                <SelectTrigger><SelectValue placeholder="— none —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— none —</SelectItem>
                  {(flats as any[]).map((f: any) => (
                    <SelectItem key={f.id} value={f.id}>{f.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-[12.5px]" style={{ color: 'var(--ink-400)' }}>
            A random temporary password is generated and shown once — share it via WhatsApp.
          </p>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {/* Credentials card after creation */}
          {created && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
              <p className="text-[13px] font-semibold text-emerald-800">User created — share credentials</p>
              <div className="rounded-lg bg-white border border-emerald-100 px-3 py-2.5 space-y-1 font-mono text-[12.5px] text-slate-700">
                <p><span className="text-slate-400">Mobile: </span>{phone}</p>
                <p><span className="text-slate-400">Password: </span>{password}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1 gap-1.5 text-[12.5px]" onClick={handleCopy}>
                  <Copy size={13} /> {copied ? 'Copied!' : 'Copy'}
                </Button>
                {waUrl && (
                  <Button
                    size="sm"
                    className="flex-1 gap-1.5 text-[12.5px] bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => window.open(waUrl, '_blank')}
                  >
                    <MessageCircle size={13} /> Send via WhatsApp
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 shrink-0">
          <DialogFooter>
            {created ? (
              <Button onClick={handleDone} className="w-full">Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => { reset(); onClose() }}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={saving} className="gap-1.5">
                  <Shield size={14} />
                  {saving ? 'Creating…' : 'Create & generate password'}
                </Button>
              </>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EditUserDialog({ user, onClose, onSuccess }: { user: any | null; onClose: () => void; onSuccess: () => void }) {
  const [name, setName]               = useState(user?.display_name ?? '')
  const [mobile, setMobile]           = useState(user?.mobile ?? '')
  const [contactEmail, setEmail]      = useState(user?.contact_email ?? '')
  const [role, setRole]               = useState(user?.role ?? 'committee')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true); setError('')
    try {
      const { error: pe } = await supabase.from('profiles').upsert({
        id: user.id, display_name: name.trim(), mobile: mobile.trim() || null, contact_email: contactEmail.trim() || null,
      })
      if (pe) throw pe
      const { error: re } = await supabase.from('user_roles').upsert({ user_id: user.id, role })
      if (re) throw re
      toast.success('User updated')
      onSuccess(); onClose()
    } catch (e: any) { setError(e.message ?? 'Failed to save'); toast.error(e.message ?? 'Failed to save') }
    finally { setSaving(false) }
  }

  return (
    <Dialog open={!!user} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm p-0">
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
          <DialogTitle>Edit User</DialogTitle>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="space-y-1"><Label>Name *</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-1">
            <Label>Mobile</Label>
            <Input value={mobile} onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" />
          </div>
          <div className="space-y-1">
            <Label>Contact email</Label>
            <Input type="email" value={contactEmail} onChange={e => setEmail(e.target.value)} placeholder="real email for communication" />
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 shrink-0">
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Permissions tab ────────────────────────────────────────────

type PermRow = { label: string; resource: Resource; lockedOff?: boolean }

const PERM_GROUPS: { section: string; rows: PermRow[] }[] = [
  { section: 'Transactions', rows: [
    { label: 'View transactions',       resource: 'transactions.view' },
    { label: 'Upload bank statement',   resource: 'transactions.upload' },
    { label: 'Tag / edit transactions', resource: 'transactions.tag' },
    { label: 'Void a transaction',      resource: 'transactions.void' },
  ]},
  { section: 'Dues', rows: [
    { label: 'View dues tracker', resource: 'dues.view' },
    { label: 'Export dues Excel', resource: 'dues.export' },
  ]},
  { section: 'Corpus', rows: [
    { label: 'View corpus fund',     resource: 'corpus.view' },
    { label: 'Create / close plans', resource: 'corpus.manage' },
  ]},
  { section: 'Expenses', rows: [
    { label: 'View expenses',       resource: 'expenses.view' },
    { label: 'Add / edit expenses', resource: 'expenses.add' },
    { label: 'Approve expenses',    resource: 'expenses.approve' },
  ]},
  { section: 'Reports', rows: [
    { label: 'View reports',         resource: 'reports.view' },
    { label: 'Download PDF / Excel', resource: 'reports.download' },
  ]},
  { section: 'Flats & Residents', rows: [
    { label: 'View flat list',    resource: 'flats.view' },
    { label: 'Edit flat details', resource: 'flats.edit' },
  ]},
  { section: 'Settings', rows: [
    { label: 'View settings',   resource: 'settings.view' },
    { label: 'Change settings', resource: 'settings.edit' },
  ]},
  { section: 'Announcements', rows: [
    { label: 'View announcements',    resource: 'announcements.view' },
    { label: 'Publish announcements', resource: 'announcements.publish' },
  ]},
  { section: 'Activity Log', rows: [
    { label: 'View activity log', resource: 'activity.view' },
    { label: 'Export log',        resource: 'activity.export' },
  ]},
  { section: 'User Management', rows: [
    { label: 'View users',       resource: 'users.view',   lockedOff: true },
    { label: 'Add / edit users', resource: 'users.manage', lockedOff: true },
  ]},
]

function Toggle({ checked, onChange, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean
}) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors
        ${checked ? 'bg-violet-600' : 'bg-slate-200'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:opacity-90'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform
        ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

function PermissionsTab() {
  const { isAdmin } = useRoleCtx()

  const { data: savedPerms } = useQuery({
    queryKey: ['role-permissions'],
    queryFn: fetchPermissions,
  })

  const [draft, setDraft] = useState<PermissionsMap | null>(null)
  const [saved, setSaved] = useState(false)
  const perms = draft ?? savedPerms ?? DEFAULT_PERMISSIONS

  const mutation = useMutation({
    mutationFn: savePermissions,
    onSuccess: () => { toast.success('Permissions saved'); setSaved(true); setTimeout(() => setSaved(false), 2500) },
  })

  function toggle(roleKey: 'committee' | 'auditor', resource: Resource, value: boolean) {
    const base = draft ?? savedPerms ?? DEFAULT_PERMISSIONS
    setDraft({ ...base, [roleKey]: { ...base[roleKey], [resource]: value } })
  }

  return (
    <div className="surface !p-0 overflow-hidden">
      <div className="px-5 py-3 border-b hairline flex items-center gap-3" style={{ background: 'var(--ink-50)' }}>
        <p className="text-[13px] font-semibold flex-1" style={{ color: 'var(--ink-700)' }}>Role access control</p>
        {isAdmin && (
          <button
            onClick={() => setDraft({ ...DEFAULT_PERMISSIONS })}
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg border hairline hover:bg-white transition-colors"
            style={{ color: 'var(--ink-500)' }}
          >
            <RefreshCw size={12} /> Reset defaults
          </button>
        )}
        {isAdmin && (
          <Button size="sm" onClick={() => mutation.mutate(perms)} disabled={mutation.isPending || !draft}>
            {saved ? '✓ Saved' : mutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b hairline" style={{ background: 'var(--ink-50)' }}>
              <th className="text-left px-5 py-2.5 font-semibold w-[45%]" style={{ color: 'var(--ink-600)' }}>Feature / Action</th>
              <th className="px-4 py-2.5 font-semibold text-center w-[18%]" style={{ color: 'var(--ink-600)' }}>Admin</th>
              <th className="px-4 py-2.5 font-semibold text-center w-[18%]" style={{ color: 'var(--ink-600)' }}>Committee</th>
              <th className="px-4 py-2.5 font-semibold text-center w-[18%]" style={{ color: 'var(--ink-600)' }}>Auditor</th>
            </tr>
          </thead>
          <tbody>
            {PERM_GROUPS.map(group => (
              <>
                <tr key={group.section} style={{ background: 'var(--ink-50)' }}>
                  <td colSpan={4} className="px-5 py-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ink-400)' }}>
                      {group.section}
                    </span>
                  </td>
                </tr>
                {group.rows.map(row => {
                  const cv = row.lockedOff ? false : (perms.committee[row.resource] ?? false)
                  const av = row.lockedOff ? false : (perms.auditor[row.resource]   ?? false)
                  return (
                    <tr key={row.resource} className="border-b hairline last:border-0 hover:bg-[var(--ink-50)] transition-colors">
                      <td className="px-5 py-2.5" style={{ color: 'var(--ink-700)' }}>{row.label}</td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-green-600 font-bold">✓</span>
                          <Lock size={10} className="text-slate-300" />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {row.lockedOff
                          ? <div className="flex items-center justify-center gap-1">
                              <span className="text-slate-300 font-bold">✗</span>
                              <Lock size={10} className="text-slate-300" />
                            </div>
                          : <div className="flex justify-center">
                              <Toggle checked={cv} onChange={v => toggle('committee', row.resource, v)} disabled={!isAdmin} />
                            </div>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {row.lockedOff
                          ? <div className="flex items-center justify-center gap-1">
                              <span className="text-slate-300 font-bold">✗</span>
                              <Lock size={10} className="text-slate-300" />
                            </div>
                          : <div className="flex justify-center">
                              <Toggle checked={av} onChange={v => toggle('auditor', row.resource, v)} disabled={!isAdmin} />
                            </div>}
                      </td>
                    </tr>
                  )
                })}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {!isAdmin && (
        <div className="px-5 py-3 border-t hairline text-[12px]" style={{ color: 'var(--ink-400)' }}>
          Only Admins can change role permissions.
        </div>
      )}
    </div>
  )
}
