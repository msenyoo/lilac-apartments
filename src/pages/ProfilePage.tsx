import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { KeyRound, Save, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ProfilePage() {
  const qc = useQueryClient()
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  const { data: profile, isLoading } = useQuery({
    queryKey: ['my-profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('display_name, mobile, contact_email')
        .eq('id', userId!)
        .maybeSingle()
      return data as { display_name: string | null; mobile: string | null; contact_email: string | null } | null
    },
  })

  if (isLoading || !userId) {
    return <div className="surface h-48 animate-pulse" style={{ background: 'var(--ink-100)' }} />
  }

  return (
    <div className="flex flex-col gap-6 fade-in max-w-xl">
      <div>
        <h1 className="text-[24px] font-extrabold">My Profile</h1>
        <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>
          Manage your name, contact details, and password
        </p>
      </div>

      <ProfileForm
        userId={userId}
        profile={profile ?? null}
        onSaved={() => qc.invalidateQueries({ queryKey: ['my-profile', userId] })}
      />
      <ChangePasswordForm />
    </div>
  )
}

function ProfileForm({ userId, profile, onSaved }: {
  userId: string
  profile: { display_name: string | null; mobile: string | null; contact_email: string | null } | null
  onSaved: () => void
}) {
  const [name, setName]   = useState(profile?.display_name ?? '')
  const [email, setEmail] = useState(profile?.contact_email ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(profile?.display_name ?? '')
    setEmail(profile?.contact_email ?? '')
  }, [profile])

  async function handleSave() {
    setSaving(true)
    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      display_name: name.trim() || null,
      contact_email: email.trim() || null,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Profile updated')
    onSaved()
  }

  return (
    <div className="surface !p-5 flex flex-col gap-4">
      <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-700)' }}>Personal details</p>

      <div className="flex flex-col gap-1">
        <Label>Display name</Label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <Label>Mobile (login ID)</Label>
          <Input
            value={profile?.mobile ?? ''}
            disabled
            className="opacity-60 cursor-not-allowed"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Contact email</Label>
          <Input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="For notifications"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="flex items-center gap-2">
          <Save size={14} />
          {saving ? 'Saving…' : 'Save details'}
        </Button>
      </div>
    </div>
  )
}

function ChangePasswordForm() {
  const [newPw, setNewPw]       = useState('')
  const [confirmPw, setConfirm] = useState('')
  const [showNew, setShowNew]   = useState(false)
  const [showConf, setShowConf] = useState(false)
  const [saving, setSaving]     = useState(false)

  const mismatch  = confirmPw.length > 0 && newPw !== confirmPw
  const tooShort  = newPw.length > 0 && newPw.length < 8
  const canSubmit = newPw.length >= 8 && newPw === confirmPw

  async function handleChange() {
    if (!canSubmit) return
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Password changed successfully')
    setNewPw(''); setConfirm('')
  }

  return (
    <div className="surface !p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <KeyRound size={16} style={{ color: 'var(--ink-500)' }} />
        <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-700)' }}>Change password</p>
      </div>

      <div className="flex flex-col gap-1">
        <Label>New password</Label>
        <div className="relative">
          <Input
            type={showNew ? 'text' : 'password'}
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            placeholder="At least 8 characters"
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowNew(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--ink-400)' }}
          >
            {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        {tooShort && <p className="text-xs text-red-500">Must be at least 8 characters</p>}
      </div>

      <div className="flex flex-col gap-1">
        <Label>Confirm new password</Label>
        <div className="relative">
          <Input
            type={showConf ? 'text' : 'password'}
            value={confirmPw}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Repeat new password"
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowConf(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--ink-400)' }}
          >
            {showConf ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        {mismatch && <p className="text-xs text-red-500">Passwords do not match</p>}
      </div>

      <div className="flex justify-end">
        <Button onClick={handleChange} disabled={!canSubmit || saving} className="flex items-center gap-2">
          <KeyRound size={14} />
          {saving ? 'Changing…' : 'Change password'}
        </Button>
      </div>
    </div>
  )
}
