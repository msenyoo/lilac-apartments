import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X,
  Search,
  Rocket,
  LayoutDashboard,
  IndianRupee,
  Banknote,
  Building2,
  Receipt,
  Users,
  FileText,
  Settings,
  Shield,
  History,
  HelpCircle,
  Lightbulb,
  AlertTriangle,
  ChevronRight,
  HandHeart,
  PiggyBank,
  Megaphone,
  Home,
} from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { HELP_SECTIONS, HelpItem, Role } from './helpContent'
import FlowDiagram from './FlowDiagram'
import SearchResults from './SearchResults'

const ICON_MAP: Record<string, React.FC<{ size?: number; className?: string }>> = {
  Rocket: Rocket,
  LayoutDashboard: LayoutDashboard,
  IndianRupee: IndianRupee,
  Banknote: Banknote,
  Building2: Building2,
  Receipt: Receipt,
  Users: Users,
  FileText: FileText,
  Settings: Settings,
  Shield: Shield,
  History: History,
  HelpCircle: HelpCircle,
  HandHeart: HandHeart,
  PiggyBank: PiggyBank,
  Megaphone: Megaphone,
  Home: Home,
}

function roleBadgeClass(role: Role): string {
  switch (role) {
    case 'admin':
      return 'bg-violet-100 text-violet-800'
    case 'committee':
      return 'bg-amber-100 text-amber-800'
    case 'auditor':
      return 'bg-slate-100 text-slate-600'
  }
}

function roleLabel(role: Role): string {
  switch (role) {
    case 'admin':
      return 'Admin'
    case 'committee':
      return 'Committee'
    case 'auditor':
      return 'Auditor'
  }
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold mr-1.5',
        roleBadgeClass(role)
      )}
    >
      {roleLabel(role)}
    </span>
  )
}

function ItemContent({
  item,
  onRelatedClick,
}: {
  item: HelpItem
  onRelatedClick: (id: string) => void
}) {
  return (
    <article className="max-w-2xl">
      {/* Role badges */}
      {item.writeRoles && item.writeRoles.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {item.writeRoles.map(r => (
            <RoleBadge key={r} role={r} />
          ))}
          <span className="text-[11px] text-slate-400 self-center">can perform this action</span>
        </div>
      )}
      {item.roles && !item.writeRoles && item.roles.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {item.roles.map(r => (
            <RoleBadge key={r} role={r} />
          ))}
        </div>
      )}

      {/* Summary */}
      <p className="text-[14px] text-slate-600 leading-relaxed mb-5">{item.summary}</p>

      {/* Steps */}
      {item.steps && item.steps.length > 0 && (
        <section className="mb-5">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">Steps</h4>
          <ol className="space-y-3">
            {item.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  className="flex-shrink-0 w-6 h-6 rounded-full bg-violet-600 text-white
                             flex items-center justify-center text-[11px] font-bold mt-0.5"
                >
                  {i + 1}
                </span>
                <div>
                  <p className="text-[13.5px] text-slate-800 leading-snug">{step.text}</p>
                  {step.detail && (
                    <p className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">{step.detail}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Diagram */}
      {item.diagram && (
        <section className="mb-5">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Flow</h4>
          <FlowDiagram
            nodes={item.diagram.nodes}
            edges={item.diagram.edges}
          />
        </section>
      )}

      {/* Examples */}
      {item.examples && item.examples.length > 0 && (
        <section className="mb-5">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">
            {item.steps ? 'Examples' : 'Details'}
          </h4>
          <div className="space-y-3">
            {item.examples.map((ex, i) => (
              <div key={i} className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                <p className="text-[12px] font-semibold text-slate-700 mb-1">{ex.label}</p>
                <p className="text-[12.5px] text-slate-600 leading-relaxed">{ex.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tips */}
      {item.tips && item.tips.length > 0 && (
        <section className="mb-4">
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb size={14} className="text-amber-600 shrink-0" />
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Tips</p>
            </div>
            <ul className="space-y-1.5">
              {item.tips.map((tip, i) => (
                <li key={i} className="text-[12.5px] text-amber-900 leading-relaxed flex items-start gap-2">
                  <span className="text-amber-400 mt-1 shrink-0">•</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Warnings */}
      {item.warnings && item.warnings.length > 0 && (
        <section className="mb-4">
          <div className="rounded-xl bg-rose-50 border border-rose-100 px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-rose-600 shrink-0" />
              <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700">Important</p>
            </div>
            <ul className="space-y-1.5">
              {item.warnings.map((warn, i) => (
                <li key={i} className="text-[12.5px] text-rose-900 leading-relaxed flex items-start gap-2">
                  <span className="text-rose-400 mt-1 shrink-0">•</span>
                  <span>{warn}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Related items */}
      {item.relatedIds && item.relatedIds.length > 0 && (
        <section className="mt-5 pt-4 border-t border-slate-100">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Related</p>
          <div className="flex flex-wrap gap-2">
            {item.relatedIds.map(rid => {
              let label = rid
              for (const s of HELP_SECTIONS) {
                const found = s.items.find(it => it.id === rid)
                if (found) { label = found.title; break }
              }
              return (
                <button
                  key={rid}
                  onClick={() => onRelatedClick(rid)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full
                             bg-violet-50 text-violet-700 text-[12px] font-medium
                             hover:bg-violet-100 transition-colors border border-violet-100"
                >
                  {label}
                  <ChevronRight size={11} />
                </button>
              )
            })}
          </div>
        </section>
      )}
    </article>
  )
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialRoute?: string
}

function routeToSectionId(route: string): string {
  for (const s of HELP_SECTIONS) {
    if (s.route && route.startsWith(s.route)) return s.id
  }
  return HELP_SECTIONS[0].id
}

export default function HelpCenter({ open, onOpenChange, initialRoute }: Props) {
  const defaultSectionId = routeToSectionId(initialRoute ?? '')
  const [activeSectionId, setActiveSectionId] = useState(defaultSectionId)
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      const sid = routeToSectionId(initialRoute ?? '')
      setActiveSectionId(sid)
      setActiveItemId(null)
      setQuery('')
      setTimeout(() => searchRef.current?.focus(), 100)
    }
  }, [open, initialRoute])

  const activeSection = HELP_SECTIONS.find(s => s.id === activeSectionId) ?? HELP_SECTIONS[0]
  const activeItem = activeItemId
    ? activeSection.items.find(it => it.id === activeItemId) ?? activeSection.items[0]
    : activeSection.items[0]

  const navigateToItem = useCallback((itemId: string) => {
    for (const s of HELP_SECTIONS) {
      const found = s.items.find(it => it.id === itemId)
      if (found) {
        setActiveSectionId(s.id)
        setActiveItemId(found.id)
        setQuery('')
        contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
    }
  }, [])

  function selectSection(sectionId: string) {
    setActiveSectionId(sectionId)
    const section = HELP_SECTIONS.find(s => s.id === sectionId)
    setActiveItemId(section?.items[0]?.id ?? null)
    setQuery('')
    contentRef.current?.scrollTo({ top: 0 })
  }

  function selectItem(sectionId: string, itemId: string) {
    setActiveSectionId(sectionId)
    setActiveItemId(itemId)
    setQuery('')
    contentRef.current?.scrollTo({ top: 0 })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'fixed left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%]',
          'w-[95vw] max-w-5xl h-[90dvh] max-h-[860px]',
          'p-0 border border-slate-200 shadow-2xl rounded-2xl overflow-hidden',
          'flex flex-col bg-white',
          '[&>button.absolute]:hidden' // hide base DialogContent's built-in X button
        )}
        onOpenAutoFocus={e => e.preventDefault()}
      >
        {/* Search header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 shrink-0">
          <Search size={17} className="text-slate-400 shrink-0" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search help…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X size={15} />
            </button>
          )}
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-500"
            aria-label="Close help center"
          >
            <X size={17} />
          </button>
        </div>

        {/* Body: TOC + content */}
        <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
          {/* TOC — desktop: fixed left panel; mobile: horizontal scroll row */}
          <nav
            className={cn(
              'bg-slate-50 border-b border-slate-100 lg:border-b-0 lg:border-r',
              'shrink-0',
              'lg:w-[220px] lg:overflow-y-auto lg:flex-col lg:flex',
              'flex overflow-x-auto lg:overflow-x-hidden',
              'flex-row lg:flex-col'
            )}
            style={{ minHeight: 0 }}
          >
            <div className="flex flex-row lg:flex-col gap-0.5 p-2 min-w-max lg:min-w-0 lg:w-full">
              {HELP_SECTIONS.map(section => {
                const Icon = ICON_MAP[section.icon] ?? HelpCircle
                const isActive = section.id === activeSectionId && !query
                return (
                  <button
                    key={section.id}
                    onClick={() => selectSection(section.id)}
                    title={section.title}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium',
                      'transition-colors whitespace-nowrap lg:whitespace-normal text-left',
                      'lg:w-full',
                      isActive
                        ? 'bg-violet-600 text-white'
                        : 'text-slate-600 hover:bg-white hover:text-slate-900'
                    )}
                  >
                    <Icon
                      size={16}
                      className={cn('shrink-0', isActive ? 'text-white' : 'text-slate-400')}
                    />
                    <span className="hidden lg:block truncate">{section.title}</span>
                  </button>
                )
              })}
            </div>
          </nav>

          {/* Right panel */}
          <div className="flex flex-1 min-w-0 overflow-hidden flex-col lg:flex-row">
            {query ? (
              /* Search results */
              <div ref={contentRef} className="flex-1 overflow-y-auto p-5">
                <SearchResults
                  query={query}
                  sections={HELP_SECTIONS}
                  onSelect={(sectionId, itemId) => selectItem(sectionId, itemId)}
                />
              </div>
            ) : (
              <>
                {/* Item list — shown on desktop as a secondary panel */}
                <div
                  className={cn(
                    'hidden lg:flex flex-col border-r border-slate-100 overflow-y-auto',
                    'w-[200px] shrink-0'
                  )}
                >
                  <div className="p-2 space-y-0.5">
                    <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {activeSection.title}
                    </p>
                    {activeSection.items.map(item => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActiveItemId(item.id)
                          contentRef.current?.scrollTo({ top: 0 })
                        }}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-lg text-[12.5px] transition-colors',
                          item.id === activeItem?.id
                            ? 'bg-violet-50 text-violet-700 font-semibold'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        )}
                      >
                        {item.title}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Mobile: item switcher as pills above content */}
                <div className="lg:hidden flex overflow-x-auto gap-1.5 px-4 py-2 border-b border-slate-100 shrink-0">
                  {activeSection.items.map(item => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveItemId(item.id)
                        contentRef.current?.scrollTo({ top: 0 })
                      }}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-[11.5px] font-medium whitespace-nowrap transition-colors',
                        item.id === activeItem?.id
                          ? 'bg-violet-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      )}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>

                {/* Content area */}
                <div ref={contentRef} className="flex-1 overflow-y-auto p-5 lg:p-7">
                  {activeItem && (
                    <>
                      <h2 className="text-[18px] font-bold text-slate-900 mb-1">
                        {activeItem.title}
                      </h2>
                      <div className="h-px bg-slate-100 mb-5" />
                      <ItemContent
                        item={activeItem}
                        onRelatedClick={navigateToItem}
                      />
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
