import { supabase } from './supabase'

export interface FlatContact {
  name: string
  type: 'Owner' | 'Tenant'
  relation: string
  waPhone: string
}

// Payer side first: the tenant/guardian actually pays; the owner is notified.
function rank(c: { type: string; relation: string }) {
  if (c.type === 'Tenant' && c.relation === 'Self') return 0
  if (c.relation === 'Guardian') return 1
  if (c.type === 'Tenant') return 2
  if (c.type === 'Owner' && c.relation === 'Self') return 3
  if (c.relation === 'Co-owner') return 4
  return 5
}

export function toWaPhone(phone: string | null): string | null {
  const raw = (phone ?? '').replace(/\D/g, '')
  if (!raw) return null
  return raw.length === 10 ? `91${raw}` : raw
}

export async function fetchFlatContactsByCode(flatCode: string): Promise<FlatContact[]> {
  const { data: f } = await supabase.from('flats').select('id').eq('code', flatCode).maybeSingle()
  if (!f) return []
  const { data } = await supabase
    .from('residents').select('name, type, relation, phone')
    .eq('flat_id', f.id).eq('is_active', true)
  return (data ?? [])
    .map(r => ({ name: r.name, type: r.type as 'Owner' | 'Tenant', relation: r.relation as string, waPhone: toWaPhone(r.phone) }))
    .filter((c): c is FlatContact => c.waPhone !== null)
    .sort((a, b) => rank(a) - rank(b))
}
