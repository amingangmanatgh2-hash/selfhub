/* SelfHub — موتور رویدادها و دستورات
 * تمام تعامل با Telegram اینجاست. داده و وضعیت از طریق HubCtx تزریق می‌شود
 * تا این فایل وابستگی به Durable Object نداشته باشد و قابل تست بماند.
 */

import { kb } from './bot.ts'
import type { TelegramBot } from './bot.ts'
import { canRun } from './logic/settings.ts'
import { everyLabel, formatClock, humanUntil, nextAfter, parseWhen } from './logic/schedule.ts'
import { bars, totals } from './logic/stats.ts'
import { decide, joinBanHit, mutePlan } from './logic/rules.ts'
import type { HistoryEntry, MsgFacts } from './logic/rules.ts'
import { matchesKeyword } from './logic/words.ts'
import type {
  ChatSettings,
  GlobalSettings,
  KeywordRule,
  MessageType,
  ModlogRow,
  Note,
  ScheduledJob,
  TgCallbackQuery,
  TgMessage,
  TgUpdate,
  TgUser,
  WarnRow,
} from './types.ts'
import { nowSec } from './util.ts'
import { actionLabel, chatTypeLabel, escHtml, faDateTime, faInt, mention, modlogLine, ruleLabel, statusLines, tpl, truncate, userLabel } from './tgfmt.ts'

export type StatField = 'msgs' | 'members' | 'deleted' | 'warns' | 'mutes' | 'bans' | 'replies' | 'commands'

export interface HubCtx {
  bot: () => TelegramBot
  botId: () => number
  global: () => Promise<GlobalSettings>
  settings: (chatId: number) => Promise<ChatSettings>
  patchSettings: (chatId: number, patch: Partial<ChatSettings>) => Promise<ChatSettings>
  ensureChat: (chat: { id: number; title?: string; type?: string }) => Promise<ChatSettings>
  isAdmin: (chatId: number, userId: number) => Promise<boolean>
  history: (chatId: number, userId: number, text: string, at: number) => HistoryEntry
  bump: (chatId: number, field: StatField, n?: number) => Promise<void>
  log: (level: 'info' | 'success' | 'warn' | 'error', msg: string, chatId?: number | null) => void
  modlog: (row: Omit<ModlogRow, 'id' | 'ts'>) => Promise<void>
  modlogList: (chatId: number | null, limit: number) => Promise<ModlogRow[]>
  getWarn: (chatId: number, userId: number) => Promise<WarnRow>
  setWarn: (chatId: number, userId: number, points: number, reason: string) => Promise<void>
  statsRows: (chatId: number | null, days: number) => Promise<StatsRow[]>
  hourly: (chatId: number | null, hours: number) => Promise<{ hour: number; msgs: number }[]>
  memberCount: (chatId: number) => Promise<number>
  notes: (chatId: number) => Promise<Note[]>
  getNote: (chatId: number, name: string) => Promise<Note | null>
  saveNote: (chatId: number, name: string, text: string, by: number) => Promise<void>
  delNote: (chatId: number, name: string) => Promise<boolean>
  hitNote: (chatId: number, name: string) => Promise<void>
  keywords: (chatId: number) => Promise<KeywordRule[]>
  hitKeyword: (id: number) => Promise<void>
  jobs: (chatId: number | null) => Promise<ScheduledJob[]>
  addJob: (job: Omit<ScheduledJob, 'id' | 'lastSent' | 'sentCount'>) => Promise<ScheduledJob>
  delJob: (id: number, chatId: number) => Promise<boolean>
  markSent: (id: number, nextAt: number) => Promise<void>
  verifyAdd: (chatId: number, userId: number, msgId: number, expSec: number) => Promise<void>
  verifyDone: (chatId: number, userId: number) => Promise<{ msgId: number } | null>
  verifyExpired: (now: number) => Promise<{ chatId: number; userId: number }[]>
  broadcastList: () => Promise<number[]>
  broadcastState: () => Promise<{ text: string; remaining: number[] } | null>
  broadcastSet: (state: { text: string; remaining: number[] } | null) => Promise<void>
  sleep: (ms: number) => Promise<void>
}

export interface StatsRow {
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

/* ---------------- کمک‌تابع‌ها ---------------- */

function mediaTypesOf(m: TgMessage): MessageType[] {
  const out: MessageType[] = []
  if (m.photo) out.push('photo')
  if (m.sticker) out.push('sticker')
  if (m.document) out.push('document')
  if (m.video) out.push('video')
  if (m.voice) out.push('voice')
  if (m.audio) out.push('audio')
  if (m.animation) out.push('animation')
  if (m.video_note) out.push('video_note')
  if (m.contact) out.push('contact')
  if (m.location) out.push('location')
  if (m.venue) out.push('venue')
  if (m.poll) out.push('poll')
  if (m.dice) out.push('dice')
  return out
}

export function factsOf(m: TgMessage): MsgFacts {
  const from = (m.from ?? m.sender_chat) as (TgUser & { title?: string }) | undefined
  return {
    messageId: m.message_id,
    fromId: m.from?.id ?? (m.sender_chat?.id ? -m.sender_chat.id : 0),
    isBot: m.from?.is_bot === true,
    text: m.text ?? m.caption ?? '',
    firstName: from?.first_name ?? from?.title ?? '',
    lastName: from?.last_name,
    username: from?.username ?? '',
    mediaTypes: mediaTypesOf(m),
    isForward: m.forward_origin !== undefined,
    chatType: m.chat.type,
    date: m.date,
  }
}

function parseCommand(text: string): { name: string; args: string } | null {
  const m = text.trim().match(/^[/!](\w{2,32})(?:@\w{3,32})?\s*([\s\S]*)$/)
  if (!m) return null
  return { name: (m[1] ?? '').toLowerCase(), args: (m[2] ?? '').trim() }
}

function send(ctx: HubCtx, chatId: number, text: string, replyTo?: number, markup?: ReturnType<typeof kb>): Promise<unknown> {
  return ctx
    .bot()
    .sendMessage(chatId, text, { ...(replyTo ? { replyTo } : {}), ...(markup ? { replyMarkup: markup } : {}) })
    .catch(e => {
      ctx.log('warn', `ارسال پیام نرفت: ${String((e as Error).message).slice(0, 120)}`, chatId)
      return null
    })
}

/** مخاطب دستور: ریپلای ← شناسه عددی در متن ← null */
function targetOf(msg: TgMessage, args: string): { user?: TgUser; id: number; label: string } | null {
  const replied = msg.reply_to_message?.from
  if (replied) return { user: replied, id: replied.id, label: userLabel(replied) }
  const num = args.match(/(?<!\d)\d{4,20}(?!\d)/)?.[0]
  if (num) return { id: Number(num), label: `کاربر ${num}` }
  return null
}

/* ---------------- ورودی ---------------- */

export async function processUpdate(ctx: HubCtx, update: TgUpdate): Promise<void> {
  if (update.my_chat_member) {
    const s = update.my_chat_member
    const gone = s.new_chat_member.status === 'left' || s.new_chat_member.status === 'kicked'
    if (gone) {
      ctx.log('warn', `از «${s.chat.title ?? s.chat.id}» خارج شدیم یا حذف شدم`)
      await ctx.patchSettings(s.chat.id, { broadcast: false })
    } else {
      await ctx.ensureChat({ id: s.chat.id, title: s.chat.title ?? s.chat.username, type: s.chat.type })
      ctx.log('success', `در «${s.chat.title ?? s.chat.id}» فعال شدِم — نقش: ${s.new_chat_member.status}`)
    }
    return
  }

  if (update.callback_query) {
    await handleCallback(ctx, update.callback_query)
    return
  }

  const msg = update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post
  if (!msg?.chat) return
  const isEdit = update.edited_message !== undefined || update.edited_channel_post !== undefined

  if (!isEdit) await ctx.ensureChat({ id: msg.chat.id, title: msg.chat.title ?? msg.chat.username, type: msg.chat.type })
  if (msg.new_chat_members?.length) {
    await handleJoins(ctx, msg)
    return
  }
  if (msg.left_chat_member) {
    if (msg.left_chat_member.id === ctx.botId()) return
    const s = await ctx.settings(msg.chat.id)
    if (s.leaveMsg && s.welcome) await send(ctx, msg.chat.id, `${mention(msg.left_chat_member)} رفت 👋`)
    return
  }
  if (msg.pinned_message || msg.migrate_to_chat_id) return

  const text = (msg.text ?? msg.caption ?? '').trim()

  if (!isEdit) await ctx.bump(msg.chat.id, 'msgs')

  if (!isEdit && text) {
    const cmd = parseCommand(text)
    if (cmd) {
      await ctx.bump(msg.chat.id, 'commands')
      if (await runCommand(ctx, msg, cmd.name, cmd.args)) return
    }
    if (await handleNote(ctx, msg, text)) return
  }

  if (await moderate(ctx, msg, isEdit)) return
  if (text && !isEdit) await handleAutoreply(ctx, msg, text)
}

/* ---------------- moderation ---------------- */

export async function moderate(ctx: HubCtx, msg: TgMessage, isEdit: boolean): Promise<boolean> {
  const s = await ctx.settings(msg.chat.id)
  if (!s.moderation) return false
  if (!msg.from) return false // پست رسمی کانال
  const f = factsOf(msg)
  if (!f.fromId) return false

  const global = await ctx.global()
  if (f.isBot || global.admins.includes(f.fromId) || (await ctx.isAdmin(msg.chat.id, f.fromId))) return false

  const warn = await ctx.getWarn(msg.chat.id, f.fromId)
  const h = ctx.history(msg.chat.id, f.fromId, f.text, msg.date)
  const allow: string[] = []
  if (s.links.allowOwnChannel && msg.chat.username) allow.push(`t.me/${msg.chat.username.toLowerCase()}`)
  const d = decide(s, f, h, { isAdmin: false, warnPoints: warn.points, allowDomains: allow })
  if (!d.violations.length) return false
  if (isEdit && d.action === 'warn') return false

  const bot = ctx.bot()
  const reasons = d.violations.map(v => `${ruleLabel(v.rule)}: ${v.detail}`).join(' | ')
  let did = false

  if (d.delete) {
    did = (await bot.deleteMessage(msg.chat.id, msg.message_id)) === true
    if (did) await ctx.bump(msg.chat.id, 'deleted')
  }

  let action = d.action
  if (action === 'warn') {
    const points = warn.points + 1
    await ctx.setWarn(msg.chat.id, f.fromId, points, d.violations[0]?.rule ?? '')
    await ctx.bump(msg.chat.id, 'warns')
    const hitLimit = s.warnLimit > 0 && points >= s.warnLimit
    await send(
      ctx,
      msg.chat.id,
      `${mention(msg.from)} ⚠️ اخطار ${faInt(points)} از ${faInt(s.warnLimit)}\n<code>${escHtml(truncate(reasons, 160))}</code>${hitLimit ? '\nبه سقف اخطار رسیدی.' : ''}`,
    )
    await ctx.modlog({ chatId: msg.chat.id, action: 'اخطار', targetId: f.fromId, targetName: userLabel(msg.from), moderator: 'خودکار', reason: reasons })
    action = hitLimit ? s.warnAction : 'warn'
  }

  if (action === 'mute') {
    const plan = mutePlan(d.muteMin || s.warnActionMuteMin || 10, msg.date)
    await bot.restrict(msg.chat.id, f.fromId, plan.untilDate)
    await ctx.bump(msg.chat.id, 'mutes')
    await send(ctx, msg.chat.id, `${escHtml(userLabel(msg.from))} به مدت ${faInt(plan.minutes)} دقیقه ساکت شد — <code>${escHtml(truncate(reasons, 120))}</code>`)
    did = true
  } else if (action === 'kick') {
    await bot.kick(msg.chat.id, f.fromId)
    did = true
  } else if (action === 'ban') {
    await bot.ban(msg.chat.id, f.fromId, true)
    await ctx.bump(msg.chat.id, 'bans')
    did = true
  }
  if (action === 'kick') await ctx.bump(msg.chat.id, 'bans')
  // هر اقدام خودکار باید در لاگ مدیریتی دیده شود (حذف هم همین‌طور)
  if (action !== 'warn') {
    await ctx.modlog({
      chatId: msg.chat.id,
      action: d.delete && action === 'none' ? 'حذف خودکار' : actionLabel(action),
      targetId: f.fromId,
      targetName: userLabel(msg.from),
      moderator: 'خودکار',
      reason: reasons,
    })
  }
  ctx.log('warn', `اقدام ${actionLabel(action)} روی ${userLabel(msg.from)} — ${truncate(reasons, 90)}`, msg.chat.id)
  return did || action !== 'none'
}

/* ---------------- عضویت تازه ---------------- */

async function handleJoins(ctx: HubCtx, msg: TgMessage): Promise<void> {
  const s = await ctx.settings(msg.chat.id)
  const bot = ctx.bot()
  const members = msg.new_chat_members ?? []
  const global = await ctx.global()
  await ctx.bump(msg.chat.id, 'members', members.length)

  for (const u of members) {
    if (u.id === ctx.botId()) continue
    const bad = joinBanHit(s, u.first_name, u.username ?? '')
    if (bad) {
      await bot.ban(msg.chat.id, u.id, false)
      await ctx.modlog({ chatId: msg.chat.id, action: 'بن خودکار', targetId: u.id, targetName: userLabel(u), moderator: 'خودکار', reason: `نام مشکوک: ${bad}` })
      ctx.log('warn', `عضو مشکوک بن شد: ${userLabel(u)} ← ${bad}`, msg.chat.id)
      continue
    }

    if (s.captcha) {
      const dm = await bot
        .sendMessage(u.id, 'سلام! برای ماندن در گروه تأیید کن که ربات نیستی 👇', {
          replyMarkup: kb([[['✅ من ربات نیستم', `cap:${msg.chat.id}:${u.id}`]]]),
        })
        .catch(() => null)
      if (dm) {
        await ctx.verifyAdd(msg.chat.id, u.id, dm.message_id, msg.date + s.captchaTimeoutMin * 60)
        await send(ctx, msg.chat.id, `${mention(u)} لطفاً در پی‌وی تأیید کن (تا ${faInt(s.captchaTimeoutMin)} دقیقه).`, msg.message_id)
        continue
      }
      ctx.log('warn', `پیام تأیید به ${userLabel(u)} نرسید (پی‌وی بسته) — رد می‌شود`, msg.chat.id)
      await bot.kick(msg.chat.id, u.id)
      continue
    }

    if (s.welcome) {
      const count = await ctx.memberCount(msg.chat.id).catch(() => 0)
      const when = faDateTime(msg.date, global.tzOffsetMin)
      await send(
        ctx,
        msg.chat.id,
        tpl(s.welcomeText, {
          name: userLabel(u),
          first: u.first_name,
          username: u.username ? `@${u.username}` : '',
          id: u.id,
          group: msg.chat.title ?? '',
          title: msg.chat.title ?? '',
          count,
          time: when.split(' ')[1] ?? '',
          date: when.split(' ')[0] ?? '',
        }),
      )
    }
  }
}

async function handleCallback(ctx: HubCtx, q: TgCallbackQuery): Promise<void> {
  const bot = ctx.bot()
  const data = q.data ?? ''
  if (!data.startsWith('cap:')) {
    await bot.answerCallbackQuery(q.id)
    return
  }
  const parts = data.split(':')
  const chatId = Number(parts[1])
  const userId = Number(parts[2])
  if (!Number.isFinite(chatId) || userId !== q.from.id) {
    await bot.answerCallbackQuery(q.id, 'این دکمه برای تو نبود 🙂', true)
    return
  }
  const pend = await ctx.verifyDone(chatId, userId)
  await bot.answerCallbackQuery(q.id, 'تأیید شد ✅')
  if (pend) await bot.deleteMessage(q.from.id, pend.msgId)
  if (q.message) await bot.editMessageText(q.message.chat.id, q.message.message_id, '✅ تأیید شد. خوش آمدی!').catch(() => undefined)
  ctx.log('success', `تأیید انسانی: ${userLabel(q.from)} در ${chatId}`, chatId)
}

/* ---------------- نوت و پاسخ خودکار ---------------- */

async function handleNote(ctx: HubCtx, msg: TgMessage, text: string): Promise<boolean> {
  const m = text.match(/^#([\p{L}\p{N}_]{2,40})$/u)
  if (!m) return false
  const name = (m[1] ?? '').toLowerCase()
  const note = await ctx.getNote(msg.chat.id, name)
  if (!note) return false
  await ctx.hitNote(msg.chat.id, name)
  await send(ctx, msg.chat.id, note.text, msg.message_id)
  await ctx.bump(msg.chat.id, 'replies')
  return true
}

async function handleAutoreply(ctx: HubCtx, msg: TgMessage, text: string): Promise<void> {
  const s = await ctx.settings(msg.chat.id)
  if (!s.autoreply) return
  const rules = await ctx.keywords(msg.chat.id)
  if (!rules.length) return
  const global = await ctx.global()
  let fired = 0
  for (const r of rules) {
    if (!r.enabled) continue
    if (!matchesKeyword(r.mode, text, r.pattern)) continue
    await ctx.hitKeyword(r.id)
    await send(
      ctx,
      msg.chat.id,
      tpl(r.reply, { name: userLabel(msg.from), first: msg.from?.first_name ?? '', group: msg.chat.title ?? '', username: msg.from?.username ? `@${msg.from.username}` : '', id: msg.from?.id ?? '', time: faDateTime(nowSec(), global.tzOffsetMin) }),
      msg.message_id,
    )
    await ctx.bump(msg.chat.id, 'replies')
    if (++fired >= 2) break
  }
}

/* ---------------- دستورات ---------------- */

export interface CmdDef {
  cmd: string
  desc: string
  usage: string
  admin: boolean
}

export const COMMANDS: CmdDef[] = [
  { cmd: 'start', desc: 'راهنما', usage: '/start', admin: false },
  { cmd: 'help', desc: 'کمک یک دستور', usage: '/help mute', admin: false },
  { cmd: 'ping', desc: 'تأخیر و سلامت', usage: '/ping', admin: false },
  { cmd: 'id', desc: 'شناسه چت/کاربر/پیام', usage: '/id', admin: false },
  { cmd: 'rules', desc: 'قاعده‌های چت', usage: '/rules', admin: false },
  { cmd: 'status', desc: 'وضعیت فیلترها', usage: '/status', admin: true },
  { cmd: 'stats', desc: 'آمار چت', usage: '/stats 7', admin: true },
  { cmd: 'log', desc: 'اقدامات اخیر', usage: '/log', admin: true },
  { cmd: 'warn', desc: 'اخطار', usage: '/warn (ریپلای)', admin: true },
  { cmd: 'warns', desc: 'اخطارهای یک کاربر', usage: '/warns 123', admin: false },
  { cmd: 'unwarn', desc: 'پاک‌کردن اخطارها', usage: '/unwarn 123', admin: true },
  { cmd: 'mute', desc: 'سکوت', usage: '/mute 123 30', admin: true },
  { cmd: 'unmute', desc: 'رفع سکوت', usage: '/unmute 123', admin: true },
  { cmd: 'kick', desc: 'اخراج', usage: '/kick 123', admin: true },
  { cmd: 'ban', desc: 'بن', usage: '/ban 123', admin: true },
  { cmd: 'unban', desc: 'خروج از بن', usage: '/unban 123', admin: true },
  { cmd: 'del', desc: 'حذف پیام ریپلای‌شده', usage: '/del', admin: true },
  { cmd: 'purge', desc: 'حذف پیام‌های آخر', usage: '/purge 30', admin: true },
  { cmd: 'pin', desc: 'سنجاق', usage: '/pin', admin: true },
  { cmd: 'unpin', desc: 'برداشتن سنجاق', usage: '/unpin', admin: true },
  { cmd: 'poll', desc: 'نظرسنجی', usage: '/poll سؤال | آره | نه', admin: true },
  { cmd: 'save', desc: 'ذخیره نوت', usage: '/save salam متن', admin: true },
  { cmd: 'notes', desc: 'لیست نوت‌ها', usage: '/notes', admin: false },
  { cmd: 'clear', desc: 'حذف نوت', usage: '/clear salam', admin: true },
  { cmd: 'remind', desc: 'یادآور', usage: '/remind +20m چای', admin: false },
  { cmd: 'schedule', desc: 'پست زمان‌دار/تکراری', usage: '/schedule every 30m متن', admin: true },
  { cmd: 'reminders', desc: 'لیست زمان‌بندی‌ها', usage: '/reminders', admin: false },
  { cmd: 'rm', desc: 'حذف زمان‌بندی', usage: '/rm 12', admin: true },
  { cmd: 'sub', desc: 'عضویت در اطلاعیه‌ها', usage: '/sub', admin: true },
  { cmd: 'unsub', desc: 'خروج از اطلاعیه‌ها', usage: '/unsub', admin: true },
  { cmd: 'broadcast', desc: 'اطلاعیه به چت‌های عضو', usage: '/broadcast متن', admin: true },
  { cmd: 'setlog', desc: 'مقصد لاگ مدیریتی', usage: '/setlog -100123', admin: true },
  { cmd: 'setname', desc: 'نام نمایشی در پنل', usage: '/setname گروه من', admin: true },
]

async function runCommand(ctx: HubCtx, msg: TgMessage, name: string, args: string): Promise<boolean> {
  const bot = ctx.bot()
  const chatId = msg.chat.id
  const userId = msg.from?.id ?? 0
  const isPrivate = msg.chat.type === 'private'
  const s = await ctx.settings(chatId)
  const global = await ctx.global()
  const admin = isPrivate ? global.admins.includes(userId) || userId === ctx.botId() : await ctx.isAdmin(chatId, userId)
  const ok = canRun(s, global, userId, admin, isPrivate)
  const need = async (): Promise<boolean> => {
    if (ok) return true
    await send(ctx, chatId, '🔒 این دستور فقط برای ادمین چت (یا ادمین پنل) است.', msg.message_id)
    return false
  }
  const target = targetOf(msg, args)

  switch (name) {
    case 'start':
    case 'help': {
      if (name === 'help' && args) {
        const c = COMMANDS.find(x => x.cmd === args.replace(/^\//, ''))
        await send(ctx, chatId, c ? `<b>/${escHtml(c.cmd)}</b> — ${c.desc}\n<code>${escHtml(c.usage)}</code>` : `«${escHtml(args)}» را ندارم.`, msg.message_id)
        return true
      }
      const privacy = (await bot.getMe().catch(() => null))?.can_read_all_group_messages === true
      await send(
        ctx,
        chatId,
        [
          `<b>SelfHub</b> — ربات مدیریت گروه، کانال، زمان‌بند و آمار.`,
          isPrivate ? '' : `این چت: ${escHtml(msg.chat.title ?? String(chatId))}`,
          `برای دیدن توضیح هر دستور: <code>/help mute</code>`,
          `پنل وب: تنظیمات کامل، نوت‌ها، کلیدواژه‌ها، آمار و لاگ.`,
          COMMANDS.slice(0, 14).map(c => `<code>/${c.cmd}</code>`).join(' '),
          `…و ${faInt(COMMANDS.length - 14)} دستور دیگر با /help`,
          privacy === false ? `\n⚠️ <i>Privacy Mode ربات روشن است؛ برای کارکرد مدیریت از @BotFather خاموشش کن.</i>` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      return true
    }

    case 'ping': {
      const t0 = Date.now()
      const me = await bot.getMe().catch(() => null)
      await send(ctx, chatId, `🏓 ${me ? `@${escHtml(me.username ?? '')} — ` : ''}${faInt(Date.now() - t0)} میلی‌ثانیه`, msg.message_id)
      return true
    }

    case 'id': {
      const who = msg.reply_to_message?.from ?? msg.from
      await send(
        ctx,
        chatId,
        `چت: <code>${chatId}</code> (${chatTypeLabel(msg.chat.type)})\nپیام: <code>${msg.message_id}</code>\nکاربر: ${mention(who)} <code>${who?.id ?? '—'}</code>\nادمین من: ${admin ? '✅' : '❌'}`,
        msg.message_id,
      )
      return true
    }

    case 'rules':
      await send(ctx, chatId, s.rulesText ? `<b>قاعده‌ها</b>\n\n${escHtml(s.rulesText)}` : 'قاعده‌ای ثبت نشده.', msg.message_id)
      return true

    case 'status': {
      if (!(await need())) return true
      const lines = statusLines(msg.chat.title ?? String(chatId), s)
      await send(ctx, chatId, lines.join('\n'), msg.message_id)
      return true
    }

    case 'stats': {
      if (!(await need())) return true
      const days = Math.min(30, Math.max(1, Number.parseInt(args, 10) || 7))
      const t = totals(await ctx.statsRows(chatId, days))
      const hourly = await ctx.hourly(chatId, 24)
      const count = await ctx.memberCount(chatId).catch(() => 0)
      await send(
        ctx,
        chatId,
        [
          `<b>آمار ${escHtml(truncate(msg.chat.title ?? String(chatId), 40))} — ${faInt(days)} روز</b>`,
          `👥 اعضا: ${faInt(count)}`,
          `💬 پیام: ${faInt(t.msgs)} (میانگین ${faInt(t.avgMsgsPerDay)}/روز)`,
          `↩️ پاسخ: ${faInt(t.replies)} · ⚡️ دستور: ${faInt(t.commands)}`,
          `🗑 حذف: ${faInt(t.deleted)} · ⚠️ اخطار: ${faInt(t.warns)} · 🔇 سکوت: ${faInt(t.mutes)} · ⛔️ بن: ${faInt(t.bans)}`,
          `📊 ۲۴ ساعت اخیر:\n<code>${bars(hourly.map(h => h.msgs), 24).join('')}</code>`,
        ].join('\n'),
        msg.message_id,
      )
      return true
    }

    case 'log': {
      if (!(await need())) return true
      const rows = await ctx.modlogList(chatId, 10)
      await send(ctx, chatId, rows.length ? `<b>۱۰ اقدام اخیر</b>\n${rows.map(r => modlogLine(r, global.tzOffsetMin)).join('\n')}` : 'لاگی نیست.', msg.message_id)
      return true
    }

    case 'setlog': {
      if (!(await need())) return true
      const v = /off|0/.test(args) ? null : Number(args.replace(/\s/g, ''))
      await ctx.patchSettings(chatId, { logChatId: Number.isFinite(v as number) || v === null ? v : null })
      await send(ctx, chatId, v === null ? 'لاگ مدیریتی خاموش شد.' : `لاگ به <code>${v}</code> می‌رود.`, msg.message_id)
      return true
    }

    case 'warn': {
      if (!(await need())) return true
      if (!target) {
        await send(ctx, chatId, 'روی پیام کاربر ریپلای کن یا <code>/warn 123456 دلیل</code>', msg.message_id)
        return true
      }
      const w = await ctx.getWarn(chatId, target.id)
      const points = w.points + 1
      const reason = args.replace(String(target.id), '').trim() || 'بدون دلیل'
      await ctx.setWarn(chatId, target.id, points, reason)
      await ctx.bump(chatId, 'warns')
      await ctx.modlog({ chatId, action: 'اخطار', targetId: target.id, targetName: target.label, moderator: userLabel(msg.from), reason })
      let out = `${target.user ? mention(target.user) : escHtml(target.label)} اخطار ${faInt(points)} از ${faInt(s.warnLimit)}\n<i>${escHtml(truncate(reason, 120))}</i>`
      if (s.warnLimit > 0 && points >= s.warnLimit) {
        if (s.warnAction === 'ban') await bot.ban(chatId, target.id, false)
        else if (s.warnAction === 'kick') await bot.kick(chatId, target.id)
        else await bot.restrict(chatId, target.id, mutePlan(s.warnActionMuteMin || 60, msg.date).untilDate)
        await ctx.setWarn(chatId, target.id, 0, 'reseted-after-limit')
        out += `\nبه سقف رسید → ${actionLabel(s.warnAction)}`
      }
      await send(ctx, chatId, out)
      return true
    }

    case 'warns': {
      const id = target?.id ?? userId
      const w = await ctx.getWarn(chatId, id)
      await send(ctx, chatId, `<code>${id}</code> — ${faInt(w.points)} اخطار${w.reason ? ` (آخرین: ${escHtml(truncate(w.reason, 50))})` : ''}`, msg.message_id)
      return true
    }

    case 'unwarn': {
      if (!(await need())) return true
      if (!target) return true
      await ctx.setWarn(chatId, target.id, 0, '')
      await send(ctx, chatId, 'اخطارهایش پاک شد.', msg.message_id)
      return true
    }

    case 'mute': {
      if (!(await need())) return true
      if (!target) {
        await send(ctx, chatId, 'ریپلای کن یا <code>/mute 123456 30</code> (دقیقه)', msg.message_id)
        return true
      }
      const nums = args.replace(String(target.id), '').match(/\d{1,6}/)?.[0]
      const unit = /(h|d|ساعت|روز)/i.test(args) ? (/[dروز]/i.test(args) ? 1440 : 60) : 1
      const minutes = Math.max(1, Math.min(43200, Number(nums ?? 10) * unit))
      await bot.restrict(chatId, target.id, mutePlan(minutes, msg.date).untilDate)
      await ctx.bump(chatId, 'mutes')
      await ctx.modlog({ chatId, action: 'سکوت', targetId: target.id, targetName: target.label, moderator: userLabel(msg.from), reason: `${minutes} دقیقه` })
      await send(ctx, chatId, `${escHtml(target.label)} ساکت شد (${faInt(minutes)} دقیقه).`, msg.message_id)
      return true
    }

    case 'unmute': {
      if (!(await need())) return true
      if (!target) return true
      await bot.unrestrict(chatId, target.id)
      await ctx.modlog({ chatId, action: 'رفع سکوت', targetId: target.id, targetName: target.label, moderator: userLabel(msg.from), reason: '' })
      await send(ctx, chatId, 'سکوتش برداشتم.', msg.message_id)
      return true
    }

    case 'kick':
    case 'ban': {
      if (!(await need())) return true
      if (!target) return true
      if (name === 'ban') await bot.ban(chatId, target.id, /revoke|همه/.test(args))
      else await bot.kick(chatId, target.id)
      await ctx.bump(chatId, 'bans')
      await ctx.modlog({ chatId, action: actionLabel(name === 'ban' ? 'ban' : 'kick'), targetId: target.id, targetName: target.label, moderator: userLabel(msg.from), reason: truncate(args, 60) })
      await send(ctx, chatId, name === 'ban' ? `${escHtml(target.label)} بن شد.` : 'اخراج شد.', msg.message_id)
      return true
    }

    case 'unban': {
      if (!(await need())) return true
      if (!target) return true
      await bot.pardon(chatId, target.id)
      await send(ctx, chatId, 'از بن خارج شد.', msg.message_id)
      return true
    }

    case 'del': {
      if (!(await need())) return true
      if (!msg.reply_to_message) return true
      await bot.deleteMessage(chatId, msg.reply_to_message.message_id)
      await bot.deleteMessage(chatId, msg.message_id)
      await ctx.bump(chatId, 'deleted')
      return true
    }

    case 'purge': {
      if (!(await need())) return true
      const n = Math.min(Math.max(1, Number.parseInt(args, 10) || 20), 100)
      let deleted = 0
      for (let i = 1; i <= n; i++) {
        const first = await ctx.bot().deleteMessage(chatId, msg.message_id - i).catch(() => false)
        if (first === true) deleted++
      }
      await ctx.bump(chatId, 'deleted', deleted)
      await ctx.modlog({ chatId, action: 'پاک‌سازی', targetId: null, targetName: '', moderator: userLabel(msg.from), reason: `${deleted} پیام` })
      await send(ctx, chatId, `${faInt(deleted)} پیام اخیر حذف شد.`, msg.message_id)
      return true
    }

    case 'pin': {
      if (!(await need())) return true
      if (!msg.reply_to_message) return true
      await bot.pin(chatId, msg.reply_to_message.message_id)
      await send(ctx, chatId, 'سنجاق شد.', msg.message_id)
      return true
    }

    case 'unpin': {
      if (!(await need())) return true
      await bot.unpin(chatId)
      await send(ctx, chatId, 'سنجاق‌ها برداشته شد.', msg.message_id)
      return true
    }

    case 'poll': {
      if (!(await need())) return true
      const [q, ...opts] = args.split('|').map(x => x.trim()).filter(Boolean)
      if (!q || opts.length < 2) {
        await send(ctx, chatId, 'شکل: <code>/poll سؤال | گزینه ۱ | گزینه ۲</code>', msg.message_id)
        return true
      }
      try {
        await bot.sendPoll(chatId, q, opts)
      } catch (e) {
        await send(ctx, chatId, `نشد: ${escHtml(String((e as Error).message))}`, msg.message_id)
        return true
      }
      return true
    }

    case 'save': {
      if (!(await need())) return true
      const m = args.match(/^([\p{L}\p{N}_]{2,40})\s+([\s\S]{1,4000})$/u)
      if (!m) {
        await send(ctx, chatId, 'شکل: <code>/save salam متن</code> — با <code>#salam</code> خوانده می‌شود.', msg.message_id)
        return true
      }
      await ctx.saveNote(chatId, (m[1] ?? '').toLowerCase(), (m[2] ?? '').trim(), userId)
      await send(ctx, chatId, `نوت <code>#${escHtml(m[1] ?? '')}</code> ذخیره شد.`, msg.message_id)
      return true
    }

    case 'notes': {
      const list = await ctx.notes(chatId)
      await send(
        ctx,
        chatId,
        list.length ? `<b>نوت‌های این چت</b>\n${list.slice(0, 40).map(n => `• <code>#${escHtml(n.name)}</code>${n.hits ? ` (${faInt(n.hits)})` : ''}`).join('\n')}` : 'نوتی ثبت نشده.',
        msg.message_id,
      )
      return true
    }

    case 'clear': {
      if (!(await need())) return true
      const done = await ctx.delNote(chatId, args.toLowerCase().replace(/^#/, ''))
      await send(ctx, chatId, done ? 'پاک شد.' : 'چنین نوتی نیست.', msg.message_id)
      return true
    }

    case 'remind':
    case 'schedule': {
      if (!isPrivate && !(await need())) return true
      const parsed = parseWhen(args, nowSec(), global.tzOffsetMin)
      if (!parsed) {
        await send(
          ctx,
          chatId,
          'زمان را نفهمیدم. مثال‌ها:\n<code>/remind +20m چای</code>\n<code>/remind فردا ۸:۰۰ جلسه</code>\n<code>/schedule every 30m بررسی کانال</code>',
          msg.message_id,
        )
        return true
      }
      const body = truncate(args.slice(args.indexOf(parsed.consumed) + parsed.consumed.length).trim(), 900) || '⏰ یادآوری'
      const job = await ctx.addJob({
        chatId,
        text: `⏰ ${body}`,
        at: parsed.at,
        everyMin: Math.round(parsed.everySec / 60),
        enabled: true,
        note: isPrivate ? 'یادآور شخصی' : `توسط ${userLabel(msg.from)}`,
        createdBy: userId,
      })
      await send(
        ctx,
        chatId,
        `✅ شمارهٔ <code>${job.id}</code>\n🕒 ${escHtml(formatClock(job.at, global.tzOffsetMin))} (${escHtml(humanUntil(job.at, nowSec()))})${job.everyMin ? `\n🔁 ${escHtml(everyLabel(job.everyMin * 60))}` : ''}`,
        msg.message_id,
      )
      return true
    }

    case 'reminders': {
      const list = (await ctx.jobs(chatId)).slice(0, 20)
      await send(
        ctx,
        chatId,
        list.length
          ? `<b>زمان‌بندی‌ها</b>\n${list.map(j => `<code>${j.id}</code> • ${escHtml(formatClock(j.at, global.tzOffsetMin))} • ${escHtml(truncate(j.text, 50))}${j.everyMin ? ` • ${escHtml(everyLabel(j.everyMin * 60))}` : ''}`).join('\n')}`
          : 'چیزی زمان‌بندی نشده.',
        msg.message_id,
      )
      return true
    }

    case 'rm': {
      const id = Number.parseInt(args, 10)
      if (!Number.isFinite(id)) {
        await send(ctx, chatId, 'شناسه را بده: <code>/rm 12</code>', msg.message_id)
        return true
      }
      const done = await ctx.delJob(id, chatId)
      await send(ctx, chatId, done ? 'حذف شد.' : 'در این چت چنین شماره‌ای نیست.', msg.message_id)
      return true
    }

    case 'sub':
      await ctx.patchSettings(chatId, { broadcast: true })
      await send(ctx, chatId, '✅ این چت در لیست اطلاعیه‌ها است.', msg.message_id)
      return true

    case 'unsub':
      await ctx.patchSettings(chatId, { broadcast: false })
      await send(ctx, chatId, 'از لیست اطلاعیه‌ها خارج شد.', msg.message_id)
      return true

    case 'broadcast': {
      if (!global.admins.includes(userId)) {
        await send(ctx, chatId, 'فقط ادمین پنل (از پی‌وی) می‌تواند اطلاعیه بفرستد.', msg.message_id)
        return true
      }
      if (isPrivate && !args) {
        const list = await ctx.broadcastList()
        await send(ctx, chatId, `متن را بعد از دستور بنویس.\nاکنون ${faInt(list.length)} چت عضو اطلاعیه‌ها هستند.\nسقف هر اجرا: ${faInt(global.broadcastMaxPerTick)} چت.`)
        return true
      }
      if (!args) return true
      const r = await doBroadcast(ctx, args, await ctx.broadcastList())
      await send(ctx, chatId, `ارسال شد: ${faInt(r.sent)} از ${faInt(r.total)}${r.left ? ` — ${faInt(r.left)} تای بعدی خودکار در دقیقهٔ بعد` : ''}`)
      return true
    }

    case 'setname': {
      if (!(await need())) return true
      if (!args) return true
      await ctx.patchSettings(chatId, { title: truncate(args, 60) })
      await send(ctx, chatId, 'نام نمایشی در پنل عوض شد.', msg.message_id)
      return true
    }

    default:
      return false
  }
}

/* ---------------- اطلاعیه ---------------- */

export interface BroadcastResult {
  sent: number
  total: number
  left: number
}

export async function doBroadcast(ctx: HubCtx, text: string, list: number[]): Promise<BroadcastResult> {
  const global = await ctx.global()
  const cap = Math.max(1, Math.min(global.broadcastMaxPerTick, 100))
  let sent = 0
  let i = 0
  for (; i < Math.min(list.length, cap); i++) {
    const chatId = list[i]
    if (chatId === undefined) continue
    const m = await ctx.bot().trySend(chatId, text)
    if (m) {
      sent++
      await ctx.bump(chatId, 'replies')
    }
    if (global.broadcastGapMs > 0 && i + 1 < Math.min(list.length, cap)) await ctx.sleep(global.broadcastGapMs)
  }
  const remaining = list.slice(i)
  await ctx.broadcastSet(remaining.length ? { text, remaining } : null)
  return { sent, total: list.length, left: remaining.length }
}

/* ---------------- زمان‌بند (از cron صدا زده می‌شود) ---------------- */

export async function runDueJobs(ctx: HubCtx, now: number): Promise<number> {
  const due = (await ctx.jobs(null)).filter(j => j.at <= now).slice(0, 40)
  const global = await ctx.global()
  let n = 0
  for (const j of due) {
    if (!j.enabled) {
      await ctx.delJob(j.id, j.chatId)
      continue
    }
    let ok = false
    try {
      ok = (await ctx.bot().sendMessage(j.chatId, j.text)) !== null
    } catch (e) {
      const msg = String((e as Error).message ?? e)
      // چت رفته یا ربات اخراج شده → بیهوده در صف نمی‌ماند
      if (/chat not found|kicked|blocked|left the chat|Unauthorized/i.test(msg)) {
        await ctx.delJob(j.id, j.chatId)
        ctx.log('warn', `زمان‌بند ${j.id} حذف شد (چت در دسترس نیست)`)
        continue
      }
      // خطای موقت (شبکه/۴۲۹) → در صف می‌ماند و دقیقهٔ بعد دوباره تلاش می‌شود
      ctx.log('warn', `ارسال زمان‌بند ${j.id} نرفت: ${truncate(msg, 90)}`)
      if (now - j.at > 86_400) await ctx.delJob(j.id, j.chatId)
      continue
    }
    if (!ok) continue
    n++
    await ctx.bump(j.chatId, 'replies')
    const next = nextAfter(j.at, j.everyMin * 60, now)
    if (next === 0) await ctx.delJob(j.id, j.chatId)
    else await ctx.markSent(j.id, next)
    if (global.broadcastGapMs > 0) await ctx.sleep(Math.min(50, global.broadcastGapMs))
  }

  const st = await ctx.broadcastState()
  if (st?.remaining.length) {
    const r = await doBroadcast(ctx, st.text, st.remaining)
    ctx.log('info', `ادامهٔ اطلاعیه: ${r.sent} ارسال شد، ${r.left} باقی مانده`)
  }

  for (const v of await ctx.verifyExpired(now)) {
    await ctx.bot().kick(v.chatId, v.userId)
    await ctx.modlog({ chatId: v.chatId, action: 'اخراج (تأییدنشده)', targetId: v.userId, targetName: '', moderator: 'خودکار', reason: 'کپچا تأیید نشد' })
  }
  return n
}
