import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalize } from '../src/logic/words.ts'
import { countDuplicate, isFlooding, prune } from '../src/logic/flood.ts'
import { decide, joinBanHit, mutePlan, warnLadder } from '../src/logic/rules.ts'
import type { MsgFacts } from '../src/logic/rules.ts'
import { defaultSettings, mergeGlobal, mergeSettings } from '../src/logic/settings.ts'
import type { ChatSettings } from '../src/types.ts'

function msg(patch: Partial<MsgFacts> = {}): MsgFacts {
  return {
    messageId: 1,
    fromId: 42,
    isBot: false,
    text: 'سلام',
    firstName: 'کاربر',
    username: 'user',
    mediaTypes: [],
    isForward: false,
    chatType: 'supergroup',
    date: 1000,
    ...patch,
  }
}

function s(patch: Partial<ChatSettings> = {}): ChatSettings {
  return { ...defaultSettings(), ...patch }
}

const noHistory = { timestamps: [], texts: [] }
const plain = { isAdmin: false, warnPoints: 0, allowDomains: [] }

test('مدیریت خاموش → هیچ اقدامی', () => {
  const d = decide(s({ moderation: false, words: { on: true, patterns: ['فحش'], action: 'ban', muteMin: 0 } }), msg({ text: 'فحش' }), noHistory, plain)
  assert.equal(d.action, 'none')
})

test('ادمین و ربات از فیلتر محتوایی معاف‌اند', () => {
  const cfg = s({ words: { on: true, patterns: ['اسپم'], action: 'ban', muteMin: 0 } })
  assert.equal(decide(cfg, msg({ text: 'اسپم' }), noHistory, { isAdmin: true, warnPoints: 0 }).action, 'none')
  assert.equal(decide(cfg, msg({ text: 'اسپم', isBot: true }), noHistory, plain).action, 'none')
})

test('کلمات ممنوعه: حذف + الگوی ثبت‌شده در دلیل', () => {
  const d = decide(s({ words: { on: true, patterns: ['کلاهبرداری', 'فروش'], action: 'delete', muteMin: 0 } }), msg({ text: 'این کلاهبرداری است' }), noHistory, plain)
  assert.equal(d.delete, true)
  assert.equal(d.action, 'delete')
  assert.match(d.reasons.join(' '), /کلاهبرداری/)
})

test('لینک: حذف، ولی لینک عضویت همیشه جرم است', () => {
  const cfg = s({ links: { on: true, allowInvite: false, allowOwnChannel: true, action: 'delete' } })
  assert.equal(decide(cfg, msg({ text: 't.me/mychannel/post/1' }), noHistory, { ...plain, allowDomains: ['t.me/mychannel'] }).action, 'none', 'کانال خود گروه مجاز است')
  const d = decide(cfg, msg({ text: 'بیا https://t.me/+abcDEF123' }), noHistory, { ...plain, allowDomains: ['t.me/mychannel'] })
  assert.equal(d.action, 'delete', 'لینک دعوت حتی در کانال خودی رد می‌شود')
})

test('فلود: پنجره‌ی لغوانی', () => {
  const cfg = s({ flood: { on: true, windowSec: 10, max: 3, action: 'mute', muteMin: 5 } })
  const recent = { timestamps: [995, 997, 999], texts: ['a', 'b', 'c'] }
  const d = decide(cfg, msg({ date: 1000, text: 'd' }), recent, plain)
  assert.equal(d.action, 'mute')
  assert.equal(d.muteMin, 5)
  // پنج ثانیه بعد، پنجره خالی است
  assert.equal(decide(cfg, msg({ date: 1010, text: 'e' }), { timestamps: prune([995, 997, 999], 10, 1010), texts: [] }, plain).action, 'none')
})

test('isFlooding/prune/countDuplicate مستقیم', () => {
  assert.equal(isFlooding([10, 12, 14], 5, 3, 15), false, 'فقط ۱ تا در پنجره')
  assert.equal(isFlooding([14, 15], 5, 3, 15), false)
  assert.equal(isFlooding([14, 15, 15], 5, 3, 15), true)
  assert.deepEqual(prune([1, 100, 101], 5, 101), [100, 101])
  assert.equal(countDuplicate({ texts: ['a', 'a'], stamps: [100, 101] }, 'A', 30, 105, normalize), 3, 'دو تکرار قبلی + پیام فعلی (نرمال‌شده)')
  assert.equal(countDuplicate({ texts: ['a'], stamps: [10] }, 'a', 30, 105, normalize), 1, 'خارج از پنجره شمرده نمی‌شود')
})

test('نردبان اخطار: رسیدن به سقف → سکوت', () => {
  const cfg = s({
    words: { on: true, patterns: ['تبلیغ'], action: 'warn', muteMin: 0 },
    warnLimit: 3,
    warnAction: 'mute',
    warnActionMuteMin: 30,
  })
  const first = decide(cfg, msg({ text: 'تبلیغ' }), noHistory, { ...plain, warnPoints: 0 })
  assert.equal(first.action, 'warn', 'اخطار اول')
  const last = decide(cfg, msg({ text: 'تبلیغ' }), noHistory, { ...plain, warnPoints: 2 })
  assert.equal(last.delete, true)
  assert.equal(last.action, 'mute', 'اخطار سوم = سقف → سکوت')
  assert.equal(last.muteMin, 30)
  assert.deepEqual(warnLadder(1, 0, 'ban', 0), { action: 'warn', muteMin: 0 }, 'سقف ۰ یعنی بدون تنبیه نهایی')
})

test('تکرار پیام (duplicate) و بزرگ‌نویسی افراطی', () => {
  const dup = s({ duplicate: { on: true, windowSec: 30, max: 2, action: 'delete' }, flood: { on: false, windowSec: 8, max: 6, action: 'delete', muteMin: 0 } })
  assert.equal(decide(dup, msg({ text: 'خرید ارزون', date: 100 }), { timestamps: [90, 95], texts: ['خرید ارزون', 'خرید ارزون'] }, plain).action, 'delete')

  const caps = s({ caps: { on: true, minChars: 5, maxRatio: 0.6, action: 'delete' }, words: { on: false, patterns: [], action: 'delete', muteMin: 0 }, links: { on: false, allowInvite: false, allowOwnChannel: false, action: 'delete' }, flood: { on: false, windowSec: 8, max: 6, action: 'delete', muteMin: 0 }, duplicate: { on: false, windowSec: 30, max: 3, action: 'delete' } })
  assert.equal(decide(caps, msg({ text: 'BUY NOW!!!' }), noHistory, plain).action, 'delete')
  assert.equal(decide(caps, msg({ text: 'buy now please' }), noHistory, plain).action, 'none')
})

test('رسانه‌ی ممنوع و حجم بیش از حد', () => {
  const media = s({ media: { on: true, blocked: ['sticker'] }, words: { on: false, patterns: [], action: 'delete', muteMin: 0 }, links: { on: false, allowInvite: false, allowOwnChannel: false, action: 'delete' }, flood: { on: false, windowSec: 8, max: 6, action: 'delete', muteMin: 0 }, duplicate: { on: false, windowSec: 30, max: 3, action: 'delete' } })
  assert.equal(decide(media, msg({ text: '', mediaTypes: ['sticker'] }), noHistory, plain).delete, true)

  const len = s({ length: { on: true, maxChars: 20, action: 'delete' }, words: { on: false, patterns: [], action: 'delete', muteMin: 0 }, links: { on: false, allowInvite: false, allowOwnChannel: false, action: 'delete' }, flood: { on: false, windowSec: 8, max: 6, action: 'delete', muteMin: 0 }, duplicate: { on: false, windowSec: 30, max: 3, action: 'delete' } })
  assert.equal(decide(len, msg({ text: 'x'.repeat(60) }), noHistory, plain).action, 'delete')
})

test('joinBan: نام‌های مشکوک عضو تازه', () => {
  const cfg = s({ joinBan: { on: true, namePatterns: ['crypto', 'airdrop', 'regex:^bot_\\d+$'] } })
  assert.equal(joinBanHit(cfg, 'Ali', 'airdrop_hunter'), 'airdrop')
  assert.equal(joinBanHit(cfg, 'bot_123', 'x'), 'regex:^bot_\\d+$')
  assert.equal(joinBanHit(cfg, 'مریم', 'mary'), null)
  assert.equal(joinBanHit(s({ joinBan: { on: false, namePatterns: ['crypto'] } }), 'crypto king', ''), null)
})

test('mutePlan: سقف و نامحدود', () => {
  assert.deepEqual(mutePlan(0, 1000), { untilDate: 0, minutes: 0 })
  assert.deepEqual(mutePlan(30, 1000), { untilDate: 2800, minutes: 30 })
  assert.equal(mutePlan(10_000_000, 0).minutes, 365 * 24 * 60)
})

test('mergeSettings: ورودی زباله از پنل، همه‌چیز clamp می‌شود', () => {
  const base = defaultSettings()
  const merged = mergeSettings(base, {
    flood: { on: 'بله', windowSec: -5, max: 9999, action: 'drop-all', muteMin: 'x' },
    words: { on: true, patterns: ['', 1, 'a'.repeat(500)], action: 'warn' },
    caps: { maxRatio: 12 },
    warnLimit: 900,
    title: 'x'.repeat(500),
    logChatId: '12345',
    type: 'nonsense',
  })
  assert.equal(merged.flood.on, true, 'مقدار غیرbool → پیش‌فرض')
  assert.equal(merged.flood.windowSec, 2)
  assert.equal(merged.flood.max, 100)
  assert.equal(merged.flood.action, 'delete', 'اکشن نامعتبر → پیش‌فرض')
  assert.deepEqual(merged.words.patterns, ['1', 'a'.repeat(200)], 'خالی حذف، نوع به رشته، سقف طول')
  assert.equal(merged.caps.maxRatio, 1)
  assert.equal(merged.warnLimit, 20)
  assert.equal(merged.title.length, 80)
  assert.equal(merged.logChatId, 12345)
  assert.equal(merged.type, base.type)
})

test('mergeSettings: null/undefined نمی‌ترکاند و هیچ کلیدی نمی‌دزدد', () => {
  for (const bad of [null, undefined, 'str', 42, [], { flood: null }, { flood: 7 }]) {
    const m = mergeSettings(defaultSettings(), bad)
    assert.equal(typeof m.flood.windowSec, 'number')
    assert.equal(m.moderation, defaultSettings().moderation)
  }
})

test('mergeGlobal: آدهر‌ها و تایم‌زون', () => {
  const base = { tzOffsetMin: 210, admins: [], defaults: defaultSettings(), broadcastMaxPerTick: 20, broadcastGapMs: 120, helpFooter: 'SelfHub' }
  assert.equal(mergeGlobal(base, { tzOffsetMin: 99999 }).tzOffsetMin, 840)
  assert.deepEqual(mergeGlobal(base, { admins: ['5', -1, 0, 7, 'x'.repeat(9)] }).admins, [5, 7])
  assert.equal(mergeGlobal(base, { admins: 'nope' }).admins.length, 0)
})
