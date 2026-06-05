import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Building2, Eye, EyeOff } from 'lucide-react'

function toAuthEmail(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (/^\d{10}$/.test(digits)) return `${digits}@lilac.com`
  if (/^91\d{10}$/.test(digits)) return `${digits.slice(2)}@lilac.com`
  return input
}

export default function LoginPage() {
  const [login, setLogin]       = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const isPhone = /^\+?[\d\s-]{7,}$/.test(login) && !login.includes('@')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const email = toAuthEmail(login.trim())
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError(error.message)
  }

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--ink-50)' }}>
      {/* Brand panel — desktop left */}
      <div
        className="hidden lg:flex flex-col justify-between w-[420px] shrink-0 p-12"
        style={{ background: 'linear-gradient(160deg, var(--brand-700) 0%, var(--brand-500) 100%)' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/20">
            <Building2 size={22} className="text-white" />
          </div>
          <span className="text-white font-bold text-[16px]">Lilac Apartments</span>
        </div>
        <div>
          <p className="text-white/90 text-[28px] font-bold leading-snug mb-3">
            Association<br />management,<br />simplified.
          </p>
          <p className="text-white/60 text-[14px] leading-relaxed">
            Dues · Corpus · Expenses · Reports — all in one place for your volunteer committee.
          </p>
        </div>
        <p className="text-white/40 text-[12px]">Rajakil Pakkam · Chennai</p>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12">
        {/* Mobile logo */}
        <div className="lg:hidden flex flex-col items-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'var(--brand-600)' }}
          >
            <Building2 size={28} className="text-white" />
          </div>
          <p className="font-extrabold text-[20px]">Lilac Apartments</p>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ink-400)' }}>Committee portal</p>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-7">
            <h2 className="text-[22px] font-extrabold" style={{ color: 'var(--ink-900)' }}>
              Sign in
            </h2>
            <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>
              Enter your mobile number or email
            </p>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <label className="ds-lbl">
                Mobile number <span style={{ color: 'var(--ink-400)', fontWeight: 400 }}>or email</span>
              </label>
              <input
                type="text"
                inputMode="tel"
                required
                autoComplete="username"
                value={login}
                onChange={e => setLogin(e.target.value)}
                placeholder="9876543210"
                className="ds-field"
              />
              {isPhone && (
                <p className="text-[11.5px]" style={{ color: 'var(--ink-400)' }}>
                  Signing in as <span className="font-medium" style={{ color: 'var(--ink-600)' }}>{toAuthEmail(login.trim())}</span>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="ds-lbl">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="ds-field pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: 'var(--ink-400)' }}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div
                className="px-4 py-3 rounded-[10px] border text-[13px]"
                style={{ background: 'var(--bad-bg)', borderColor: 'var(--bad-bd)', color: 'var(--bad)' }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-[10px] font-semibold text-[14px] text-white transition-opacity disabled:opacity-50"
              style={{ background: 'var(--brand-600)' }}
            >
              {loading
                ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : 'Sign in'
              }
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
