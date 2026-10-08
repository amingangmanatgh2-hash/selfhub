/* SelfHub — آمار و نمودار
 * توابع خالص روی ردیف‌های روزانه/ساعتی. نمودار خطی SVG هم اینجا ساخته می‌شود
 * تا پنل و `/stats` تلگرام از یک منبع تغذیه شوند.
 */

export interface DayRow {
  chatId?: number
  day: string
  msgs: number
  members: number
  deleted: number
  warns: number
  mutes: number
  bans: number
  replies: number
  commands: number
}

export interface Totals {
  days: number
  msgs: number
  members: number
  deleted: number
  warns: number
  mutes: number
  bans: number
  replies: number
  commands: number
  avgMsgsPerDay: number
}

type StatKey = 'msgs' | 'members' | 'deleted' | 'warns' | 'mutes' | 'bans' | 'replies' | 'commands'

const NUMS: StatKey[] = ['msgs', 'members', 'deleted', 'warns', 'mutes', 'bans', 'replies', 'commands']

export function totals(rows: DayRow[]): Totals {
  const t: Totals = {
    days: rows.length,
    msgs: 0,
    members: 0,
    deleted: 0,
    warns: 0,
    mutes: 0,
    bans: 0,
    replies: 0,
    commands: 0,
    avgMsgsPerDay: 0,
  }
  for (const r of rows) {
    for (const k of NUMS) t[k] += Number(r[k] ?? 0)
  }
  t.avgMsgsPerDay = rows.length ? Math.round(t.msgs / rows.length) : 0
  return t
}

export interface Series {
  labels: string[]
  values: number[]
  max: number
  sum: number
}

export function series(rows: DayRow[], key: keyof DayRow = 'msgs'): Series {
  const sorted = [...rows].sort((a, b) => (a.day < b.day ? -1 : 1))
  const values = sorted.map(r => Number(r[key] ?? 0))
  return {
    labels: sorted.map(r => r.day.slice(5)),
    values,
    max: values.length ? Math.max(...values) : 0,
    sum: values.reduce((a, b) => a + b, 0),
  }
}

/** رشد ۷ روز آخر نسبت به ۷ روز قبل‌تر */
export function growth(rows: DayRow[], half = 7): { pct: number; dir: 'up' | 'down' | 'flat'; now: number; prev: number } {
  const sorted = [...rows].sort((a, b) => (a.day < b.day ? -1 : 1))
  const take = (arr: DayRow[]): number => arr.reduce((s, r) => s + Number(r.msgs ?? 0), 0)
  const recent = sorted.slice(-half)
  const prev = sorted.slice(-half * 2, -half)
  const n = take(recent)
  const p = take(prev)
  if (!p) return { pct: n > 0 ? 100 : 0, dir: n > 0 ? 'up' : 'flat', now: n, prev: p }
  const pct = Math.round(((n - p) / p) * 100)
  return { pct, dir: pct > 2 ? 'up' : pct < -2 ? 'down' : 'flat', now: n, prev: p }
}

export function hourlySeries(hours: { hour: number; msgs: number }[], count: number, nowHour: number): Series {
  const map = new Map<number, number>()
  for (const h of hours) map.set(Number(h.hour), Number(h.msgs ?? 0))
  const labels: string[] = []
  const values: number[] = []
  for (let i = count - 1; i >= 0; i--) {
    const hour = nowHour - i
    labels.push(String(((hour % 24) + 24) % 24).padStart(2, '0'))
    values.push(map.get(hour) ?? 0)
  }
  return { labels, values, max: values.length ? Math.max(...values) : 0, sum: values.reduce((a, b) => a + b, 0) }
}

/** مسیر SVG برای sparkline — تست می‌شود که همیشه عددی و در جعبه بماند */
export function sparkPath(values: number[], w: number, h: number, pad = 2): string {
  if (!values.length) return ''
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const innerW = Math.max(1, w - pad * 2)
  const innerH = Math.max(1, h - pad * 2)
  const step = values.length > 1 ? innerW / (values.length - 1) : 0
  return values
    .map((v, i) => {
      const x = pad + i * step
      const y = pad + innerH - ((v - min) / span) * innerH
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/** نمودار میله‌ی متنی برای `/stats` داخل تلگرام */
export function bars(values: number[], width = 12): string[] {
  const max = Math.max(...values, 1)
  return values.map(v => '▇'.repeat(Math.max(v > 0 ? 1 : 0, Math.round((v / max) * width))))
}

export interface RankRow {
  key: string
  label: string
  value: number
}

export function rank(rows: RankRow[], n = 5): RankRow[] {
  return [...rows].sort((a, b) => b.value - a.value).slice(0, n)
}

export function csv(rows: DayRow[]): string {
  const head = 'day,msgs,members,deleted,warns,mutes,bans,replies,commands'
  const lines = rows.map(r =>
    [r.day, r.msgs, r.members, r.deleted, r.warns, r.mutes, r.bans, r.replies, r.commands].join(','),
  )
  return [head, ...lines].join('\n')
}
