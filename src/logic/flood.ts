/* SelfHub — ردیاب فلود و پیام تکراری
 * ماژول خالص: آرایه‌ی زمان‌ها را می‌گیرد و تصمیم می‌دهد.
 */

/** نگه‌داشتن فقط زمان‌های داخل پنجره */
export function prune(timestamps: number[], windowSec: number, nowSec: number): number[] {
  const from = nowSec - windowSec
  const out: number[] = []
  for (const t of timestamps) if (t > from) out.push(t)
  return out
}

export function isFlooding(timestamps: number[], windowSec: number, max: number, nowSec: number): boolean {
  if (max <= 0) return false
  return prune(timestamps, windowSec, nowSec).length + 1 > max
}

export interface DuplicateWindow {
  texts: string[]
  stamps: number[]
}

/** چند تکرار دقیقاً (یا نرمال‌شده) یکی در پنجره؟ */
export function countDuplicate(win: DuplicateWindow, text: string, windowSec: number, nowSec: number, key: (s: string) => string): number {
  const from = nowSec - windowSec
  const needle = key(text)
  let n = 0
  for (let i = 0; i < win.texts.length; i++) {
    const stamp = win.stamps[i] ?? 0
    if (stamp <= from) continue
    // هم ذخیره‌شده و هم متن جدید از کلید عبور می‌کنند (سليّم یا نرمال‌شده)
    if (key(win.texts[i] ?? '') === needle) n++
  }
  return n + 1
}

export function pushBounded(arr: number[], value: number, cap: number): number[] {
  arr.push(value)
  if (arr.length > cap) arr.splice(0, arr.length - cap)
  return arr
}

/** پاک‌سازی بر اساس TTL — برای map های حافظه‌ای */
export function expired<T extends { exp: number }>(entry: T | undefined, nowMs: number): boolean {
  return !entry || entry.exp <= nowMs
}
