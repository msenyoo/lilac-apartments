import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  LayoutDashboard, IndianRupee, Banknote, Building2, Receipt,
  FileText, Users, Settings, LogOut, Menu,
  Megaphone, History, Shield, Search, Bell,
  MoreHorizontal, HelpCircle, Home, User, PiggyBank,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useQuery } from '@tanstack/react-query'
import HelpButton from '@/components/HelpButton'
import { useRoleCtx } from '@/contexts/RoleContext'

const ROLE_LABEL: Record<string, string> = {
  admin:     'Treasurer',
  committee: 'Committee',
  auditor:   'Auditor',
  owner:     'Owner',
}

const NAV = [
  { to: '/dashboard',     icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/dues',          icon: IndianRupee,     label: 'Dues',              badge: 'dues' },
  { to: '/transactions',  icon: Banknote,        label: 'Transactions',      badge: 'review' },
  { to: '/corpus',        icon: Building2,       label: 'Corpus' },
  { to: '/finance',       icon: PiggyBank,       label: 'Finance' },
  { to: '/finance-overview', icon: LayoutDashboard, label: 'Finance Overview', adminOrCommitteeOnly: true },
  { to: '/expenses',      icon: Receipt,         label: 'Expenses' },
  { to: '/announcements', icon: Megaphone,       label: 'Announcements' },
  { to: '/flats',         icon: Users,           label: 'Flats & residents' },
  { to: '/reports',       icon: FileText,        label: 'Reports' },
  { to: '/activity',      icon: History,         label: 'Activity log' },
  { to: '/users',         icon: Shield,          label: 'Users',             adminOnly: true },
  { to: '/settings',      icon: Settings,        label: 'Settings',          adminOnly: true },
  { to: '/help',          icon: HelpCircle,      label: 'Help Center' },
]

// Restricted nav for flat owners — self-service portal only
const OWNER_NAV = [
  { to: '/dashboard',     icon: Home,        label: 'My Flat' },
  { to: '/announcements', icon: Megaphone,   label: 'Notices' },
  { to: '/settings',      icon: IndianRupee, label: 'Payment Info' },
  { to: '/profile',       icon: User,        label: 'My Profile' },
]

// Pages owners are not allowed to visit
const OWNER_BLOCKED = ['/transactions', '/dues', '/corpus', '/finance', '/finance-overview', '/expenses', '/flats', '/reports', '/activity', '/users']

const BOTTOM_NAV = [
  { to: '/dashboard',     icon: LayoutDashboard, label: 'Home' },
  { to: '/dues',          icon: IndianRupee,     label: 'Dues' },
  { to: '/expenses',      icon: Receipt,         label: 'Expenses' },
  { to: '/announcements', icon: Megaphone,       label: 'Notices' },
]

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = (name || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
  const hue = ((name || '').charCodeAt(0) * 47) % 360
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold shrink-0 text-sm"
      style={{
        width: size, height: size,
        fontSize: size * 0.36,
        background: `oklch(0.93 0.05 ${hue})`,
        color: `oklch(0.45 0.13 ${hue})`,
      }}
    >
      {initials}
    </div>
  )
}

export default function Layout() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const qc        = useQueryClient()
  const [open, setOpen]   = useState(false)
  const [notif, setNotif] = useState(false)
  const { role, isOwner, loading: roleLoading, hasFlatAssigned } = useRoleCtx()
  const [userName, setUserName] = useState('')

  useEffect(() => { setOpen(false) }, [location.pathname])

  // Redirect owners away from management pages
  useEffect(() => {
    if (isOwner && OWNER_BLOCKED.some(p => location.pathname.startsWith(p))) {
      navigate('/dashboard', { replace: true })
    }
  }, [isOwner, location.pathname, navigate])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const raw = data.user?.email ?? data.user?.phone ?? ''
      setUserName(raw.endsWith('@lilac.com') ? raw.slice(0, -'@lilac.com'.length) : raw)
    })
  }, [])

  const { data: reviewCount = 0 } = useQuery({
    queryKey: ['review-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('v_review_queue')
        .select('*', { count: 'exact', head: true })
      if (error) return 0
      return count ?? 0
    },
    refetchInterval: 30_000,
    retry: false,
  })

  async function handleLogout() {
    await supabase.auth.signOut()
    qc.clear()
    navigate('/')
  }

  const visibleNav = roleLoading
    ? []
    : isOwner
      ? OWNER_NAV
      : (() => {
          const items = NAV.filter(n => {
            if ((n as any).adminOnly && role !== 'admin') return false
            if ((n as any).adminOrCommitteeOnly && role !== 'admin' && role !== 'committee') return false
            return true
          })
          if (!hasFlatAssigned) return items
          return [items[0], { to: '/my-flat', icon: Home, label: 'My Flat' }, ...items.slice(1)]
        })()
  const currentPage = visibleNav.find(n => location.pathname.startsWith(n.to))

  const sidebar = (
    <aside
      className="flex flex-col h-full bg-white border-r hairline shrink-0"
      style={{ width: 248 }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-16 border-b hairline shrink-0">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
          style={{ background: 'var(--brand-600)' }}
        >
          <Building2 size={19} />
        </div>
        <div className="min-w-0">
          <p className="text-[14px] font-bold leading-tight truncate">Lilac Apartments</p>
          <p className="text-[11px] truncate" style={{ color: 'var(--ink-400)' }}>Owners' Association</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-0.5">
        {visibleNav.map(({ to, icon: Icon, label, ...rest }) => {
          const badge = (rest as any).badge as string | undefined
          const badgeCount = badge === 'review' ? reviewCount : 0
          return (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-[13.5px] font-medium transition-colors text-left ${
                  isActive
                    ? 'text-white'
                    : 'hover:bg-[var(--ink-100)]'
                }`
              }
              style={({ isActive }) => isActive ? { background: 'var(--brand-600)', color: '#fff' } : { color: 'var(--ink-600)' }}
            >
              {({ isActive }) => (
                <>
                  <Icon size={18} strokeWidth={isActive ? 2 : 1.75} className="shrink-0" />
                  <span className="flex-1">{label}</span>
                  {badgeCount > 0 && (
                    <span
                      className="text-[10.5px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center"
                      style={isActive
                        ? { background: 'rgba(255,255,255,.25)', color: '#fff' }
                        : { background: 'var(--bad-bg)', color: 'var(--bad)' }
                      }
                    >
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* Footer: user + role + logout */}
      <div className="p-3 border-t hairline shrink-0">
        <div className="flex items-center gap-1">
          <NavLink
            to="/profile"
            className="flex items-center gap-2.5 flex-1 px-2 py-2 rounded-xl hover:bg-[var(--ink-100)] transition-colors min-w-0"
          >
            <Avatar name={userName} size={34} />
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] font-semibold truncate capitalize" style={{ color: 'var(--ink-900)' }}>
                {userName || 'User'}
              </p>
              <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>
                {role ? ROLE_LABEL[role] ?? role : '—'}
              </p>
            </div>
          </NavLink>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="p-1.5 rounded-lg transition-colors hover:bg-[var(--ink-100)] shrink-0"
            style={{ color: 'var(--ink-500)' }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--ink-50)' }}>

      {/* Desktop sidebar */}
      <div className="hidden lg:block shrink-0">{sidebar}</div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-[90] lg:hidden">
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(26,24,32,.5)' }}
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 pop-in">{sidebar}</div>
        </div>
      )}

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Top bar */}
        <header
          className="h-16 bg-white border-b hairline flex items-center gap-3 px-4 lg:px-6 shrink-0"
        >
          {/* Mobile hamburger */}
          <button
            className="lg:hidden p-2 rounded-xl transition-colors hover:bg-[var(--ink-100)]"
            style={{ color: 'var(--ink-600)' }}
            onClick={() => setOpen(true)}
          >
            <Menu size={20} />
          </button>

          {/* Search bar (desktop) */}
          <button
            className="hidden sm:flex items-center gap-2.5 px-3.5 h-10 rounded-xl border hairline bg-[var(--ink-50)] hover:border-[var(--ink-300)] transition-colors flex-1 max-w-[360px]"
            style={{ color: 'var(--ink-400)' }}
          >
            <Search size={16} />
            <span className="text-[13.5px] flex-1 text-left">Search flats, pages, actions…</span>
            <span className="kbd">⌘K</span>
          </button>

          {/* Mobile: page title */}
          <div className="flex-1 sm:hidden">
            <p className="text-[14px] font-bold" style={{ color: 'var(--ink-900)' }}>
              {currentPage?.label ?? 'Lilac Apartments'}
            </p>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {/* Mobile search icon */}
            <button
              className="sm:hidden p-2 rounded-xl hover:bg-[var(--ink-100)]"
              style={{ color: 'var(--ink-600)' }}
            >
              <Search size={19} />
            </button>

            {/* Role badge (desktop) */}
            {role && (
              <span
                className="hidden md:inline-flex items-center px-2.5 py-1 rounded-lg text-[12px] font-semibold"
                style={{
                  background: role === 'admin' ? 'var(--brand-50)' : role === 'committee' ? 'var(--info-bg)' : 'var(--ink-100)',
                  color: role === 'admin' ? 'var(--brand-700)' : role === 'committee' ? 'var(--info)' : 'var(--ink-600)',
                }}
              >
                {ROLE_LABEL[role] ?? role}
              </span>
            )}

            {/* Notifications */}
            <div className="relative">
              <button
                className="p-2 rounded-xl relative hover:bg-[var(--ink-100)] transition-colors"
                style={{ color: 'var(--ink-600)' }}
                onClick={() => setNotif(v => !v)}
              >
                <Bell size={19} />
                {reviewCount > 0 && (
                  <span
                    className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
                    style={{ background: 'var(--bad)' }}
                  />
                )}
              </button>
              {notif && (
                <div
                  className="absolute right-0 top-12 z-50 w-72 surface pop-in"
                  style={{ boxShadow: 'var(--shadow-pop)' }}
                >
                  <p
                    className="px-4 py-3 text-[12px] font-bold uppercase tracking-wide border-b hairline"
                    style={{ color: 'var(--ink-400)' }}
                  >
                    Notifications
                  </p>
                  <div className="divide-rows">
                    {reviewCount > 0 && (
                      <div className="flex items-center gap-3 px-4 py-3">
                        <Banknote size={17} style={{ color: 'var(--warn)' }} />
                        <span className="text-[12.5px]" style={{ color: 'var(--ink-700)' }}>
                          {reviewCount} bank transactions need tagging
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <IndianRupee size={17} style={{ color: 'var(--bad)' }} />
                      <span className="text-[12.5px]" style={{ color: 'var(--ink-700)' }}>
                        Check dues for pending flats
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Avatar */}
            <Avatar name={userName} size={34} />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8 max-w-[1320px] mx-auto fade-in">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Floating help button */}
      <HelpButton />

      {/* Mobile bottom nav */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t hairline flex"
        style={{ height: 60 }}
      >
        {BOTTOM_NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className="flex-1 flex flex-col items-center justify-center gap-1"
            style={({ isActive }) => ({ color: isActive ? 'var(--brand-600)' : 'var(--ink-400)' })}
          >
            {({ isActive }) => (
              <>
                <Icon size={20} strokeWidth={isActive ? 2 : 1.75} />
                <span className="text-[10px] font-semibold">{label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button
          onClick={() => setOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-1"
          style={{ color: 'var(--ink-400)' }}
        >
          <MoreHorizontal size={20} strokeWidth={1.75} />
          <span className="text-[10px] font-semibold">More</span>
        </button>
      </nav>
    </div>
  )
}
