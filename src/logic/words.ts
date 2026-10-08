/* SelfHub — نرمال‌سازی متن و تطبیق الگو (فارسی/عربی/انگلیسی)
 * ماژول خالص: بدون I/O، کاملاً تست‌پذیر.
 */

/** حروف فارسی/عربیِ هم‌شکل، ارقام، و نویسه‌های نامرئی را یکدست می‌کند */
export function normalize(input: string): string {
  let s = String(input ?? '')
  s = s.replace(/[\u064B-\u0652\u0670\u0640]/g, '') // اعراب و تتویه
  s = s.replace(/[\u200B\u200D\u200E\u200F\u2060\ufeff]/g, '') // نویسه‌های نامرئی (ZWNJ \|u200c نگهداشته می‌شود)
  s = s.replace(/\u064A/g, '\u06CC').replace(/\u0643/g, '\u06A9') // ي→ی، ك→ک
  s = s.replace(/[\u06F0-\u06F9]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x06f0 + 48)) // ۰-۹
  s = s.replace(/[\u0660-\u0669]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x0660 + 48)) // ۰-۹ عربی
  s = s.toLowerCase()
  return s.replace(/\s+/g, ' ').trim()
}

const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g

function escapeRe(s: string): string {
  return s.replace(RE_SPECIAL, '\\$&')
}

/** ساخت RegExp از الگوی کاربر. `regex:` پیش‌رونده دارد؛ `*` در الگوی ساده یعنی «هرچیز» */
export function compilePattern(pattern: string): RegExp | null {
  const raw = String(pattern ?? '').trim()
  if (!raw) return null
  if (raw.startsWith('regex:')) {
    try {
      return new RegExp(raw.slice(6), 'iu')
    } catch {
      return null
    }
  }
  const body = normalize(raw)
  if (!body) return null
  const parts = body.split('*').map(escapeRe)
  try {
    return new RegExp(parts.join('[\\s\\S]*'), 'iu')
  } catch {
    return null
  }
}

export interface CompiledRule {
  source: string
  re: RegExp
}

export function compileAll(patterns: string[]): CompiledRule[] {
  const out: CompiledRule[] = []
  for (const p of patterns) {
    const re = compilePattern(p)
    if (re) out.push({ source: String(p), re })
  }
  return out
}

/** اولین الگویی که بخورد برگردانده می‌شود، وگرنه null */
export function firstMatch(text: string, patterns: string[]): string | null {
  if (!text) return null
  const hay = normalize(text)
  for (const p of patterns) {
    const raw = String(p ?? '').trim()
    if (!raw) continue
    if (raw.startsWith('regex:')) {
      const re = compilePattern(raw)
      if (re && re.test(text)) return raw
      continue
    }
    const needle = normalize(raw)
    if (!needle) continue
    if (needle.includes('*')) {
      const re = compilePattern(raw)
      if (re && re.test(hay)) return raw
      continue
    }
    if (hay.includes(needle)) return raw
  }
  return null
}

/** همه‌ی الگوهایی که در متن خورده‌اند (بدون تکرار) */
export function wordHits(text: string, patterns: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of patterns) {
    const hit = firstMatch(text, [p])
    if (hit && !seen.has(hit)) {
      seen.add(hit)
      out.push(hit)
    }
  }
  return out
}

export function matchesKeyword(mode: 'contains' | 'exact' | 'regex' | 'starts', text: string, pattern: string): boolean {
  const t = normalize(text)
  const p = normalize(pattern)
  switch (mode) {
    case 'exact':
      return t === p
    case 'starts':
      return t.startsWith(p)
    case 'regex': {
      try {
        return new RegExp(pattern, 'iu').test(text)
      } catch {
        return false
      }
    }
    default:
      return p.length > 0 && t.includes(p)
  }
}

const LINK_RE = /\b(?:https?:\/\/|www\.)\S+|\b[tT]\.me\/\S+|\bd?go\.instagram\.com\/\S+|\bwa\.me\/\S+/
const INVITE_RE =
  /(?:^|\s)(?:https?:\/\/)?(?:www\.)?(?:t(?:elegram)?\.me|telegram\.dog)\/(?:\+|joinchat\/|invite\/)[^\s]+|\b(?:t\.me)\/\+[\w-]+/i

export function hasLink(text: string): boolean {
  return LINK_RE.test(String(text ?? ''))
}

/** لینک عضویت (join / t.me/+…) — خطرناک‌ترین نوع برای اسپم */
export function hasInviteLink(text: string): boolean {
  return INVITE_RE.test(String(text ?? ''))
}

/** دامنه‌های داخل متن */
export function linkDomains(text: string): string[] {
  const out = new Set<string>()
  const re = /https?:\/\/([^\s/]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const host = (m[1] ?? '').toLowerCase()
    if (host) out.add(host)
  }
  const re2 = /\bt\.me\/([\w]+)/gi
  while ((m = re2.exec(text)) !== null) {
    const h = m[1]
    if (h) out.add(`t.me/${h.toLowerCase()}`)
  }
  return [...out]
}

export function upperRatio(text: string): number {
  const letters = [...text].filter(c => /\p{L}/u.test(c))
  if (!letters.length) return 0
  const upper = letters.filter(c => c === c.toUpperCase() && c !== c.toLowerCase()).length
  return upper / letters.length
}

export function isMostlyDigitsOrUrls(text: string): boolean {
  const t = text.replace(/\s+/g, '')
  if (!t) return false
  const nonText = (t.match(/[\d\u06F0-\u06F9\u0660-\u0669+._\-/]/g) ?? []).length
  return nonText / t.length > 0.7
}

/** فاصله‌ی نشانی (Levenshtein) تا ۴ — برای «فقط نزدیکِ کلمه» */
export function editDistance(a: string, b: string, max = 4): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev = new Array<number>(b.length + 1)
  const cur = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost)
      if (cur[j]! < rowMin) rowMin = cur[j]!
    }
    if (rowMin > max) return max + 1
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!
  }
  return prev[b.length]!
}

/** آیا کلمه‌ای از لیست (با تلورانس تایپو ۱) در متن هست؟ */
export function fuzzyWordHit(text: string, words: string[]): string | null {
  const hay = normalize(text)
  const tokens = hay.split(/[\s.,!?:;()[\]{}«»"'`ـ]+/).filter(Boolean)
  for (const w of words) {
    const needle = normalize(w)
    if (needle.length < 3) {
      if (hay.includes(needle) && needle) return w
      continue
    }
    for (const tk of tokens) {
      if (editDistance(tk, needle, 1) <= 1) return w
    }
  }
  return null
}
