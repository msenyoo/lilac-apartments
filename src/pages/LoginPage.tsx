import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Building2, Mail } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail]     = useState('')
  const [sent, setSent]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    })
    setLoading(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="min-h-screen bg-brand-700 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-4">
            <Building2 size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-white">Lilac Apartments</h1>
          <p className="text-blue-200 text-sm mt-1">Association Management</p>
        </div>

        {sent ? (
          <div className="card p-6 text-center">
            <Mail size={40} className="mx-auto mb-3 text-brand-700" />
            <h2 className="font-semibold text-lg">Check your email</h2>
            <p className="text-slate-500 text-sm mt-2">
              We sent a login link to <strong>{email}</strong>.<br />
              Tap the link to sign in.
            </p>
            <button
              onClick={() => setSent(false)}
              className="mt-4 text-sm text-brand-700 underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="card p-6 space-y-4">
            <h2 className="font-semibold text-center">Committee sign in</h2>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm
                           focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center flex items-center gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                'Send magic link'
              )}
            </button>
            <p className="text-xs text-slate-400 text-center">
              No password needed — we'll email you a sign-in link
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
