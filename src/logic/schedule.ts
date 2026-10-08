/* SelfHub — زمان‌بند: تحلیل رشته‌ی زمان و محاسبه‌ی نوبت بعد
 * ماژول خالص و تست‌پذیر. «at» و «now» هر دو epoch ثانیه (UTC) هستند.
 */

const UNITS: Record<string, number> = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1, ثانیه: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60, دقیقه: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, ساعت: 3600,
  d: 86400, day: 86400, days: 86400, روز: 86400,
  w: 604800, week: 604800, weeks: 604800, هفته: 604800,
  mo: 2592000, month: 2592000, months: 2592000, ماه: 2592000,
}

const FA_DIGITS = /[\u06F0-\u06F9\u0660-\u0669]/g

export function toLatinDigits(s: string): string {
  if (!FA_DIGITS.test(s)) return s
  return s
    .replace(/[\u06F0-\u06F9]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x06f0 + 48))
    .replace(/[\u0660-\u0669]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x0660 + 48))
}

export function toPersianDigits(s: string): string {
  return s.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d)
}

export interface ParsedWhen {
  /** epoch ثانیه (UTC) */
  at: number
  /** اگر تکرارشونده باشد (ثانیه) */
  everySec: number
  /** متنی که برای زمان مصرف شد (برای جداکردن از بدنه‌ی پیام) */
  consumed: string
}

function parts(nowSec: number, tzOffsetMin: number): { y: number; mo: number; d: number } {
  const d = new Date((nowSec + tzOffsetMin * 60) * 1000)
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() }
}

function mkEpoch(y: number, mo: number, d: number, h: number, mi: number, tzOffsetMin: number): number {
  return Math.floor(Date.UTC(y, mo - 1, d, h, mi) / 1000) - tzOffsetMin * 60
}

function unitSec(n: number, unit: string): number | null {
  const mul = UNITS[String(unit).toLowerCase().trim()]
  return mul ? Math.round(n * mul) : null
}

/**
 * ورودی‌های پشتیبانی‌شده:
 *   `+30m` ، `+2h` ، `۴۵ ثانیه` ، `30 دقیقه دیگه`
 *   `every 15m` / `هر ۳۰ دقیقه`
 *   `14:30` ، `today 14:30` ، `فردا ۸:۰۰`
 *   `2026-10-09 08:00`
 */
export function parseWhen(input: string, nowSec: number, tzOffsetMin = 0): ParsedWhen | null {
  const raw = toLatinDigits(String(input ?? '').trim()).replace(/\u200c/g, ' ')
  if (!raw) return null

  let everySec = 0
  let body = raw

  const every = body.match(/^(?:every|هر)\s+(\d+(?:\.\d+)?)\s*(\S+)/i)
  if (every) {
    const sec = unitSec(Number(every[1]), every[2] ?? '')
    if (sec && sec >= 30) {
      everySec = sec
      body = body.slice(every[0].length).trim()
    }
  }

  // ۱) نسبی: `+30m` ، `۴۵ ثانیه` ، `30 دقیقه دیگه`
  const rel = body.match(/^\+?\s*(\d+(?:\.\d+)?)\s*([a-zA-Z\u0600-\u06FF]+)(?:\s+(?:دیگه|دیگر|بعد|بعد از این|later|from now))?/)
  if (rel) {
    const sec = unitSec(Number(rel[1]), rel[2] ?? '')
    if (sec !== null) {
      const at = Math.max(nowSec + Math.max(sec, everySec), nowSec + 5)
      return { at, everySec, consumed: rel[0] }
    }
  }

  // ۲) تاریخ کامل
  const full = body.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/)
  if (full) {
    const at = mkEpoch(Number(full[1]), Number(full[2]), Number(full[3]), Number(full[4]), Number(full[5]), tzOffsetMin)
    if (Number.isFinite(at)) return { at, everySec, consumed: full[0] }
  }

  // ۳) ساعت روز (با پیشوند امروز/فردا)
  const dayWord = body.match(/^(today|امروز|tomorrow|فردا)\s+/i)
  let dayShift = 0
  if (dayWord) {
    dayShift = /tomorrow|فردا/i.test(dayWord[0]) ? 1 : 0
    body = body.slice(dayWord[0].length)
  }

  const clock = body.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/)
  if (clock) {
    const p = parts(nowSec, tzOffsetMin)
    const h = Number(clock[1])
    const mi = Number(clock[2])
    if (h <= 23 && mi <= 59) {
      let at = mkEpoch(p.y, p.mo, p.d + (dayWord ? dayShift : 0), h, mi, tzOffsetMin)
      if (!dayWord && at <= nowSec) at += 86400
      if (everySec > 0) at += Math.max(0, Math.ceil((nowSec + everySec - at) / everySec)) * everySec
      return { at, everySec, consumed: `${dayWord?.[0] ?? ''}${clock[0]}`.trim() }
    }
  }

  // ۴) فقط «هر X دقیقه»
  if (everySec > 0) return { at: nowSec + everySec, everySec, consumed: raw }

  return null
}

/** نوبت بعدی پس از ارسال؛ ۰ یعنی یک‌بارمصرف و تمام */
export function nextAfter(at: number, everySec: number, nowSec: number): number {
  if (everySec <= 0) return 0
  let next = at + everySec
  while (next <= nowSec) next += everySec
  return next
}

export function humanUntil(at: number, nowSec: number): string {
  const diff = Math.max(0, at - nowSec)
  if (diff < 60) return `${toPersianDigits(String(diff))} ثانیه دیگر`
  const m = Math.floor(diff / 60)
  if (m < 60) return `${toPersianDigits(String(m))} دقیقه دیگر`
  const h = Math.floor(m / 60)
  if (h < 24) return `${toPersianDigits(String(h))} ساعت و ${toPersianDigits(String(m % 60))} دقیقه دیگر`
  return `${toPersianDigits(String(Math.floor(h / 24)))} روز و ${toPersianDigits(String(h % 24))} ساعت دیگر`
}

export function formatClock(at: number, tzOffsetMin: number): string {
  const d = new Date((at + tzOffsetMin * 60) * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return toPersianDigits(`${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`)
}

/** برچسب تکرار */
export function everyLabel(everySec: number): string {
  if (everySec <= 0) return 'یک‌بار'
  const m = Math.round(everySec / 60)
  if (m < 60) return `هر ${toPersianDigits(String(m))} دقیقه`
  const h = Math.round(m / 60)
  if (h < 24) return `هر ${toPersianDigits(String(h))} ساعت`
  return `هر ${toPersianDigits(String(Math.round(h / 24)))} روز`
}
