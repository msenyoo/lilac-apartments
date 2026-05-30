import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import Layout from '@/components/layout/Layout'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import UploadPage from '@/pages/UploadPage'
import ReviewPage from '@/pages/ReviewPage'
import ReportPage from '@/pages/ReportPage'
import DuesPage from '@/pages/DuesPage'
import CorpusPage from '@/pages/CorpusPage'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) return <LoginPage />

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="upload"    element={<UploadPage />} />
          <Route path="review"    element={<ReviewPage />} />
          <Route path="dues"      element={<DuesPage />} />
          <Route path="corpus"    element={<CorpusPage />} />
          <Route path="report"    element={<ReportPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
