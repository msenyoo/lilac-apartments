// App-wide date display convention: dd-mm-yyyy everywhere.
// Parses the y-m-d prefix directly (not `new Date(iso)`) to avoid UTC/local
// timezone shifting a date-only string to the wrong day.
export function formatDateDMY(value: string | null | undefined): string {
  if (!value) return '—'
  const [datePart] = value.split('T')
  const [y, m, d] = datePart.split('-')
  if (!y || !m || !d) return '—'
  return `${d}-${m}-${y}`
}
