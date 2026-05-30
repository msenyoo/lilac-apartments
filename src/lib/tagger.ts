export const FLAT_CODES = [
  'AF1','AF2','AG1','AP1',
  'BF1','BF2','BF3','BF4','BF5','BF6','BG1','BG2','BP1','BP2','BS1','BS2',
  'CF1','CF2','CF3','CF4','CF5','CF6','CG1','CG2','CP1','CP2','CS1','CS2',
  'DF1','DF2','DF3','DF4','DG1','DG2','DP1','DP2',
  'EF1','EF2','EF3','EF4','EG1','EG2','EP1','EP2',
]

const UPI_SENDER_MAP: Record<string, string> = {
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

const NEFT_SENDER_MAP: Record<string, string> = {
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
  [/int on fd|int\.pd|interest/i,            'INTEREST'],
  [/trf to fd|transfer to fd/i,              'FD'],
  [/miscellaneous|marexpenses|augexpenses|monthlyexpenses|octnovexpenses|janexpenses|\bexpenses\b|senthilhdf/i, 'EXPENSES'],
]

export interface TagResult {
  flatCode:   string
  category:   string
  corpus:     'YES' | 'NO'
  confidence: 'Auto' | 'REVIEW'
}

export function tagTransaction(description: string, crDr: string): TagResult {
  const upper = description.toUpperCase()
  const lower = description.toLowerCase()
  const isCorpus = /corpus/i.test(description)

  // 1. Direct flat code match
  for (const flat of FLAT_CODES) {
    if (new RegExp(`(?<![A-Z0-9])${flat}(?![A-Z0-9])`).test(upper)) {
      return {
        flatCode: flat,
        category: isCorpus ? 'Corpus' : 'Maintenance',
        corpus: isCorpus ? 'YES' : 'NO',
        confidence: 'Auto',
      }
    }
  }

  // 2. UPI sender match
  for (const [sender, flat] of Object.entries(UPI_SENDER_MAP)) {
    if (lower.includes(sender.toLowerCase())) {
      return {
        flatCode: flat,
        category: isCorpus ? 'Corpus' : 'Maintenance',
        corpus: isCorpus ? 'YES' : 'NO',
        confidence: 'Auto',
      }
    }
  }

  // 3. NEFT sender match
  for (const [sender, flat] of Object.entries(NEFT_SENDER_MAP)) {
    if (upper.includes(sender.toUpperCase())) {
      return {
        flatCode: flat,
        category: isCorpus ? 'Corpus' : 'Maintenance',
        corpus: isCorpus ? 'YES' : 'NO',
        confidence: 'Auto',
      }
    }
  }

  // 4. Expense patterns (DR only)
  if (crDr === 'DR') {
    for (const [pattern, label] of EXPENSE_PATTERNS) {
      if (pattern.test(description)) {
        return { flatCode: label, category: label, corpus: 'NO', confidence: 'Auto' }
      }
    }
  }

  return { flatCode: 'UNKNOWN', category: 'UNKNOWN', corpus: 'NO', confidence: 'REVIEW' }
}

// ── FISCAL HELPERS ────────────────────────────────────────────
export function getFiscalLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`
}

export function getFiscalYear(dateStr: string): number {
  const d = new Date(dateStr)
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
}

export function getFiscalMonth(dateStr: string): string {
  const d = new Date(dateStr)
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]
}

// ── PIPE FILE PARSER ──────────────────────────────────────────
export interface ParsedTransaction {
  txnId:       string
  valueDate:   string
  postedDate:  string
  description: string
  crDr:        'CR' | 'DR'
  amount:      number
}

export function parsePipeStatement(rawText: string): ParsedTransaction[] {
  const lines = rawText.split(/\r?\n/)
  const results: ParsedTransaction[] = []
  let headerFound = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.includes('Transaction ID') && trimmed.includes('Description')) {
      headerFound = true
      continue
    }
    if (!headerFound) continue
    const cols = trimmed.split('|')
    if (cols.length < 8) continue
    if (!/^\d+$/.test(cols[0].trim())) continue

    const crDr = cols[6].trim().toUpperCase()
    if (crDr !== 'CR' && crDr !== 'DR') continue

    results.push({
      txnId:       cols[1].trim(),
      valueDate:   cols[2].trim(),
      postedDate:  cols[3].trim(),
      description: cols[5].trim(),
      crDr:        crDr as 'CR' | 'DR',
      amount:      parseFloat(cols[7].trim().replace(/,/g, '')) || 0,
    })
  }

  return results
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}
