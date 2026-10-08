/* SelfHub — تنظیمات: پیش‌فرض‌ها، ادغام ایمن و اعتبارسنجی
 * ورودی پنل وب «هر چیزی» می‌تواند باشد؛ اینجا همه‌چیز بازسازی و clamp می‌شود
 * تا هیچ مقدار نامعتبری به موتور moderation نرسد.
 */

import type { Action, ChatSettings, ChatType, GlobalSettings, MessageType } from '../types.ts'
import { clamp, toInt } from '../util.ts'

const ACTIONS: Action[] = ['none', 'delete', 'warn', 'mute', 'kick', 'ban']
const CHAT_TYPES: ChatType[] = ['private', 'group', 'supergroup', 'channel']
const MEDIA: MessageType[] = [
  'photo',
  'sticker',
  'document',
  'video',
  'voice',
  'audio',
  'animation',
  'video_note',
  'contact',
  'location',
  'venue',
  'poll',
  'dice',
]

function act(v: unknown, fallback: Action): Action {
  return ACTIONS.includes(String(v) as Action) ? (v as Action) : fallback
}

function strArr(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return []
  return (v as unknown[])
    .map(x => String(x ?? '').slice(0, 200))
    .filter(Boolean)
    .slice(0, cap)
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** تنظیمات پیش‌فرض برای یک چت تازه */
export function defaultSettings(chat?: { id: number; title?: string; type?: ChatType }): ChatSettings {
  return {
    title: chat?.title ?? '',
    type: chat?.type ?? 'supergroup',
    moderation: true,
    adminOnlyCommands: true,
    autoreply: true,
    welcome: true,
    welcomeText: 'خوش آمدی {name} 🌸\nقاعده‌ها را با /rules بخوان.',
    leaveMsg: false,
    rulesText: '۱. احترام.\n۲. اسپم و لینک تبلیغاتی نه.\n۳. موضوع چت را نگه‌دار.',
    captcha: false,
    captchaTimeoutMin: 10,
    flood: { on: true, windowSec: 8, max: 6, action: 'delete', muteMin: 5 },
    words: { on: true, patterns: [], action: 'delete', muteMin: 10 },
    links: { on: true, allowInvite: false, allowOwnChannel: true, action: 'delete' },
    caps: { on: false, minChars: 12, maxRatio: 0.7, action: 'delete' },
    media: { on: false, blocked: [] },
    duplicate: { on: true, windowSec: 30, max: 3, action: 'delete' },
    joinBan: { on: false, namePatterns: [] },
    length: { on: false, maxChars: 1500, action: 'delete' },
    warnLimit: 3,
    warnAction: 'mute',
    warnActionMuteMin: 60,
    broadcast: false,
    logChatId: null,
  }
}

export function defaultGlobal(): GlobalSettings {
  return {
    tzOffsetMin: 210,
    admins: [],
    defaults: defaultSettings(),
    broadcastMaxPerTick: 20,
    broadcastGapMs: 120,
    helpFooter: 'SelfHub',
  }
}

type Group = 'flood' | 'words' | 'links' | 'caps' | 'media' | 'duplicate' | 'joinBan' | 'length'

/** ادغام patch نامعتبر با base — هیچ کلیدی گم نمی‌شود و هیچ مقداری خارج از بازه نمی‌ماند */
export function mergeSettings(base: ChatSettings, patch: unknown): ChatSettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
  const out: ChatSettings = { ...base }

  /** زیرشیءِ ایمن: اگر object نبود آرایه‌ی خالی می‌دهیم تا typeof بازی نکند */
  const sub = (key: Group): Record<string, unknown> => {
    const v = p[key]
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  }

  out.title = String(p.title ?? base.title).slice(0, 80)
  if (CHAT_TYPES.includes(p.type as ChatType)) out.type = p.type as ChatType
  out.moderation = bool(p.moderation, base.moderation)
  out.adminOnlyCommands = bool(p.adminOnlyCommands, base.adminOnlyCommands)
  out.autoreply = bool(p.autoreply, base.autoreply)
  out.welcome = bool(p.welcome, base.welcome)
  out.leaveMsg = bool(p.leaveMsg, base.leaveMsg)
  out.captcha = bool(p.captcha, base.captcha)
  out.captchaTimeoutMin = clamp(toInt(p.captchaTimeoutMin, base.captchaTimeoutMin), 1, 240)
  out.broadcast = bool(p.broadcast, base.broadcast)
  out.welcomeText = String(p.welcomeText ?? base.welcomeText).slice(0, 900)
  out.rulesText = String(p.rulesText ?? base.rulesText).slice(0, 900)

  {
    const s = sub('flood')
    out.flood = {
      on: bool(s.on, base.flood.on),
      windowSec: clamp(toInt(s.windowSec, base.flood.windowSec), 2, 600),
      max: clamp(toInt(s.max, base.flood.max), 2, 100),
      action: act(s.action, base.flood.action),
      muteMin: clamp(toInt(s.muteMin, base.flood.muteMin), 0, 43200),
    }
  }
  {
    const s = sub('words')
    out.words = {
      on: bool(s.on, base.words.on),
      patterns: Array.isArray(s.patterns) ? strArr(s.patterns, 200) : base.words.patterns,
      action: act(s.action, base.words.action),
      muteMin: clamp(toInt(s.muteMin, base.words.muteMin), 0, 43200),
    }
  }
  {
    const s = sub('links')
    out.links = {
      on: bool(s.on, base.links.on),
      allowInvite: bool(s.allowInvite, base.links.allowInvite),
      allowOwnChannel: bool(s.allowOwnChannel, base.links.allowOwnChannel),
      action: act(s.action, base.links.action),
    }
  }
  {
    const s = sub('caps')
    out.caps = {
      on: bool(s.on, base.caps.on),
      minChars: clamp(toInt(s.minChars, base.caps.minChars), 2, 500),
      maxRatio: clamp(Number(s.maxRatio ?? base.caps.maxRatio), 0.05, 1),
      action: act(s.action, base.caps.action),
    }
  }
  {
    const s = sub('media')
    const blocked = Array.isArray(s.blocked)
      ? ((s.blocked as unknown[]).map(String).filter(x => MEDIA.includes(x as MessageType)) as MessageType[])
      : base.media.blocked
    out.media = { on: bool(s.on, base.media.on), blocked }
  }
  {
    const s = sub('duplicate')
    out.duplicate = {
      on: bool(s.on, base.duplicate.on),
      windowSec: clamp(toInt(s.windowSec, base.duplicate.windowSec), 5, 3600),
      max: clamp(toInt(s.max, base.duplicate.max), 2, 50),
      action: act(s.action, base.duplicate.action),
    }
  }
  {
    const s = sub('joinBan')
    out.joinBan = {
      on: bool(s.on, base.joinBan.on),
      namePatterns: Array.isArray(s.namePatterns) ? strArr(s.namePatterns, 60) : base.joinBan.namePatterns,
    }
  }
  {
    const s = sub('length')
    out.length = {
      on: bool(s.on, base.length.on),
      maxChars: clamp(toInt(s.maxChars, base.length.maxChars), 20, 4096),
      action: act(s.action, base.length.action),
    }
  }

  out.warnLimit = clamp(toInt(p.warnLimit, base.warnLimit), 0, 20)
  out.warnAction = act(p.warnAction, base.warnAction)
  out.warnActionMuteMin = clamp(toInt(p.warnActionMuteMin, base.warnActionMuteMin), 0, 43200)
  const log = p.logChatId === null || p.logChatId === undefined ? base.logChatId : toInt(p.logChatId, 0)
  out.logChatId = log === 0 ? null : log

  return out
}

export function mergeGlobal(base: GlobalSettings, patch: unknown): GlobalSettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
  return {
    tzOffsetMin: clamp(toInt(p.tzOffsetMin, base.tzOffsetMin), -720, 840),
    admins: Array.isArray(p.admins)
      ? (p.admins as unknown[]).map(x => toInt(x, 0)).filter(n => n > 0).slice(0, 50)
      : base.admins,
    defaults: p.defaults ? mergeSettings(base.defaults, p.defaults) : base.defaults,
    broadcastMaxPerTick: clamp(toInt(p.broadcastMaxPerTick, base.broadcastMaxPerTick), 1, 100),
    broadcastGapMs: clamp(toInt(p.broadcastGapMs, base.broadcastGapMs), 0, 5000),
    helpFooter: String(p.helpFooter ?? base.helpFooter).slice(0, 120),
  }
}

/** آیا این دستور برای فرستنده مجاز است؟ */
export function canRun(settings: ChatSettings, global: GlobalSettings, userId: number, isAdmin: boolean, isPrivate: boolean): boolean {
  if (isPrivate) return global.admins.includes(userId)
  if (!settings.adminOnlyCommands) return true
  return isAdmin || global.admins.includes(userId)
}
