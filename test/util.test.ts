import { test } from 'node:test'
import assert from 'node:assert/strict'

import { b64decode, b64encode, clamp, dayKey, fmtDuration, hmacHex, hmacVerifyHex, hourKey, intOr, nowSec, passwordStrength, pbkdf2Hash, pbkdf2Verify, aesDecrypt, aesEncrypt, aesKeyFromBytes, randHex, timingSafeB64Equal, toInt } from '../src/util.ts'

test('base64 رفت‌وبرگشت با بایت‌های تصادفی', () => {
  for (const n of [0, 1, 16, 33, 255]) {
    const bytes = new Uint8Array(n)
    crypto.getRandomValues(bytes)
    assert.deepEqual(b64decode(b64encode(bytes)), bytes, `n=${n}`)
  }
})

test('randHex: طول و الفبا', () => {
  assert.equal(randHex(16).length, 32)
  assert.match(randHex(8), /^[0-9a-f]{16}$/)
  assert.notEqual(randHex(8), randHex(8))
})

test('HMAC: امضای معتبر می‌گذرد، دست‌کاری‌شده نه', async () => {
  const key = new TextEncoder().encode('secret-key')
  const sig = await hmacHex(key, 'sess:123')
  assert.match(sig, /^[0-9a-f]{64}$/)
  assert.equal(await hmacVerifyHex(key, 'sess:123', sig), true)
  assert.equal(await hmacVerifyHex(key, 'sess:124', sig), false)
  assert.equal(await hmacVerifyHex(new TextEncoder().encode('other'), 'sess:123', sig), false)
  assert.equal(await hmacVerifyHex(key, 'sess:123', 'zz'), false, 'هگز نامعتبر')
  assert.equal(await hmacVerifyHex(key, 'sess:123', '0'.repeat(64)), false)
})

test('PBKDF2: هش رمز و بررسی، و salt تصادفی', async () => {
  const a = await pbkdf2Hash('correct horse battery', 2_000)
  const b = await pbkdf2Hash('correct horse battery', 2_000)
  assert.notEqual(a.salt, b.salt, 'salt تکراری نیست')
  assert.notEqual(a.hash, b.hash)
  assert.equal(await pbkdf2Verify('correct horse battery', a.salt, a.hash, a.iter), true)
  assert.equal(await pbkdf2Verify('wrong', a.salt, a.hash, a.iter), false)
  assert.equal(await pbkdf2Verify('correct horse battery', a.salt, a.hash, 1_000), false, 'تکرار کمتر نباید بپذیرد')
})

test('AES-GCM: رفت‌وبرگشت و تشخیص تغییر متن', async () => {
  const key = await aesKeyFromBytes(new TextEncoder().encode(randHex(32)).slice(0, 32))
  const enc = await aesEncrypt(key, 'توکن:123:abc')
  assert.equal(await aesDecrypt(key, enc), 'توکن:123:abc')
  assert.notEqual(await aesEncrypt(key, 'same'), enc, 'iv تصادفی است')
  const other = await aesKeyFromBytes(new TextEncoder().encode(randHex(32)).slice(0, 32))
  await assert.rejects(() => aesDecrypt(other, enc))
})

test('passwordStrength: سقف پایین، الگوهای رایج، امتیاز', () => {
  assert.equal(passwordStrength('short').ok, false)
  assert.equal(passwordStrength('password1234').ok, false, 'الگوی رایج')
  assert.equal(passwordStrength('1234567890').ok, false)
  const good = passwordStrength('Zh3-آزمايشي!')
  assert.equal(good.ok, true)
  assert.ok(good.score >= 3)
  assert.equal(passwordStrength('abcdefghijkl').score, 1, 'فقط حروف کوچک → قبول ولی ضعیف')
  assert.equal(passwordStrength('Ab3!long-enough-pass').score, 5)
})

test('timingSafeB64Equal', () => {
  assert.equal(timingSafeB64Equal('abc', 'abc'), true)
  assert.equal(timingSafeB64Equal('abc', 'abd'), false)
  assert.equal(timingSafeB64Equal('abc', 'ab'), false)
})

test('clamp / toInt / intOr', () => {
  assert.equal(clamp(5, 1, 10), 5)
  assert.equal(clamp(-5, 1, 10), 1)
  assert.equal(clamp(NaN, 3, 9), 3)
  assert.equal(toInt('42', 0), 42)
  assert.equal(toInt('abc', 7), 7)
  assert.equal(toInt(undefined, 7), 7)
  assert.equal(toInt(' 12 ', 0), 12)
  assert.equal(toInt('1.5', 0), 0, 'رشته‌ی غیرصحیح عددی → پیش‌فرض')
  assert.equal(toInt(3.9, 0), 3, 'عدد اعشاری قطع می‌شود')
  assert.equal(toInt(Infinity, 4), 4)
  assert.equal(intOr('9', -1), 9)
  assert.equal(intOr('9.7', -1), 9)
  assert.equal(intOr('x', -1), -1)
})

test('dayKey/hourKey با منطقه‌ی زمانی', () => {
  const ts = Date.UTC(2026, 9, 8, 23, 0)
  assert.equal(dayKey(ts, 0), '2026-10-08')
  assert.equal(dayKey(ts, 210), '2026-10-09', '۳:۳۰ بعد از نیمه‌شب → روز بعد')
  assert.equal(hourKey(ts, 0) + 1, hourKey(Date.UTC(2026, 9, 9, 0, 0), 0))
})

test('fmtDuration و nowSec', () => {
  assert.match(fmtDuration(1000), /ثانیه/)
  assert.match(fmtDuration(5 * 60_000), /دقیقه/)
  assert.match(fmtDuration(90 * 60_000), /ساعت/)
  assert.equal(typeof nowSec(), 'number')
  assert.ok(Math.abs(nowSec() - Date.now() / 1000) < 2)
})
