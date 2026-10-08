/* SelfHub — قالب‌بندی پیام‌های تلگرام (HTML) و رشته‌های فارسی */

import type { Action, ModlogRow, TgUser } from './types.ts'

export function escHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function faInt(n: number): string {
  const s = Math.round(n || 0).toLocaleString('en-US')
  const fa = s.replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d)
  return fa.replace(/,/g, '٬')
}

export function truncate(s: string, n = 120): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t
}

export function userLabel(u?: Partial<TgUser> | null): string {
  if (!u) return 'ناشناس'
  const uname = String(u.username ?? '').trim()
  if (uname) return `@${uname}`
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return name || String(u.id ?? '—')
}

export function mention(u?: Partial<TgUser> | null): string {
  if (!u?.id) return escHtml(userLabel(u))
  return `<a href="tg://user?id=${u.id}">${escHtml([u.first_name, u.last_name].filter(Boolean).join(' ') || userLabel(u))}</a>`
}

const TPL_RE = /\{(name|first|last|username|id|group|title|count|time|date)\}/g

/** جای‌گذاری متغیرها در قالب: {name} {group} {time} … */
export function tpl(text: string, vars: Record<string, string | number | undefined>): string {
  return String(text ?? '').replace(TPL_RE, (_m, k: string) => {
    const v = vars[k]
    return v === undefined || v === null ? '' : String(v)
  })
}

export function actionLabel(a: Action): string {
  switch (a) {
    case 'delete':
      return 'حذف'
    case 'warn':
      return 'اخطار'
    case 'mute':
      return 'سکوت'
    case 'kick':
      return 'اخراج'
    case 'ban':
      return 'بن'
    default:
      return 'بدون اقدام'
  }
}

export function ruleLabel(rule: string): string {
  switch (rule) {
    case 'words':
      return 'کلمات ممنوعه'
    case 'links':
      return 'لینک'
    case 'length':
      return 'حجم پیام'
    case 'caps':
      return 'بزرگ‌نویسی افراطی'
    case 'media':
      return 'رسانه‌ی ممنوع'
    case 'flood':
      return 'فلود'
    case 'duplicate':
      return 'تکرار پیام'
    case 'joinban':
      return 'عضویت مشکوک'
    default:
      return rule
  }
}

export function chatTypeLabel(t: string): string {
  switch (t) {
    case 'group':
      return 'گروه'
    case 'supergroup':
      return 'ابرگروه'
    case 'channel':
      return 'کانال'
    default:
      return 'شخصی'
  }
}

const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']

export function faDateTime(tsSec: number, tzOffsetMin = 0): string {
  const d = new Date((tsSec + tzOffsetMin * 60) * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}`
  return `${date} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

export function faWeekday(tsSec: number, tzOffsetMin = 0): string {
  return WEEKDAYS[new Date((tsSec + tzOffsetMin * 60) * 1000).getUTCDay()] ?? ''
}

export function modlogLine(r: ModlogRow, tzOffsetMin = 0): string {
  const t = faDateTime(Math.floor(r.ts / 1000), tzOffsetMin)
  const target = r.targetId ? `→ <code>${r.targetId}</code> ${escHtml(r.targetName)}` : ''
  const reason = r.reason ? ` <i>(${escHtml(truncate(r.reason, 60))})</i>` : ''
  return `<code>${escHtml(t)}</code> ${escHtml(r.action)} ${target} توسط ${escHtml(truncate(r.moderator, 24))}${reason}`
}

/** خلاصه‌ی وضعیت moderation برای پاسخ /status */
export function statusLines(name: string, s: { moderation: boolean; autoreply: boolean; welcome: boolean; captcha: boolean; flood: { on: boolean; max: number }; warnLimit: number }): string[] {
  const on = (b: boolean): string => (b ? '✅' : '❌')
  return [
    `<b>${escHtml(name)}</b>`,
    `${on(s.moderation)} مدیریت فعال`,
    `${on(s.autoreply)} پاسخ به کلیدواژه`,
    `${on(s.welcome)} خوش‌آمد`,
    `${on(s.captcha)} تأیید انسانی`,
    `${on(s.flood.on)} فلود (حداکثر ${faInt(s.flood.max)} پیام در پنجره)`,
    `سقف اخطار: ${faInt(s.warnLimit)}`,
  ]
}
