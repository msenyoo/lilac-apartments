export interface BulkDraftRow {
  key: string
  paid_date: string
  description: string
  amount: string
  category_id: string
  cost_center: string
  payment_mode: 'Cash' | 'Online' | 'Bank Transfer' | 'Cheque'
  payee_type: 'Staff' | 'Vendor' | 'Utility' | 'Municipal' | 'Other'
  staff_id: string
  vendor_id: string
  payee_name_raw: string
  corpus_plan_id: string
  reference_no: string
  notes: string
}

export const COST_CENTERS = ['Block-A', 'Block-B', 'Block-C', 'Block-D', 'Block-E', 'Common', 'Municipal', 'All']
export const PAYMENT_MODES = ['Cash', 'Online', 'Bank Transfer', 'Cheque'] as const
export const PAYEE_TYPES = ['Other', 'Staff', 'Vendor', 'Utility', 'Municipal'] as const

export function emptyRow(): BulkDraftRow {
  return {
    key: crypto.randomUUID(),
    paid_date: '',
    description: '',
    amount: '',
    category_id: '',
    cost_center: 'Common',
    payment_mode: 'Cash',
    payee_type: 'Other',
    staff_id: '',
    vendor_id: '',
    payee_name_raw: '',
    corpus_plan_id: '',
    reference_no: '',
    notes: '',
  }
}

// Accepts dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd; returns yyyy-mm-dd or ''
export function parseDateCell(raw: string): string {
  const s = raw.trim().replace(/\s.*$/, '')
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return toISO(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  if (m) return toISO(+m[3], +m[2], +m[1])
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/)
  if (m) return toISO(2000 + +m[3], +m[2], +m[1])
  return ''
}

function toISO(y: number, mo: number, d: number): string {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return ''
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return ''
  return dt.toISOString().slice(0, 10)
}

function parseAmountCell(raw: string): string {
  const n = Number(raw.replace(/[₹,\s]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return ''
  return String(Math.round(n))
}

// Tab-separated rows copied from Excel/Sheets: Date ⇥ Description ⇥ Amount ⇥ [Category]
export function parseClipboard(
  text: string,
  categories: { id: string; name: string }[],
): BulkDraftRow[] {
  const catByName = new Map(categories.map(c => [c.name.trim().toLowerCase(), c.id]))
  const rows: BulkDraftRow[] = []
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('\t').map(c => c.trim())
    while (cells.length && cells[0] === '') cells.shift()
    while (cells.length && cells[cells.length - 1] === '') cells.pop()
    if (cells.length === 0) continue
    const [dateCell = '', descCell = '', amountCell = '', catCell = ''] = cells
    // Skip total/blank rows: no date and no description
    if (!dateCell && !descCell) continue
    rows.push({
      ...emptyRow(),
      paid_date: parseDateCell(dateCell),
      description: descCell,
      amount: parseAmountCell(amountCell),
      category_id: catByName.get(catCell.toLowerCase()) ?? '',
    })
  }
  return rows
}

export function isRowEmpty(r: BulkDraftRow): boolean {
  return !r.paid_date && !r.description.trim() && !r.amount
}

export function rowErrors(r: BulkDraftRow): Partial<Record<'paid_date' | 'description' | 'amount' | 'category_id', string>> {
  const errs: ReturnType<typeof rowErrors> = {}
  if (!r.paid_date) errs.paid_date = 'Required'
  if (!r.description.trim()) errs.description = 'Required'
  const amt = Number(r.amount)
  if (!r.amount || !Number.isInteger(amt) || amt <= 0) errs.amount = 'Must be > 0'
  if (!r.category_id) errs.category_id = 'Required'
  return errs
}
