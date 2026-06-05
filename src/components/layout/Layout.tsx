import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, ArrowUpFromLine, ClipboardList, IndianRupee,
  Building2, FileText, LogOut, Menu, X, Settings, ChevronRight,
  Receipt, MoreHorizontal,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useQuery } from '@tanstack/react-query'

const NAV = [
  { to: '/dashboard',    icon: LayoutDashboard,  label: 'Dashboard' },
  { to: '/transactions', icon: ArrowUpFromLine,   label: 'Transactions', badge: 'review' },
  { to: '/dues',         icon: IndianRupee,       label: 'Dues' },
  { to: '/corpus',       icon: Building2,         label: 'Corpus' },
  { to: '/expenses',     icon: Receipt,           label: 'Expenses' },
  { to: '/reports',      icon: FileText,          label: 'Reports' },
  { to: '/flats',        icon: ClipboardList,     label: 'Flats & Residents' },
  { to: '/settings',     icon: Settings,          label: 'Settings' },
]

// Primary 4 tabs in bottom nav; rest accessible via More → sidebar drawer
const BOTTOM_NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/dues',      icon: IndianRupee,     label: 'Dues' },
  { to: '/corpus',    icon: Building2,       label: 'Corpus' },
  { to: '/expenses',  icon: Receipt,         label: 'Expenses' },
]

export default function Layout() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const [open, setOpen] = useState(false)

  // Close drawer on route change (mobile)
  useEffect(() => { setOpen(false) }, [location.pathname])

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

  const sidebar = (
    <aside className="flex flex-col h-full bg-brand-800 text-brand-100 w-60 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-brand-700">
        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
          <Building2 size={16} className="text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight truncate text-white">Lilac Apartments</p>
          <p className="text-xs text-brand-300 truncate">Rajakil Pakkam</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
        {NAV.map(({ to, icon: Icon, label, badge }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative
               ${isActive
                 ? 'bg-white/20 text-white'
                 : 'text-brand-200 hover:bg-white/10 hover:text-white'}`
            }
          >
            <Icon size={17} strokeWidth={1.75} className="shrink-0" />
            <span className="flex-1">{label}</span>
            {badge === 'review' && reviewCount && reviewCount > 0 && (
              <span className="bg-red-400 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                {reviewCount > 99 ? '99+' : reviewCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Logout */}
      <div className="border-t border-brand-700 p-3">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-brand-300
                     hover:bg-white/10 hover:text-white transition-colors"
        >
          <LogOut size={17} strokeWidth={1.75} />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">

      {/* Desktop sidebar — always visible on lg+ */}
      <div className="hidden lg:flex lg:flex-col lg:shrink-0">
        {sidebar}
      </div>

      {/* Mobile sidebar — drawer overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative flex flex-col h-full shadow-2xl">
            {sidebar}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="absolute top-4 left-[244px] z-10 p-1.5 rounded-lg bg-slate-800 text-white"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar (mobile: shows hamburger; desktop: shows breadcrumb) */}
        <header className="bg-brand-700 border-b border-brand-600 px-4 h-14 flex items-center justify-between shrink-0 lg:px-6">
          <button
            className="lg:hidden p-1.5 rounded-lg text-brand-200 hover:bg-white/10"
            onClick={() => setOpen(true)}
          >
            <Menu size={20} />
          </button>

          {/* Breadcrumb / current page title — desktop */}
          <div className="hidden lg:flex items-center gap-1.5 text-sm">
            <span className="text-brand-300">Lilac Apartments</span>
            <ChevronRight size={14} className="text-brand-400" />
            <span className="text-white font-medium">
              {NAV.find(n => location.pathname.startsWith(n.to))?.label ?? 'Page'}
            </span>
          </div>

          {/* Mobile: center logo text */}
          <div className="lg:hidden absolute left-1/2 -translate-x-1/2 text-sm font-semibold text-white">
            Lilac Apartments
          </div>

          {/* Right slot: logout on mobile */}
          <button
            onClick={handleLogout}
            className="lg:hidden p-1.5 rounded-lg text-brand-200 hover:bg-white/10"
          >
            <LogOut size={18} />
          </button>

          {/* Desktop right: review badge quick link */}
          <div className="hidden lg:flex items-center gap-3">
            {reviewCount && reviewCount > 0 ? (
              <NavLink to="/transactions" className="flex items-center gap-1.5 text-sm text-orange-300 font-medium hover:text-orange-200">
                <ClipboardList size={15} />
                <span>{reviewCount} pending review</span>
              </NavLink>
            ) : null}
          </div>
        </header>

        {/* Scrollable page content */}
        <main className="flex-1 overflow-y-auto">
          {/* pb-20 on mobile leaves room above the fixed bottom nav bar */}
          <div className="p-4 lg:p-6 pb-20 lg:pb-6 max-w-screen-2xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>

      {/* ── Mobile bottom nav bar ─────────────────────────────── */}
      <nav className="fixed bottom-0 inset-x-0 z-40 lg:hidden bg-brand-800 border-t border-brand-700">
        <div className="flex items-stretch" style={{ height: '56px' }}>
          {BOTTOM_NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors
                 ${isActive ? 'text-white' : 'text-brand-300 active:text-brand-100'}`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={20} strokeWidth={isActive ? 2 : 1.75} />
                  <span className={`text-[10px] font-medium ${isActive ? 'text-white' : 'text-brand-300'}`}>
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          ))}

          {/* More — opens the full sidebar drawer */}
          <button
            onClick={() => setOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-brand-300 active:text-brand-100 transition-colors"
          >
            <MoreHorizontal size={20} strokeWidth={1.75} />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>
    </div>
  )
}
