// Shared AGM letterhead — logo header + address footer for all @react-pdf/renderer documents
import { Text, View, Image } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'
import letterheadLogo from '@/assets/lilac-letterhead-logo.png'

export const ASSOCIATION_ADDRESS = 'Plot No 1, Rajarajeswari Nagar, Rajakilpakkam - Chennai 600073'

export function LetterheadHeader({ style, children }: { style: Style | Style[]; children?: React.ReactNode }) {
  return (
    <View style={style}>
      <Image src={letterheadLogo} style={{ width: 150, height: 43, marginBottom: 6 }} />
      {children}
    </View>
  )
}

export function LetterheadFooter({ style, generated }: { style: Style | Style[]; generated: string }) {
  return (
    <Text style={style} fixed>
      The Lilac Apartment Association · {ASSOCIATION_ADDRESS} · Generated {generated}
    </Text>
  )
}
