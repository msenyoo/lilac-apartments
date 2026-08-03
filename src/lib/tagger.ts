export const FLAT_CODES = [
  'AF1','AF2','AG1','AP1',
  'BF1','BF2','BF3','BF4','BF5','BF6','BG1','BG2','BP1','BP2','BS1','BS2',
  'CF1','CF2','CF3','CF4','CF5','CF6','CG1','CG2','CP1','CP2','CS1','CS2',
  'DF1','DF2','DF3','DF4','DG1','DG2','DP1','DP2',
  'EF1','EF2','EF3','EF4','EG1','EG2','EP1','EP2',
]

export const UPI_SENDER_MAP: Record<string, string> = {
  '8826794317':'EF2','9382999928':'EF4','8754599878':'DF1',
  'haranhari332':'CS2','balajiiravi':'EP2','chinnarasachin':'BF5',
  'chinnarasa':'BF5','selvarajmuhil':'BG2','nandakishore7':'AP1',
  'maheswarankasir':'BF1','ahmedtechupdate':'BS2','gramaswamy52':'CF6',
  'saranritha82':'EF1','saranritha':'EF1','anand.appu213':'EG1',
  '1963pravi':'CF4','9487287926':'CF5','shakilasuresh07':'CP1',
  '9789836543':'BP1','smuthuvels':'EF2','karthickguna88':'DF2',
  'kalairv':'DF4','sowmiyajayarama':'EF3','vishnuveera58':'DF3',
  'gobinath.balu':'BF5','rajeshkodichath':'BF2','er.gunaseelan':'BP2',
  '9443736753':'EF4','arunrathin87':'BS1','rangaprasad89':'DG1',
  '9894800286':'DP1','7845156129':'DP2','ramasubramanian':'DP2',
  'smuralidharan':'AF1','vickysivam1':'CS1','9384121776':'CS1',
  '8217262143':'BS1','sonyeswar':'BF1','baski92':'CF5',
  'gunasekaran.177':'BG1','imvsuresh':'CG1','dassthangaraju':'EG1',
  'pkarthik1415':'CP2','mathanvn':'DG2','callvasanth':'EP2',
  'kams.sudhan':'EG2','thiripurasundar':'DG2','jayapaul123':'BS2',
  '9600595100':'BF6','dinesh.gc':'DG2','msenyoo':'DP1',
  'ihmeugene':'AG1','9566647490':'EP1','sankaranarayana':'EP1',
  'muruganand':'EG1','saravanan.av81':'EF1',
}

export const NEFT_SENDER_MAP: Record<string, string> = {
  'C I DHINESH KUMAR':'BF4','SELVAPANDIAN VI':'BF3',
  'KARTHIKEYAN MAN':'CF3','SENTHILKUMAR M':'DP1',
  'MATHIVANAN A M':'CP2','MATHIVANANAM MA':'CP2',
  'SNVEERALAKSHMANAN':'CG2','SN VEERA LAKSHMANAN':'CG2',
  'EUGENE J':'AG1','SENTHILKUM':'DP1','BALASUBRAMANIAN':'CG1',
}

const EXPENSE_PATTERNS: Array<[RegExp, string]> = [
  [/salary|eugeneag1|eugene\s*j/i,          'SALARY'],
  [/\beb[/\s]|\beb$|rajacg2|electricity/i,  'EB'],
  [/sewage|sewagetanker|sewagework/i,        'SEWAGE'],
  [/civil|civilwork|initialpayment|pvcpipes/i,'CIVIL'],
  [/lift\s*service|liftservice/i,            'LIFT SERVICE'],
  [/\blift\b/i,                              'LIFT'],
  [/internet/i,                              'INTERNET'],
  [/cctv|soakpit/i,                          'CCTV/MOTOR'],
  [/trf to fd|transfer to fd/i,              'FD'],
  [/miscellaneous|marexpenses|augexpenses|monthlyexpenses|octnovexpenses|janexpenses|\bexpenses\b|senthilhdf/i, 'EXPENSES'],
]

export const INCOME_CATS = ['SB Interest', 'FD Interest']

// FD interest must match before the generic SB pattern
const INCOME_PATTERNS: Array<[RegExp, string]> = [
  [/int on fd/i,           'FD Interest'],
  [/int\.pd|interest/i,    'SB Interest'],
]

export interface TagResult {
  flatCode:   string
  category:   string
  corpus:     'YES' | 'NO'
  confidence: 'Auto' | 'REVIEW'
}

export function tagTransaction(
  description: string,
  crDr: string,
  dynamicUpiMap: Record<string, string> = {},
): TagResult {
  const upper = description.toUpperCase()
  const lower = description.toLowerCase()
  const isCorpus = /corpus/i.test(description)

  // 1. Direct flat code match
  for (const flat of FLAT_CODES) {
    if (new RegExp(`(?<![A-Z0-9])${flat}(?![A-Z0-9])`).test(upper)) {
      return { flatCode: flat, category: isCorpus ? 'Corpus' : 'Maintenance', corpus: isCorpus ? 'YES' : 'NO', confidence: 'Auto' }
    }
  }

  // 2. Dynamic UPI map (from residents table — highest priority after flat code)
  for (const [sender, flat] of Object.entries(dynamicUpiMap)) {
    if (lower.includes(sender.toLowerCase())) {
      return { flatCode: flat, category: isCorpus ? 'Corpus' : 'Maintenance', corpus: isCorpus ? 'YES' : 'NO', confidence: 'Auto' }
    }
  }

  // 3. Hardcoded UPI sender map (fallback)
  for (const [sender, flat] of Object.entries(UPI_SENDER_MAP)) {
    if (lower.includes(sender.toLowerCase())) {
      return { flatCode: flat, category: isCorpus ? 'Corpus' : 'Maintenance', corpus: isCorpus ? 'YES' : 'NO', confidence: 'Auto' }
    }
  }

  // 4. NEFT sender match
  for (const [sender, flat] of Object.entries(NEFT_SENDER_MAP)) {
    if (upper.includes(sender.toUpperCase())) {
      return { flatCode: flat, category: isCorpus ? 'Corpus' : 'Maintenance', corpus: isCorpus ? 'YES' : 'NO', confidence: 'Auto' }
    }
  }

  // 5. Expense patterns (DR only)
  if (crDr === 'DR') {
    for (const [pattern, label] of EXPENSE_PATTERNS) {
      if (pattern.test(description)) {
        return { flatCode: label, category: label, corpus: 'NO', confidence: 'Auto' }
      }
    }
  }

  // 6. Income patterns (CR only) — bank interest credits
  if (crDr === 'CR') {
    for (const [pattern, label] of INCOME_PATTERNS) {
      if (pattern.test(description)) {
        return { flatCode: label, category: label, corpus: 'NO', confidence: 'Auto' }
      }
    }
  }

  return { flatCode: 'UNKNOWN', category: 'UNKNOWN', corpus: 'NO', confidence: 'REVIEW' }
}

export interface LegacyMapping {
  token:    string
  type:     'UPI' | 'NEFT'
  flatCode: string
}

// Diffs the hardcoded maps above against sender IDs already saved on residents, so the
// Sender Mappings tab only lists entries that haven't been migrated into the DB yet.
export function getLegacyMappings(existingUpiIds: string[]): LegacyMapping[] {
  const existing = new Set(existingUpiIds.map(id => id.toLowerCase()))
  const pending: LegacyMapping[] = []
  for (const [token, flatCode] of Object.entries(UPI_SENDER_MAP)) {
    if (!existing.has(token.toLowerCase())) pending.push({ token, type: 'UPI', flatCode })
  }
  for (const [token, flatCode] of Object.entries(NEFT_SENDER_MAP)) {
    if (!existing.has(token.toLowerCase())) pending.push({ token, type: 'NEFT', flatCode })
  }
  return pending
}

// Best-effort guess at the sender identifier inside a raw bank description. Used only to
// prefill an editable field during transaction review — never saved without human confirmation.
export function guessSenderToken(description: string): string {
  const upiMatch = description.match(/UPI\/([^/]+)/i)
  if (upiMatch) return upiMatch[1].trim()

  const cleaned = description
    .replace(/^(NEFT|IMPS|RTGS)\b[\s-]*/i, '')
    .replace(/^(CR|DR)-/i, '')
    .replace(/^[A-Z]{2,}\d*-/i, '')
  const parts = cleaned.split('-').map(p => p.trim()).filter(Boolean)
  return parts.length > 0 ? parts[0] : description.trim()
}

// Best-effort type label for an already-saved sender ID, for display only. Bank-transfer
// sender names always contain a space when saved (e.g. "senthilkumar m"); UPI handles and
// phone-numbers-as-UPI-handles never do. Not stored — inferred fresh each render.
export function guessSenderIdType(id: string): 'UPI' | 'NEFT' {
  return id.trim().includes(' ') ? 'NEFT' : 'UPI'
}

// ── FISCAL HELPERS ────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Bank PSV dates are DD/MM/YYYY — parse manually to avoid V8 treating them as MM/DD/YYYY
function parseBankDate(dateStr: string): Date {
  const [day, month, year] = dateStr.split('/')
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
}

// Convert DD/MM/YYYY → YYYY-MM-DD for Postgres date columns
export function bankDateToISO(dateStr: string): string {
  if (!dateStr) return ''
  const [day, month, year] = dateStr.split('/')
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

// Convert "HH:MM:SS AM/PM" → 24-hour "HH:MM:SS"
export function bankTimeTo24h(timeStr: string | null): string | null {
  if (!timeStr) return null
  const m = timeStr.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return null
  let hh = parseInt(m[1], 10)
  const ampm = m[4].toUpperCase()
  if (ampm === 'PM' && hh !== 12) hh += 12
  if (ampm === 'AM' && hh === 12) hh = 0
  return `${String(hh).padStart(2, '0')}:${m[2]}:${m[3]}`
}

export function getFiscalLabel(dateStr: string): string {
  const d = parseBankDate(dateStr)
  return `${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`
}

export function getFiscalYear(dateStr: string): number {
  const d = parseBankDate(dateStr)
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
}

export function getFiscalMonth(dateStr: string): string {
  const d = parseBankDate(dateStr)
  return MONTHS[d.getMonth()]
}

// ── STATEMENT PARSERS ─────────────────────────────────────────
export interface ParsedTransaction {
  txnId:       string
  valueDate:   string   // DD/MM/YYYY
  postedDate:  string   // DD/MM/YYYY
  postedTime:  string | null   // HH:MM:SS AM/PM, when the source column includes it
  description: string
  crDr:        'CR' | 'DR'
  amount:      number
}

// Convert any common date format → DD/MM/YYYY for downstream consistency
function normaliseToDMY(raw: string): string {
  const s = raw.trim()
  // Already DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s
  // DD-MM-YYYY
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return s.replace(/-/g, '/')
  // YYYY-MM-DD (ISO)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  // DD/MM/YY
  const dmy2 = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2})$/)
  if (dmy2) {
    const yr = parseInt(dmy2[3]) > 50 ? `19${dmy2[3]}` : `20${dmy2[3]}`
    return `${dmy2[1].padStart(2,'0')}/${dmy2[2].padStart(2,'0')}/${yr}`
  }
  // DD MMM YYYY (e.g. "01 Jan 2024")
  const dMonY = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/)
  if (dMonY) {
    const MM: Record<string,string> = {
      jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
      jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
    }
    const mm = MM[dMonY[2].toLowerCase()] ?? '01'
    return `${dMonY[1].padStart(2,'0')}/${mm}/${dMonY[3]}`
  }
  return s
}

// Split a CSV line respecting double-quoted fields
function splitCsvLine(line: string, delim = ','): string[] {
  const fields: string[] = []
  let inQ = false, cur = ''
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ }
    else if (ch === delim && !inQ) { fields.push(cur.trim()); cur = '' }
    else cur += ch
  }
  fields.push(cur.trim())
  return fields
}

interface ColMap { date: number; desc: number; debit: number; credit: number; txnId: number }

function detectCsvCols(headers: string[]): ColMap | null {
  const h = headers.map(s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim())
  const find = (...terms: string[]) => h.findIndex(s => terms.some(t => s.includes(t)))

  const date   = find('value date', 'txn date', 'transaction date', 'date')
  const desc   = find('transaction remarks', 'narration', 'description', 'particulars', 'remark')
  const debit  = find('withdrawal', 'debit', ' dr ')
  const credit = find('deposit', 'credit', ' cr ')
  const txnId  = find('transaction id', 'ref no', 'chq no', 'cheque no', 'reference')

  if (date < 0 || desc < 0 || (debit < 0 && credit < 0)) return null
  return { date, desc, debit, credit, txnId }
}

// ICICI pipe-delimited PSV (legacy format)
export function parsePipeStatement(rawText: string): ParsedTransaction[] {
  const lines = rawText.split(/\r?\n/)
  const results: ParsedTransaction[] = []
  let headerFound = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.includes('Transaction ID') && trimmed.includes('Description')) {
      headerFound = true; continue
    }
    if (!headerFound) continue
    const cols = trimmed.split('|')
    if (cols.length < 8) continue
    if (!/^\d+$/.test(cols[0].trim())) continue
    const crDr = cols[6].trim().toUpperCase()
    if (crDr !== 'CR' && crDr !== 'DR') continue
    const [postedDate, ...postedTimeParts] = cols[3].trim().split(' ')
    results.push({
      txnId:       cols[1].trim(),
      valueDate:   cols[2].trim(),
      postedDate,
      postedTime:  postedTimeParts.length > 0 ? postedTimeParts.join(' ') : null,
      description: cols[5].trim(),
      crDr:        crDr as 'CR' | 'DR',
      amount:      parseFloat(cols[7].trim().replace(/,/g, '')) || 0,
    })
  }
  return results
}

// Generic CSV (comma or semicolon delimited) — auto-detects columns from header row
export function parseCsvStatement(rawText: string): ParsedTransaction[] {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  // Detect delimiter
  const sample = lines.slice(0, 5).join('\n')
  const delim = (sample.match(/;/g)?.length ?? 0) > (sample.match(/,/g)?.length ?? 0) ? ';' : ','

  // Find header row (within first 20 lines)
  let headerIdx = -1
  let map: ColMap | null = null
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const cols = splitCsvLine(lines[i], delim)
    map = detectCsvCols(cols)
    if (map) { headerIdx = i; break }
  }
  if (headerIdx < 0 || !map) return []

  const m = map
  const results: ParsedTransaction[] = []

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delim)
    if (cols.length <= Math.max(m.date, m.desc)) continue

    const dateRaw = cols[m.date] ?? ''
    const desc    = cols[m.desc] ?? ''
    if (!dateRaw || !desc) continue

    const debitAmt  = m.debit  >= 0 ? parseFloat((cols[m.debit]  ?? '').replace(/,/g, '')) || 0 : 0
    const creditAmt = m.credit >= 0 ? parseFloat((cols[m.credit] ?? '').replace(/,/g, '')) || 0 : 0
    if (debitAmt === 0 && creditAmt === 0) continue

    const crDr: 'CR' | 'DR' = creditAmt > 0 ? 'CR' : 'DR'
    const dmy = normaliseToDMY(dateRaw)

    results.push({
      txnId:       m.txnId >= 0 ? (cols[m.txnId] ?? '') : '',
      valueDate:   dmy,
      postedDate:  dmy,
      postedTime:  null,
      description: desc,
      crDr,
      amount:      creditAmt > 0 ? creditAmt : debitAmt,
    })
  }
  return results
}

// Auto-detect format and parse
export function parseStatement(rawText: string): ParsedTransaction[] {
  const head = rawText.slice(0, 2000)
  const pipeCount  = (head.match(/\|/g) ?? []).length
  const commaCount = (head.match(/,/g)  ?? []).length
  if (pipeCount > commaCount) return parsePipeStatement(rawText)
  const csvRows = parseCsvStatement(rawText)
  if (csvRows.length > 0) return csvRows
  // Fallback: try PSV even if fewer pipes
  return parsePipeStatement(rawText)
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}
