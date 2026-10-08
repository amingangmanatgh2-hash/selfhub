/**
 * پیمان API بین سه لایه: پنل (public/app.js) ← دادهٔ نمایشی (public/demo.js) ← سرور (src/hub.do.ts).
 *
 * چرا: یک مسیرِ جاافتاده در مرورگر فقط با کلیک روی همان دکمه معلوم می‌شود، و دقیقاً همین
 * نوع drift باعث شد نسخهٔ ۱ نصفه‌کاره به نظر برسد. این تست‌ها هر سه لایه را به هم قفل می‌کنند.
 */

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url).pathname
const at = (p: string) => readFileSync(root + p, 'utf8')
const appJs = at('public/app.js')
const demoJs = at('public/demo.js')
const hubDo = at('src/hub.do.ts')
const worker = at('src/index.ts')

type Entry = {
  /** همان چیزی که پنل صدا می‌زند (بررسی می‌شود در app.js پیدا شود) */
  call: string
  /** مسیری که به demoApi داده می‌شود */
  demo: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: Record<string, unknown>
  /** کلیدهایی که UI از پاسخ می‌خواند */
  keys: string[]
  /** تکه‌ای که باید در hub.do.ts (یا src/index.ts برای مسیرهای ورکر) باشد */
  marker: string
  where?: 'worker'
}

const CONTRACT: Entry[] = [
  { call: '/api/state', demo: '/api/state', method: 'GET', keys: ['installed', 'authed', 'version', 'chats', 'commands', 'lastUpdateId'], marker: "'/api/state'", where: 'worker' },
  { call: '/api/login', demo: '/api/login', method: 'POST', body: { password: 'x' }, keys: ['ok'], marker: "'/admin/login'", where: 'worker' },
  { call: '/api/setup', demo: '/api/setup', method: 'POST', body: { token: '1:a', password: 'x' }, keys: ['ok'], marker: "'/admin/setup'", where: 'worker' },
  { call: '/api/logout', demo: '/api/logout', method: 'POST', keys: ['ok'], marker: "'/api/logout'", where: 'worker' },
  { call: '/api/overview', demo: '/api/overview?days=14', method: 'GET', keys: ['totals', 'growth', 'series', 'hourly', 'top', 'events', 'chats'], marker: "'/overview'" },
  { call: '/api/chats', demo: '/api/chats', method: 'GET', keys: ['chats'], marker: "'/chats'" },
  { call: '/api/chats/', demo: '/api/chats/-100123', method: 'GET', keys: ['settings', 'keywords', 'notes', 'jobs', 'modlog', 'stats'], marker: 'chats\\/-?\\d+$' },
  { call: '/api/chats/', demo: '/api/chats/-100123/settings', method: 'PUT', body: { moderation: false }, keys: ['settings'], marker: 'chats\\/-?\\d+\\/settings$' },
  { call: '/api/chats/', demo: '/api/chats/-100123/keywords', method: 'POST', body: { pattern: 'قیمت', reply: 'پاسخ' }, keys: ['keywords'], marker: 'chats\\/-?\\d+\\/keywords$' },
  { call: '/api/chats/', demo: '/api/chats/-100123/notes', method: 'POST', body: { name: 'test', text: 'متن' }, keys: ['notes'], marker: 'chats\\/-?\\d+\\/notes$' },
  { call: '/api/chats/', demo: '/api/chats/-100123/test', method: 'POST', body: { text: 'کلاهبرداری' }, keys: ['wouldDelete', 'action', 'reasons'], marker: 'chats\\/-?\\d+\\/test$' },
  { call: '/api/schedule', demo: '/api/schedule', method: 'GET', keys: ['jobs'], marker: "'/schedule'" },
  { call: '/api/schedule/', demo: '/api/schedule/1/run', method: 'POST', keys: ['ok'], marker: 'schedule\\/\\d+\\/run$' },
  { call: '/api/modlog', demo: '/api/modlog?limit=50', method: 'GET', keys: ['rows'], marker: "'/modlog'" },
  { call: '/api/global', demo: '/api/global', method: 'GET', keys: ['global'], marker: "'/global'" },
  { call: '/api/broadcast', demo: '/api/broadcast', method: 'POST', body: { text: 'نمونه', dryRun: true }, keys: ['preview'], marker: "'/broadcast'" },
  { call: '/api/export', demo: '/api/export', method: 'GET', keys: ['dump'], marker: "'/export'" },
  { call: '/api/stats.csv', demo: '/api/stats.csv', method: 'GET', keys: [], marker: "'/stats.csv'" },
  { call: '/api/security/password', demo: '/api/security/password', method: 'POST', body: { current: 'a', next: 'b' }, keys: ['ok'], marker: "'/security/password'" },
  { call: '/api/security/token', demo: '/api/security/token', method: 'PUT', body: { token: '1:a' }, keys: ['ok'], marker: "'/security/token'" },
  { call: '/api/security/webhook', demo: '/api/security/webhook?url=http://x', method: 'POST', keys: ['ok'], marker: "'/security/webhook'" },
  { call: '/api/security/webhook/drop', demo: '/api/security/webhook/drop', method: 'POST', keys: ['ok'], marker: "'/security/webhook/drop'" },
  { call: '/api/danger/wipe', demo: '/api/danger/wipe', method: 'POST', body: { confirm: 'WIPE' }, keys: ['ok'], marker: "'/danger/wipe'" },
]

test('پنل همان مسیری را صدا می‌زند که در قرارداد هست', () => {
  for (const e of CONTRACT) {
    assert.ok(appJs.includes(e.call), `app.js دیگر «${e.call}» را صدا نمی‌زند — قرارداد را به‌روز کن`)
  }
})

test('سرور (ورکر/DO) هر مسیر قرارداد را پیاده کرده است', () => {
  for (const e of CONTRACT) {
    const src = e.where === 'worker' ? worker : hubDo
    assert.ok(src.includes(e.marker), `route ${e.demo} (marker: ${e.marker}) در ${e.where === 'worker' ? 'src/index.ts' : 'src/hub.do.ts'} پیدا نشد`)
  }
})

test('demo.js پاسخ هر مسیر را با همان کلیدها می‌دهد', async () => {
  const win: Record<string, unknown> = {}
  const factory = new Function('window', demoJs + '\nreturn window.DEMO')
  const DEMO = factory(win) as { api: (p: string, o: { method: string; body?: string }) => Promise<unknown> }
  assert.equal(typeof DEMO?.api, 'function', 'demo.js روی window.DEMO api نساخت')

  for (const e of CONTRACT) {
    const res = await DEMO.api(e.demo, { method: e.method, body: e.body ? JSON.stringify(e.body) : undefined })
    assert.notEqual(res, undefined, `demo: ${e.demo} بدون پاسخ ماند`)
    if (typeof res === 'string') {
      assert.ok(e.keys.length === 0, `demo: ${e.demo} متن خالی برمی‌گرداند ولی پنل کلید انتظار دارد`)
      continue
    }
    const obj = res as Record<string, unknown>
    for (const k of e.keys) {
      assert.ok(k in obj, `demo: پاسخ ${e.demo} کلید «${k}» را ندارد (پنل همان را می‌خواند)`)
    }
  }
})

test('هیچ id ای در پنل هست که هیچ‌وقت ساخته نشود', () => {
  // هر $('#x') باید یا در index.html باشد یا در همین فایل با id="x" ساخته شود
  const declared = new Set<string>([...appJs.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map((m) => m[1] as string))
  const indexHtml = at('public/index.html')
  for (const m of indexHtml.matchAll(/id="([a-zA-Z0-9_-]+)"/g)) declared.add(m[1] as string)
  const queried = [...appJs.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1] as string)
  const missing = queried.filter((q) => !declared.has(q))
  assert.deepEqual(missing, [], `این انتخابگرها هیچ‌وقت چیزی پیدا نمی‌کنند: ${missing.join(', ')}`)
})
