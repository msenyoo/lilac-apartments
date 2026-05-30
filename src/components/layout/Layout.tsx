import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Upload, AlertCircle, IndianRupee, Building2, FileText, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useQuery } from '@tanstack/react-query'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { to: '/upload',    icon: Upload,          label: 'Upload' },
  { to: '/review',    icon: AlertCircle,     label: 'Review' },
  { to: '/dues',      icon: IndianRupee,     label: 'Dues' },
  { to: '/corpus',    icon: Building2,       label: 'Corpus' },
  { to: '/report',    icon: FileText,        label: 'Report' },
]

export default function Layout() {
  const navigate = useNavigate()

  const { data: reviewCount } = useQuery({
    queryKey: ['review-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('v_review_queue')
        .select('*', { count: 'exact', head: true })
      return count ?? 0
    },
    refetchInterval: 30_000,
  })

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="min-h-screen flex flex-col max-w-lg mx-auto">
      {/* Top bar */}
      <header className="bg-brand-700 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-10 safe-top">
        <div>
          <h1 className="font-semibold text-base leading-tight">Lilac Apartments</h1>
          <p className="text-xs text-blue-200">Rajakil Pakkam</p>
        </div>
        <button onClick={handleLogout} className="p-2 rounded-lg active:bg-brand-900">
          <LogOut size={18} />
        </button>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white border-t border-slate-200 safe-bottom z-10">
        <div className="grid grid-cols-6">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center py-2 gap-0.5 relative touch-manipulation
                 ${isActive ? 'text-brand-700' : 'text-slate-400'}`
              }
            >
              <div className="relative">
                <Icon size={20} strokeWidth={1.75} />
                {label === 'Review' && reviewCount && reviewCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                    {reviewCount > 9 ? '9+' : reviewCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
