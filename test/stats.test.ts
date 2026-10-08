import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bars, csv, growth, hourlySeries, rank, series, sparkPath, totals } from '../src/logic/stats.ts'
import type { DayRow } from '../src/logic/stats.ts'

const rows: DayRow[] = [
  { day: '2026-10-01', msgs: 10, members: 1, deleted: 0, warns: 0, mutes: 0, bans: 0, replies: 2, commands: 1 },
  { day: '2026-10-02', msgs: 20, members: 0, deleted: 3, warns: 1, mutes: 1, bans: 0, replies: 4, commands: 2 },
  { day: '2026-10-03', msgs: 0, members: 2, deleted: 0, warns: 0, mutes: 0, bans: 1, replies: 0, commands: 0 },
]

test('totals: جمع و میانگین', () => {
  const t = totals(rows)
  assert.equal(t.msgs, 30)
  assert.equal(t.deleted, 3)
  assert.equal(t.bans, 1)
  assert.equal(t.avgMsgsPerDay, 10)
  assert.equal(totals([]).msgs, 0)
})

test('series: مرتب‌سازی و سقف', () => {
  const s = series([...rows].reverse(), 'msgs')
  assert.deepEqual(s.labels, ['10-01', '10-02', '10-03'])
  assert.equal(s.max, 20)
  assert.equal(s.sum, 30)
})

test('growth: ۷ روز آخر نسبت به قبل', () => {
  const g = growth([{ day: 'a', msgs: 10, members: 0, deleted: 0, warns: 0, mutes: 0, bans: 0, replies: 0, commands: 0 }], 1)
  assert.equal(g.dir, 'up')
  assert.equal(g.pct, 100)
  const flat = growth(
    [
      { day: 'a', msgs: 5, members: 0, deleted: 0, warns: 0, mutes: 0, bans: 0, replies: 0, commands: 0 },
      { day: 'b', msgs: 5, members: 0, deleted: 0, warns: 0, mutes: 0, bans: 0, replies: 0, commands: 0 },
    ],
    1,
  )
  assert.equal(flat.dir, 'flat')
})

test('hourlySeries: همیشه تعداد ساعت خواسته‌شده، حتی با داده‌ی کم', () => {
  const h = hourlySeries([{ hour: 100, msgs: 5 }], 4, 102)
  assert.equal(h.values.length, 4)
  assert.equal(h.sum, 5)
  assert.deepEqual(h.labels, ['99', '100', '101', '102'].map(x => String(Number(x) % 24).padStart(2, '0')))
})

test('sparkPath: فقط اعداد، بیرون از جعبه نمی‌زند', () => {
  const d = sparkPath([0, 5, 10, 2], 100, 30, 2)
  assert.match(d, /^M[\d.]+,[\d.]+( L[\d.]+,[\d.]+)*$/)
  for (const m of d.matchAll(/([ML])([\d.]+),([\d.]+)/g)) {
    const x = Number(m[2])
    const y = Number(m[3])
    assert.ok(Number.isFinite(x) && Number.isFinite(y))
    assert.ok(y >= 0 && y <= 30, `y خارج از جعبه: ${y}`)
    assert.ok(x >= 0 && x <= 100, `x خارج از جعبه: ${x}`)
  }
  assert.equal(sparkPath([], 10, 10), '')
  assert.match(sparkPath([7], 10, 10), /^M\d+\.\d+,\d+\.\d+$/)
  assert.match(sparkPath([1, 2, 3, 4, 5], 300, 60), /^M/)
  assert.ok(!/NaN/.test(sparkPath([0, 0, 0], 100, 20)), 'بدون NaN')
})

test('bars و rank و csv', () => {
  assert.equal(bars([0, 10, 5]).length, 3)
  assert.equal(bars([0, 10, 5])[0], '')
  assert.equal(bars([5, 5], 4)[1], '▇▇▇▇')
  assert.equal(rank([{ key: 'a', label: 'A', value: 1 }, { key: 'b', label: 'B', value: 9 }], 1)[0]?.key, 'b')
  assert.equal(rank([], 3).length, 0)
  const c = csv(rows)
  assert.equal(c.split('\n').length, 4)
  assert.ok(c.startsWith('day,msgs,members'))
})
