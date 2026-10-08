import { test } from 'node:test'
import assert from 'node:assert/strict'

import { everyLabel, formatClock, humanUntil, nextAfter, parseWhen, toLatinDigits } from '../src/logic/schedule.ts'

const NOW = Math.floor(Date.UTC(2026, 9, 8, 10, 0) / 1000) // 2026-10-08 10:00 UTC
const TEHRAN = 210 // +3:30

test('ارقام فارسی/عربی تبدیل می‌شوند', () => {
  assert.equal(toLatinDigits('۱۲:۳۰'), '12:30')
  assert.equal(toLatinDigits('٤٥'), '45')
  assert.equal(toLatinDigits('abc'), 'abc')
})

test('+30m و واحدهای فارسی', () => {
  assert.equal(parseWhen('+30m', NOW, TEHRAN)?.at, NOW + 1800)
  assert.equal(parseWhen('+2h', NOW, TEHRAN)?.at, NOW + 7200)
  assert.equal(parseWhen('۴۵ ثانیه', NOW, TEHRAN)?.at, NOW + 45)
  assert.equal(parseWhen('30 دقیقه دیگه', NOW, TEHRAN)?.at, NOW + 1800)
  assert.equal(parseWhen('+1d', NOW, TEHRAN)?.at, NOW + 86400)
  assert.equal(parseWhen('+1w', NOW, TEHRAN)?.at, NOW + 604800)
})

test('ساعت امروز/فردا با احتساب منطقه‌ی زمانی', () => {
  const t = parseWhen('14:30', NOW, TEHRAN)
  assert.ok(t)
  // 14:30 در تهران = 11:00 UTC همان روز
  assert.equal(formatClock(t.at, TEHRAN).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))), '2026-10-08 14:30')
  const night = parseWhen('09:00', NOW, TEHRAN) // گذشته است → فردا
  assert.equal(night?.at, t!.at - (14 * 3600 + 30 * 60) + 9 * 3600 + 86400)
  const tom = parseWhen('فردا ۸:۰۰', NOW, TEHRAN)
  assert.ok(tom && tom.at > NOW)
  assert.equal(formatClock(tom.at, TEHRAN).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))), '2026-10-09 08:00')
})

test('تاریخ کامل', () => {
  const j = parseWhen('2026-12-01 06:30', NOW, TEHRAN)
  assert.equal(j && formatClock(j.at, TEHRAN).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))), '2026-12-01 06:30')
})

test('هر X دقیقه — تکرارشونده', () => {
  const e = parseWhen('every 15m بررسی', NOW, TEHRAN)
  assert.equal(e?.everySec, 900)
  assert.ok(e && e.at > NOW)
  const fa = parseWhen('هر ۳۰ دقیقه گزارش', NOW, TEHRAN)
  assert.equal(fa?.everySec, 1800)
  assert.equal(parseWhen('هر ۵ ثانیه x', NOW, TEHRAN), null, 'تکرار زیر ۳۰ ثانیه رد می‌شود')
})

test('متن مصرف‌شود برای زمان درست برمی‌گردد', () => {
  const p = parseWhen('+20m چای یادت باشه', NOW, TEHRAN)
  assert.equal('چای یادت باشه', '+20m چای یادت باشه'.slice(('+20m چای یادت باشه'.indexOf(p!.consumed)) + p!.consumed.length).trim())
  assert.equal(parseWhen('بدون زمان', NOW, TEHRAN), null)
  assert.equal(parseWhen('', NOW, TEHRAN), null)
})

test('nextAfter و برچسب‌ها', () => {
  assert.equal(nextAfter(1000, 0, 5000), 0, 'یک‌بارمصرف')
  assert.equal(nextAfter(1000, 600, 5000), 5200)
  assert.equal(humanUntil(NOW + 90, NOW), '۱ دقیقه دیگر')
  assert.equal(everyLabel(1800), 'هر ۳۰ دقیقه')
  assert.equal(everyLabel(0), 'یک‌بار')
})
