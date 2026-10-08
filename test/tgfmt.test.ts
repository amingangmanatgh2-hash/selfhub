import { test } from 'node:test'
import assert from 'node:assert/strict'

import { actionLabel, chatTypeLabel, escHtml, faDateTime, faInt, mention, modlogLine, ruleLabel, statusLines, tpl, truncate, userLabel } from '../src/tgfmt.ts'
import type { ModlogRow } from '../src/types.ts'

test('escHtml: کاراکترهای HTML خنثی می‌شوند (تزریق در پیام ربات)', () => {
  assert.equal(escHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;')
  assert.equal(escHtml('a & b < c > d'), 'a &amp; b &lt; c &gt; d')
  assert.equal(escHtml('"quotes"'), '"quotes"')
  // ورودی کاربر باید قبل از قرارگیری در تگ فرار شود
  assert.equal(`<b>${escHtml('<b>')}</b>`, '<b>&lt;b&gt;</b>')
})

test('faInt: ارقام فارسی و جداکننده', () => {
  assert.equal(faInt(0), '۰')
  assert.equal(faInt(1234), '۱٬۲۳۴')
  assert.equal(faInt(999), '۹۹۹')
})

test('truncate: کوتاه‌کردن بدون ترکاندن', () => {
  assert.equal(truncate('abc', 5), 'abc')
  assert.equal(truncate('a'.repeat(20), 5).length, 5)
  assert.ok(truncate('a'.repeat(20), 5).endsWith('…'))
  assert.equal(truncate('  چند   فاصله  ', 40), 'چند فاصله')
  assert.equal(truncate(undefined as unknown as string), '')
})

test('tpl: فقط متغیرهای شناخته‌شده جایگزین می‌شوند', () => {
  assert.equal(tpl('سلام {name}، عضو {count}م', { name: '@ali', count: 42 }), 'سلام @ali، عضو 42م')
  assert.equal(tpl('{unknown} {name}', { name: 'x' }), '{unknown} x')
  assert.equal(tpl('{first} {time}', { first: 'a', time: '10:00' }), 'a 10:00')
  assert.equal(tpl('{username}', { username: undefined }), '')
})

test('userLabel و mention', () => {
  assert.equal(userLabel({ id: 1, is_bot: false, first_name: 'علی', username: 'ali' }), '@ali')
  assert.equal(userLabel({ id: 1, is_bot: false, first_name: 'علی' }), 'علی')
  assert.equal(userLabel({ id: 1, is_bot: false, first_name: '', username: '  ' }), '1')
  assert.equal(userLabel(null), 'ناشناس')
  assert.equal(mention({ id: 5, is_bot: false, first_name: 'سارا' }), '<a href="tg://user?id=5">سارا</a>')
  assert.equal(mention(null), 'ناشناس')
  // تزریق از طریق نام کاربر خنثی می‌شود
  assert.ok(!mention({ id: 5, is_bot: false, first_name: '<img src=x>' }).includes('<img'))
})

test('برچسب‌های فارسی', () => {
  assert.equal(actionLabel('mute'), 'سکوت')
  assert.equal(actionLabel('ban'), 'بن')
  assert.equal(ruleLabel('flood'), 'فلود')
  assert.equal(chatTypeLabel('supergroup'), 'ابرگروه')
  assert.equal(chatTypeLabel('private'), 'شخصی')
})

test('faDateTime با آفست زمانی', () => {
  const ts = Math.floor(Date.UTC(2026, 9, 8, 0, 0) / 1000)
  assert.equal(faDateTime(ts, 0), '2026/10/08 00:00')
  assert.equal(faDateTime(ts, 210), '2026/10/08 03:30')
})

test('modlogLine: تاریخ، هدف و دلیل فرار‌شده', () => {
  const row: ModlogRow = {
    id: 1,
    chatId: -100,
    action: 'سکوت',
    targetId: 42,
    targetName: '<b>@x</b>',
    moderator: 'خودکار',
    reason: 'flood',
    ts: Date.UTC(2026, 9, 8, 10, 0),
  }
  const line = modlogLine(row, 0)
  assert.match(line, /<code>2026\/10\/08 10:00<\/code>/)
  assert.match(line, /سکوت/)
  assert.match(line, /&lt;b&gt;@x&lt;\/b&gt;/)
  assert.ok(!line.includes('<b>@x'))
})

test('statusLines: خلاصه‌ی قابل‌خواندن', () => {
  const lines = statusLines('گروه من', { moderation: true, autoreply: false, welcome: true, captcha: false, flood: { on: true, max: 6 }, warnLimit: 3 })
  assert.match(lines[0]!, /گروه من/)
  assert.equal(lines.filter(l => l.includes('✅')).length, 3)
  assert.equal(lines.filter(l => l.includes('❌')).length, 2)
})
