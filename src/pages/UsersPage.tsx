import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Plus, Pencil, Shield, Eye, EyeOff, Users, UserCircle } from 'lucide-react'
import {
  Dialog, DialogContent, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useRoleCtx } from '@/contexts/RoleContext'

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

export default function UsersPage() {
  const { isAdmin } = useRoleCtx()
  const qc = useQueryClient()
  const [addOpen, setAddOpen]       = useState(false)
  const [editTarget, setEditTarget] = useState<any | null>(null)

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
            Create logins, assign roles, map residents to flats · admin only
          </p>
        </div>
        <button
          className="flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-white font-semibold text-[14px]"
          style={{ background: 'var(--brand-600)' }}
          onClick={() => setAddOpen(true)}
        >
          <Plus size={15} /> Add user
        </button>
      </div>

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
    </div>
  )
}

function AddUserDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [name, setName]       = useState('')
  const [mobile, setMobile]   = useState('')
  const [password, setPw]     = useState('')
  const [showPw, setShowPw]   = useState(false)
  const [role, setRole]       = useState('committee')
  const [saving, setSaving]   = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError]     = useState('')

  function reset() { setName(''); setMobile(''); setPw(''); setShowPw(false); setRole('committee'); setError(''); setSuccess(false) }

  async function handleSubmit() {
    setError('')
    if (!name.trim())                    { setError('Name is required'); return }
    if (!/^\d{10}$/.test(mobile.trim())) { setError('Mobile must be exactly 10 digits'); return }
    if (password.length < 8)             { setError('Password must be at least 8 characters'); return }
    setSaving(true)
    try {
      const { error: fnErr } = await supabase.functions.invoke('create-user', {
        body: { name: name.trim(), mobile: mobile.trim(), password, role },
      })
      if (fnErr) throw fnErr
      onSuccess()
      setSuccess(true)
      setTimeout(() => { setSuccess(false); reset(); onClose() }, 1200)
    } catch (e: any) { setError(e.message ?? 'Failed to create user') }
    finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="max-w-sm p-0">
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
          <DialogTitle>Add User</DialogTitle>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rajesh Kumar" />
          </div>
          <div className="space-y-1">
            <Label>Mobile (10 digits) *</Label>
            <Input
              value={mobile}
              onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit number"
              inputMode="numeric"
            />
            {mobile.length > 0 && (
              <p className="text-xs text-slate-400">Login: {mobile}@lilac.com</p>
            )}
          </div>
          <div className="space-y-1">
            <Label>Password *</Label>
            <div className="relative">
              <Input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPw(e.target.value)}
                placeholder="Min 8 characters"
                className="pr-9"
              />
              <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Role *</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {error   && <p className="text-sm text-red-500">{error}</p>}
          {success && <p className="text-sm text-emerald-600">User created!</p>}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 shrink-0">
          <DialogFooter>
            <Button variant="outline" onClick={() => { reset(); onClose() }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving || success}>
              {saving ? 'Creating…' : success ? 'Created!' : 'Create user'}
            </Button>
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
      onSuccess(); onClose()
    } catch (e: any) { setError(e.message ?? 'Failed to save') }
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
