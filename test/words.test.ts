import { test } from 'node:test'
import assert from 'node:assert/strict'

import { compilePattern, fuzzyWordHit, hasInviteLink, hasLink, normalize, upperRatio, wordHits, matchesKeyword } from '../src/logic/words.ts'

test('normalize: یکسان‌سازی ی/ك، ارقام فارسی، اعراب و نویسه‌های نامرئی', () => {
  assert.equal(normalize('سلام\u200b'), 'سلام')
  assert.equal(normalize('مدرسه\u0640'), 'مدرسه')
  assert.equal(normalize('علي'), 'علی') // عربی → فارسی
  assert.equal(normalize('كتاب'), 'کتاب')
  assert.equal(normalize('قیمت ۱۲۰۰ تومان'), 'قیمت 1200 تومان')
  assert.equal(normalize('  A   B '), 'a b')
  assert.equal(normalize('نیم\u200cفاصله'), 'نیم\u200cفاصله', 'ZWNJ باید بماند')
})

test('wordHits: الگوی ساده، ستاره و regex', () => {
  assert.deepEqual(wordHits('این کانال عالی است', ['کانال']), ['کانال'])
  assert.deepEqual(wordHits('قیمت ویژه ۵۰٪', ['*ویژه*']), ['*ویژه*'])
  assert.deepEqual(wordHits('کد 12345 را داد', ['regex:کد\\s+\\d{5}']), ['regex:کد\\s+\\d{5}'])
  assert.equal(wordHits('هیچ', ['الکی']).length, 0)
  assert.deepEqual(wordHits('بیا بیا', ['بیا', 'برو']).length, 1, 'بدون تکرار')
})

test('compilePattern: ورودی خراب نمی‌ترکد', () => {
  assert.equal(compilePattern(''), null)
  assert.equal(compilePattern('regex:('), null)
  assert.ok(compilePattern('سلام*چطوری') instanceof RegExp)
})

test('لینک و لینک عضویت', () => {
  assert.ok(hasLink('برو https://example.com/x'))
  assert.ok(hasLink('t.me/durov'))
  assert.ok(!hasLink('متن معمولی بدون نشانی'))
  assert.ok(hasInviteLink('بیا عضو شو https://t.me/+AbCdEf123'))
  assert.ok(hasInviteLink('t.me/joinchat/AAAAAE'))
  assert.ok(!hasInviteLink('https://t.me/existing_channel'))
})

test('upperRatio: فقط حروف شمرده می‌شوند', () => {
  assert.equal(upperRatio('SPAM SPAM'), 1)
  assert.equal(upperRatio('hello'), 0)
  assert.ok(Math.abs(upperRatio('Hello WORLD') - 6 / 10) < 1e-9) // H,W,O,R,L,D
  assert.equal(upperRatio('12345'), 0)
})

test('fuzzyWordHit: تلورانس یک ویرایش برای دور زدن تایپو', () => {
  assert.ok(fuzzyWordHit('اسپمز وینز', ['اسپمر']))
  assert.equal(fuzzyWordHit('کاملا متفاوت', ['اسپمر']), null)
})

test('matchesKeyword: حالت‌های تطبیق', () => {
  assert.ok(matchesKeyword('contains', 'قیمت چنده؟', 'قیمت'))
  assert.ok(matchesKeyword('exact', '  salam ', 'SALAM'))
  assert.ok(!matchesKeyword('exact', 'salam ali', 'salam'))
  assert.ok(matchesKeyword('starts', '/price list', '/price'))
  assert.ok(matchesKeyword('regex', 'order 42', 'order\\s+\\d+'))
  assert.ok(!matchesKeyword('regex', 'order', 'order\\('), 'regex خراب نباید crash کند')
})
