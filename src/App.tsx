import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import Layout from '@/components/layout/Layout'
import LoginPage       from '@/pages/LoginPage'
import DashboardPage   from '@/pages/DashboardPage'
import TransactionsPage from '@/pages/TransactionsPage'
import DuesPage        from '@/pages/DuesPage'
import CorpusPage      from '@/pages/CorpusPage'
import ReportPage      from '@/pages/ReportPage'
import FlatsPage       from '@/pages/FlatsPage'
import SettingsPage    from '@/pages/SettingsPage'
import ExpensesPage    from '@/pages/ExpensesPage'
import { RoleProvider } from '@/contexts/RoleContext'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) return <LoginPage />

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<RoleProvider><Layout /></RoleProvider>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"    element={<DashboardPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="dues"         element={<DuesPage />} />
          <Route path="corpus"       element={<CorpusPage />} />
          <Route path="expenses"     element={<ExpensesPage />} />
          <Route path="reports"      element={<ReportPage />} />
          <Route path="flats"        element={<FlatsPage />} />
          <Route path="settings"     element={<SettingsPage />} />
          {/* Legacy redirects */}
          <Route path="upload"       element={<Navigate to="/transactions" replace />} />
          <Route path="review"       element={<Navigate to="/transactions?tab=review" replace />} />
          <Route path="report"       element={<Navigate to="/reports" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
