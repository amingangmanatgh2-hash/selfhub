/* SelfHub — موتور تصمیم moderation
 * ورودی: تنظیمات چت + واقعیت‌های پیام + تاریخچه‌ی کاربر. خروجی: چه کاری انجام شود.
 * هیچ I/O ندارد؛ همه‌ی تست‌های امنیتی این فایل روی همین تابع‌هاست.
 */

import type { Action, ChatSettings } from '../types.ts'
import { countDuplicate, isFlooding } from './flood.ts'
import { hasInviteLink, hasLink, linkDomains, normalize, upperRatio, wordHits } from './words.ts'

export const ACTION_RANK: Record<Action, number> = {
  none: 0,
  delete: 1,
  warn: 2,
  mute: 3,
  kick: 4,
  ban: 5,
}

/** یک نقض قاعده: کدام قانون، چه تنبیهی، با چه توضیحی */
export interface Violation {
  rule: 'words' | 'links' | 'length' | 'caps' | 'media' | 'flood' | 'duplicate' | 'joinban'
  action: Action
  muteMin: number
  detail: string
}

export interface MsgFacts {
  messageId: number
  fromId: number
  isBot: boolean
  text: string
  firstName: string
  lastName?: string
  username: string
  mediaTypes: string[]
  isForward: boolean
  chatType: string
  /** ثانیه */
  date: number
  viaBot?: boolean
}

export interface HistoryEntry {
  timestamps: number[]
  texts: string[]
}

export interface DecideOpts {
  isAdmin: boolean
  warnPoints: number
  /** دامنه/آی‌دی کانال‌های خود چت که اجازه دارند فوروارد/لینک بدهند */
  allowDomains?: string[]
}

export interface Decision {
  delete: boolean
  action: Action
  muteMin: number
  reasons: string[]
  violations: Violation[]
}

const EMPTY: Decision = { delete: false, action: 'none', muteMin: 0, reasons: [], violations: [] }

function strongest(violations: Violation[]): { action: Action; muteMin: number } {
  let action: Action = 'none'
  let muteMin = 0
  for (const v of violations) {
    if (ACTION_RANK[v.action] > ACTION_RANK[action]) action = v.action
    if (v.action === 'mute' || v.action === 'ban') muteMin = Math.max(muteMin, v.muteMin || 0)
  }
  return { action, muteMin }
}

/** نردبان اخطار: با رسیدن به سقف، تبدیل به سکوت می‌شود */
export function warnLadder(points: number, limit: number, action: Action, muteMin: number): { action: Action; muteMin: number } {
  if (limit > 0 && points >= limit) {
    const escalated: Action = action === 'ban' ? 'ban' : action === 'kick' ? 'kick' : 'mute'
    return { action: escalated, muteMin: escalated === 'mute' ? Math.max(1, muteMin || 60) : 0 }
  }
  return { action: 'warn', muteMin: 0 }
}

export function decide(s: ChatSettings, m: MsgFacts, h: HistoryEntry, o: DecideOpts): Decision {
  if (!s.moderation) return EMPTY
  // ادمین‌ها و خود ربات مشمول فیلترهای محتوایی نمی‌شوند
  if (m.isBot || o.isAdmin) return EMPTY

  const violations: Violation[] = []
  const text = m.text ?? ''
  const now = m.date

  if (s.words.on && s.words.patterns.length) {
    const hits = wordHits(text, s.words.patterns)
    for (const rule of hits) {
      violations.push({ rule: 'words', action: s.words.action, muteMin: s.words.muteMin, detail: `الگوی «${rule}» در متن` })
    }
  }

  if (s.links.on && hasLink(text)) {
    const allow = new Set((o.allowDomains ?? []).map(d => normalize(d)))
    const domains = linkDomains(text).map(d => normalize(d))
    const onlyAllowed = domains.length > 0 && domains.every(d => allow.has(d))
    if (!(s.links.allowOwnChannel && onlyAllowed)) {
      violations.push({
        rule: 'links',
        action: s.links.action,
        muteMin: 0,
        detail: hasInviteLink(text) ? 'لینک عضویت (اسپم‌ریسک بالا)' : `لینک: ${domains.slice(0, 3).join('، ') || 'نامشخص'}`,
      })
    }
  }

  if (s.length.on && normalize(text).length > s.length.maxChars) {
    violations.push({ rule: 'length', action: s.length.action, muteMin: 0, detail: `حجم پیام ${text.length} نویسه است` })
  }

  if (s.caps.on && upperRatio(text) > s.caps.maxRatio && normalize(text).length >= s.caps.minChars) {
    violations.push({ rule: 'caps', action: s.caps.action, muteMin: 0, detail: 'بیشتر متن بزرگ‌نویس است' })
  }

  if (s.media.on && s.media.blocked.length) {
    for (const t of m.mediaTypes) {
      if ((s.media.blocked as string[]).includes(t)) {
        violations.push({ rule: 'media', action: 'delete', muteMin: 0, detail: `نوع رسانه‌ی ممنوع: ${t}` })
      }
    }
  }

  if (s.flood.on && isFlooding(h.timestamps, s.flood.windowSec, s.flood.max, now)) {
    violations.push({
      rule: 'flood',
      action: s.flood.action,
      muteMin: s.flood.muteMin,
      detail: `${h.timestamps.length + 1} پیام در ${s.flood.windowSec} ثانیه`,
    })
  }

  if (s.duplicate.on) {
    const times = countDuplicate({ texts: h.texts, stamps: h.timestamps }, text, s.duplicate.windowSec, now, normalize)
    if (times > s.duplicate.max) {
      violations.push({ rule: 'duplicate', action: s.duplicate.action, muteMin: 0, detail: `تکرار ${times}× در ${s.duplicate.windowSec} ثانیه` })
    }
  }

  const { action, muteMin } = strongest(violations)
  if (!violations.length) return EMPTY

  if (action === 'warn') {
    const next = warnLadder(o.warnPoints + 1, s.warnLimit, s.warnAction, s.warnActionMuteMin)
    return {
      delete: true,
      action: next.action,
      muteMin: next.muteMin,
      reasons: violations.map(v => v.detail),
      violations,
    }
  }

  return { delete: action !== 'none', action, muteMin, reasons: violations.map(v => v.detail), violations }
}

/** بررسی نام/یوزرنیم عضو تازه (کارخانه‌های جوین/ربات‌های اسپم) */
export function joinBanHit(s: ChatSettings, firstName: string, username: string): string | null {
  if (!s.joinBan.on) return null
  const hay = normalize(`${firstName} ${username}`)
  for (const raw of s.joinBan.namePatterns) {
    const p = normalize(String(raw ?? ''))
    if (!p) continue
    if (p.startsWith('regex:')) {
      try {
        const re = new RegExp(raw.slice(6), 'iu')
        // الگوی لنگردار ( ^…$ ) باید روی هر فیلد جدا هم بسنجد
        if (re.test(`${firstName} ${username}`) || re.test(firstName) || re.test(username)) return raw
      } catch {
        /* الگوی خراب → نادیده */
      }
      continue
    }
    if (hay.includes(p)) return raw
  }
  return null
}

export interface MutePlan {
  /** until_date برای restrictChatMember (ثانیه)؛ ۰ یعنی نامحدود */
  untilDate: number
  minutes: number
}

export function mutePlan(minutes: number, nowSec: number): MutePlan {
  if (minutes <= 0) return { untilDate: 0, minutes: 0 }
  const capped = Math.min(minutes, 365 * 24 * 60)
  return { untilDate: nowSec + capped * 60, minutes: capped }
}
