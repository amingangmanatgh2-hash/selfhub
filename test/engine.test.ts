/* SelfHub — تست یکپارچگی موتور با Telegram ساختگی
 * هیچ شبکه‌ای زده نمی‌شود: bot فیک است و_hub فقط آینه‌ی صداهاست.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { processUpdate } from '../src/engine.ts'
import type { HubCtx, StatsRow } from '../src/engine.ts'
import type { TelegramBot } from '../src/bot.ts'
import { defaultGlobal, defaultSettings } from '../src/logic/settings.ts'
import type { ChatSettings, GlobalSettings, KeywordRule, Note, ScheduledJob, TgMessage, TgUpdate, WarnRow } from '../src/types.ts'

interface Sent {
  chatId: number
  text: string
  markup?: unknown
  replyTo?: number
}

function fakeHub(opts: { settings?: Partial<ChatSettings>; keywords?: KeywordRule[]; notes?: Note[]; isAdmin?: boolean } = {}) {
  const sent: Sent[] = []
  const deleted: [number, number][] = []
  const restricted: [number, number, number][] = []
  const banned: [number, number][] = []
  const modlog: { action: string; targetId: number | null; reason: string }[] = []
  const bumps = new Map<string, number>()
  const jobs: ScheduledJob[] = []
  let notes: Note[] = opts.notes ?? []
  let nextJobId = 1

  const settings: ChatSettings = { ...defaultSettings(), ...opts.settings }

  const bot = {
    sendMessage: async (chatId: number, text: string, o: { replyTo?: number; replyMarkup?: unknown } = {}) => {
      sent.push({ chatId, text, ...(o.replyMarkup ? { markup: o.replyMarkup } : {}), ...(o.replyTo ? { replyTo: o.replyTo } : {}) })
      return { message_id: 900 + sent.length, date: 1000, chat: { id: chatId, type: 'private' }, text }
    },
    deleteMessage: async (chatId: number, messageId: number) => {
      deleted.push([chatId, messageId])
      return true
    },
    editMessageText: async () => ({}),
    answerCallbackQuery: async () => true,
    restrictChatMember: async () => true,
    banChatMember: async () => true,
    unbanChatMember: async () => true,
    leaveChat: async () => true,
    getMe: async () => ({ id: 7, is_bot: true, first_name: 'SelfHub', username: 'selfsazlevi_bot', can_read_all_group_messages: true }),
    getChatMember: async () => ({ status: opts.isAdmin ? 'administrator' : 'member', user: { id: 1, is_bot: false, first_name: 'x' } }),
    getChat: async () => ({ id: -100, type: 'supergroup', title: 'تست' }),
    getChatMemberCount: async () => 128,
    getChatMember_count: async () => 0,
    trySend: async (chatId: number, text: string) => {
      sent.push({ chatId, text })
      return { message_id: 1 }
    },
    // restrict/unrestrict از طریق متدهای خودِ ربات صدا زده می‌شوند
    restrict: async (_c: number, u: number, until: number) => {
      restricted.push([_c, u, until])
      return true
    },
    unrestrict: async () => true,
    kick: async (_c: number, u: number) => {
      banned.push([_c, u])
      return true
    },
    ban: async (_c: number, u: number) => {
      banned.push([_c, u])
      return true
    },
    pardon: async () => true,
    pin: async () => true,
    unpin: async () => true,
    sendPoll: async () => ({ message_id: 5 }),
    getWebhookInfo: async () => ({ url: '', has_custom_certificate: false, pending_update_count: 0 }),
    setWebhook: async () => true,
    deleteWebhook: async () => true,
    setTyping: async () => true,
  }

  const warn: WarnRow = { chatId: -100, userId: 42, points: 0, reason: '', updatedAt: 0 }
  const hist = new Map<string, { timestamps: number[]; texts: string[] }>()

  const ctx: HubCtx = {
    bot: () => bot as unknown as TelegramBot,
    botId: () => 7,
    global: async (): Promise<GlobalSettings> => ({ ...defaultGlobal(), admins: [999] }),
    settings: async () => settings,
    patchSettings: async (_id, patch) => {
      Object.assign(settings, patch)
      return settings
    },
    ensureChat: async () => settings,
    isAdmin: async () => !!opts.isAdmin,
    history: (chatId, userId, text, at) => {
      const key = `${chatId}:${userId}`
      const prev = hist.get(key) ?? { timestamps: [], texts: [] }
      const snap = { timestamps: [...prev.timestamps], texts: [...prev.texts] }
      hist.set(key, { timestamps: [...prev.timestamps, at].slice(-40), texts: [...prev.texts, text].slice(-40) })
      return snap
    },
    bump: async (chatId, field, n = 1) => {
      bumps.set(`${chatId}:${field}`, (bumps.get(`${chatId}:${field}`) ?? 0) + n)
    },
    log: () => undefined,
    modlog: async r => {
      modlog.push({ action: r.action, targetId: r.targetId, reason: r.reason })
    },
    modlogList: async () => [],
    getWarn: async () => warn,
    setWarn: async (_c, _u, p) => {
      warn.points = p
    },
    statsRows: async (): Promise<StatsRow[]> => [],
    hourly: async () => [],
    memberCount: async () => 128,
    notes: async () => notes,
    getNote: async (_c, name) => notes.find(n => n.name === name) ?? null,
    saveNote: async (_c, name, text) => {
      notes = [...notes.filter(n => n.name !== name), { chatId: -100, name, text, createdBy: 5, createdAt: 0, hits: 0 }]
    },
    delNote: async (_c, name) => {
      const had = notes.some(n => n.name === name)
      notes = notes.filter(n => n.name !== name)
      return had
    },
    hitNote: async () => undefined,
    keywords: async () => opts.keywords ?? [],
    hitKeyword: async () => undefined,
    jobs: async () => jobs,
    addJob: async j => {
      const withId = { ...j, id: nextJobId++, lastSent: 0, sentCount: 0 }
      jobs.push(withId)
      return withId
    },
    delJob: async () => true,
    markSent: async () => undefined,
    verifyAdd: async () => undefined,
    verifyDone: async () => null,
    verifyExpired: async () => [],
    broadcastList: async () => [-100],
    broadcastState: async () => null,
    broadcastSet: async () => undefined,
    sleep: async () => undefined,
  }

  return { ctx, sent, deleted, restricted, banned, modlog, bumps, jobs, hist, settings }
}

function msgUpdate(patch: Partial<TgMessage>): TgUpdate {
  const msg: TgMessage = {
    message_id: 10,
    date: 1000,
    chat: { id: -100, type: 'supergroup', title: 'گروه تست' },
    from: { id: 42, is_bot: false, first_name: 'علی', username: 'ali' },
    text: 'سلام',
    ...patch,
  }
  return { update_id: 1, message: msg }
}

test('کلمه‌ی ممنوعه → حذف پیام، ثبت لاگ و آمار', async () => {
  const h = fakeHub({ settings: { words: { on: true, patterns: ['کلاهبرداری'], action: 'delete', muteMin: 0 } } })
  await processUpdate(h.ctx, msgUpdate({ text: 'این کلاهبرداری است' }))
  assert.deepEqual(h.deleted, [[-100, 10]], 'پیام حذف شد')
  assert.equal(h.modlog.length, 1)
  assert.equal(h.modlog[0]?.action, 'حذف')
  assert.equal(h.bumps.get('-100:deleted'), 1)
  assert.equal(h.sent.length, 0, 'بدون پیام اضافه به گروه')
})

test('ادمین معاف است، عضو معمولی نه', async () => {
  const admin = fakeHub({ isAdmin: true, settings: { words: { on: true, patterns: ['کلاهبرداری'], action: 'delete', muteMin: 0 } } })
  await processUpdate(admin.ctx, msgUpdate({ text: 'کلاهبرداری' }))
  assert.equal(admin.deleted.length, 0)

  const plain = fakeHub({ settings: { words: { on: true, patterns: ['کلاهبرداری'], action: 'delete', muteMin: 0 } } })
  await processUpdate(plain.ctx, msgUpdate({ text: 'کلاهبرداری' }))
  assert.equal(plain.deleted.length, 1)
})

test('فلود → سکوت با مدت تنظیمی', async () => {
  const h = fakeHub({ settings: { flood: { on: true, windowSec: 10, max: 2, action: 'mute', muteMin: 15 }, words: { on: false, patterns: [], action: 'delete', muteMin: 0 } } })
  for (let i = 0; i < 3; i++) await processUpdate(h.ctx, msgUpdate({ message_id: 20 + i, text: `پیام ${i}`, date: 1000 + i }))
  assert.ok(h.restricted.length >= 1, 'کاربر محدود شد')
  assert.ok((h.bumps.get('-100:mutes') ?? 0) >= 1)
})

test('دستور /save و سپس خواندن نوت با #', async () => {
  const h = fakeHub({ isAdmin: true })
  await processUpdate(h.ctx, msgUpdate({ text: '/save قوانین احترام بگذارید', from: { id: 5, is_bot: false, first_name: 'ادمین', username: 'admin' } }))
  assert.ok(h.sent.some(x => x.text.includes('ذخیره شد')))
  await processUpdate(h.ctx, msgUpdate({ text: '#قوانین' }))
  assert.ok(h.sent.some(x => x.text === 'احترام بگذارید'), 'متن نوت ارسال شد')
})

test('/remind یک شغل زمان‌بند می‌سازد', async () => {
  const h = fakeHub()
  await processUpdate(h.ctx, msgUpdate({ text: '/remind +20m خرید', chat: { id: 5, type: 'private', title: 'pv' }, from: { id: 999, is_bot: false, first_name: 'مالک' } }))
  assert.equal(h.jobs.length, 1)
  assert.ok(h.jobs[0]!.at > 0)
  assert.match(h.jobs[0]!.text, /خرید/)
})

test('دستور ادمین از عضو معمولی رد می‌شود', async () => {
  const h = fakeHub({ isAdmin: false })
  await processUpdate(h.ctx, msgUpdate({ text: '/ban 123' }))
  assert.equal(h.banned.length, 0)
  assert.ok(h.sent.some(x => x.text.includes('فقط برای ادمین')))
})

test('خوش‌آمدگویی با {name} و {count}', async () => {
  const h = fakeHub({ settings: { welcome: true, welcomeText: 'سلام {name}، عضو {count}م', captcha: false, joinBan: { on: false, namePatterns: [] } } })
  await processUpdate(
    h.ctx,
    msgUpdate({ text: undefined, new_chat_members: [{ id: 77, is_bot: false, first_name: 'سارا', username: 'sara' }] }),
  )
  assert.ok(h.sent.some(x => x.text === 'سلام @sara، عضو 128م'))
})

test('پاسخ کلیدواژه‌ای فقط وقتی autoreply روشن است', async () => {
  const kw: KeywordRule[] = [{ id: 1, chatId: -100, pattern: 'قیمت', reply: 'قیمت ۱۰ تومان', mode: 'contains', enabled: true, hits: 0 }]
  const on = fakeHub({ keywords: kw })
  await processUpdate(on.ctx, msgUpdate({ text: 'قیمت چند است؟' }))
  assert.ok(on.sent.some(x => x.text === 'قیمت ۱۰ تومان'))

  const off = fakeHub({ keywords: kw, settings: { autoreply: false } })
  await processUpdate(off.ctx, msgUpdate({ text: 'قیمت چند است؟' }))
  assert.equal(off.sent.length, 0)
})

test('ادمین سراسری پنل در گروه تنبیه نمی‌شود', async () => {
  const h = fakeHub({ settings: { words: { on: true, patterns: ['تبلیغ'], action: 'delete', muteMin: 0 } } })
  await processUpdate(h.ctx, msgUpdate({ text: 'تبلیغ', from: { id: 999, is_bot: false, first_name: 'مالک' } }))
  assert.equal(h.deleted.length, 0)
})

test('پیام ویرایش‌شده هم بازرسی می‌شود (دورزدن فیلتر)', async () => {
  const h = fakeHub({ settings: { words: { on: true, patterns: ['اسپم'], action: 'delete', muteMin: 0 } } })
  const upd = msgUpdate({ text: 'اسپم' })
  await processUpdate(h.ctx, { update_id: 2, edited_message: upd.message })
  assert.equal(h.deleted.length, 1)
})

test('/start راهنما را می‌فرستد و /ping کار می‌کند', async () => {
  const h = fakeHub()
  await processUpdate(h.ctx, msgUpdate({ text: '/start' }))
  assert.match(h.sent[0]?.text ?? '', /SelfHub/)
  await processUpdate(h.ctx, msgUpdate({ text: '/ping' }))
  assert.match(h.sent.at(-1)?.text ?? '', /Pong|میلی‌ثانیه/)
})

test('خروج ربات از چت → عضویت اطلاعیه‌ها بسته می‌شود', async () => {
  const h = fakeHub({ settings: { broadcast: true } })
  await processUpdate(h.ctx, {
    update_id: 3,
    my_chat_member: {
      chat: { id: -100, type: 'supergroup', title: 'گروه' },
      from: { id: 1, is_bot: false, first_name: 'x' },
      date: 1,
      new_chat_member: { status: 'kicked', user: { id: 7, is_bot: true, first_name: 'SelfHub' } },
      old_chat_member: { status: 'administrator', user: { id: 7, is_bot: true, first_name: 'SelfHub' } },
    },
  })
  assert.equal(h.settings.broadcast, false)
})
