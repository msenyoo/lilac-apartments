import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Building2, Eye, EyeOff, LogIn } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [showPass, setShowPass]   = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError(error.message)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6"
         style={{ background: 'linear-gradient(135deg, #0d1e30 0%, #1a3c5e 60%, #2e75b6 100%)' }}>

      {/* Logo block */}
      <div className="text-center mb-8 select-none">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-5
                        shadow-xl"
             style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)' }}>
          <Building2 size={38} className="text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Lilac Apartments</h1>
        <p className="text-blue-300 text-sm mt-1.5 font-medium tracking-wide uppercase">
          Association Management
        </p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
           style={{ background: 'rgba(255,255,255,0.97)' }}>

        {/* Card header bar */}
        <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, #1a3c5e, #2e75b6)' }} />

        <form onSubmit={handleLogin} className="p-7 space-y-5">
          <div className="text-center pb-1">
            <h2 className="text-xl font-semibold text-slate-800">Committee sign in</h2>
            <p className="text-slate-400 text-sm mt-1">Enter your credentials to continue</p>
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm
                         bg-slate-50 focus:bg-white focus:outline-none focus:ring-2
                         focus:ring-brand-500 focus:border-transparent transition-all"
            />
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Password</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 pr-11 text-sm
                           bg-slate-50 focus:bg-white focus:outline-none focus:ring-2
                           focus:ring-brand-500 focus:border-transparent transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400
                           hover:text-slate-600 transition-colors"
              >
                {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl
                       font-semibold text-sm text-white transition-all
                       disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #1a3c5e, #2e75b6)' }}
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <><LogIn size={16} /> Sign in</>
            )}
          </button>
        </form>
      </div>

      <p className="mt-6 text-blue-300/60 text-xs">
        Rajakil Pakkam · Chennai
      </p>
    </div>
  )
}
