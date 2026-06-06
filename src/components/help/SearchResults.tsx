import { HelpSection, HelpItem } from './helpContent'
import { cn } from '@/lib/utils'

interface SearchResultItem {
  section: HelpSection
  item: HelpItem
  snippet: string
}

function buildSnippet(item: HelpItem, query: string): string {
  const lower = query.toLowerCase()
  const candidates: string[] = [
    item.summary,
    ...(item.steps ?? []).map(s => s.text),
    ...(item.tips ?? []),
    ...(item.examples ?? []).map(e => e.description),
  ]
  for (const c of candidates) {
    if (c.toLowerCase().includes(lower)) return c
  }
  return item.summary
}

function searchItems(query: string, sections: HelpSection[]): SearchResultItem[] {
  const lower = query.toLowerCase().trim()
  if (!lower) return []
  const results: SearchResultItem[] = []

  for (const section of sections) {
    for (const item of section.items) {
      const searchable = [
        item.title,
        item.summary,
        ...(item.steps ?? []).map(s => s.text + ' ' + (s.detail ?? '')),
        ...(item.tips ?? []),
        ...(item.warnings ?? []),
        ...(item.examples ?? []).map(e => e.label + ' ' + e.description),
      ]
        .join(' ')
        .toLowerCase()

      if (searchable.includes(lower)) {
        results.push({
          section,
          item,
          snippet: buildSnippet(item, lower),
        })
      }
    }
    if (results.length >= 10) break
  }

  return results.slice(0, 10)
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const lower = text.toLowerCase()
  const lowerQ = query.toLowerCase()
  const idx = lower.indexOf(lowerQ)
  if (idx === -1) return <>{text}</>

  const before = text.slice(0, idx)
  const match = text.slice(idx, idx + query.length)
  const after = text.slice(idx + query.length)

  return (
    <>
      {before}
      <mark className="bg-violet-100 text-violet-800 rounded px-0.5 not-italic">{match}</mark>
      {after}
    </>
  )
}

interface Props {
  query: string
  sections: HelpSection[]
  onSelect: (sectionId: string, itemId: string) => void
}

export default function SearchResults({ query, sections, onSelect }: Props) {
  const results = searchItems(query, sections)

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <svg
          className="w-12 h-12 mb-3 opacity-30"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <p className="text-[14px] font-medium">No results for "{query}"</p>
        <p className="text-[12.5px] mt-1">Try different keywords or browse sections on the left.</p>
      </div>
    )
  }

  const grouped: Record<string, SearchResultItem[]> = {}
  results.forEach(r => {
    const key = r.section.id
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(r)
  })

  return (
    <div className="space-y-5">
      <p className="text-[12px] text-slate-400">
        {results.length} result{results.length !== 1 ? 's' : ''} for "{query}"
      </p>
      {Object.entries(grouped).map(([, items]) => (
        <div key={items[0].section.id}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            {items[0].section.title}
          </p>
          <div className="space-y-1.5">
            {items.map(({ item, snippet }) => (
              <button
                key={item.id}
                onClick={() => onSelect(items[0].section.id, item.id)}
                className={cn(
                  'w-full text-left px-4 py-3 rounded-xl border border-transparent',
                  'hover:bg-violet-50 hover:border-violet-100 transition-colors group'
                )}
              >
                <p className="text-[13.5px] font-semibold text-slate-800 group-hover:text-violet-700 mb-0.5">
                  <HighlightedText text={item.title} query={query} />
                </p>
                <p className="text-[12px] text-slate-500 leading-relaxed line-clamp-2">
                  <HighlightedText text={snippet} query={query} />
                </p>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
