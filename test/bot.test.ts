import { test } from 'node:test'
import assert from 'node:assert/strict'

import { TelegramBot, TelegramError, kb } from '../src/bot.ts'
import type { FetchLike } from '../src/bot.ts'

interface Call {
  url: string
  body: Record<string, unknown>
}

function stubHandler(handler: (call: Call, n: number) => { status?: number; json: unknown }) {
  const calls: Call[] = []
  const f: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ url, body })
    const r = handler({ url, body }, calls.length - 1)
    return {
      status: r.status ?? 200,
      json: async () => r.json,
      text: async () => JSON.stringify(r.json),
    }
  }
  return { calls, f }
}

const TOKEN = '123456:AA' + 'B'.repeat(35)

test('توکن نامعتبر در همان ساخت رد می‌شود', () => {
  assert.throws(() => new TelegramBot('nonsense'), /قالب Bot Token/)
  assert.throws(() => new TelegramBot('12:short'), /قالب Bot Token/)
})

test('sendMessage: JSON payload با parse_mode و reply_parameters', async () => {
  const { calls, f } = stubHandler(() => ({ json: { ok: true, result: { message_id: 1 } } }))
  const bot = new TelegramBot(TOKEN, { fetch: f })
  await bot.sendMessage(-100, 'سلام', { replyTo: 7 })
  const c = calls[0]!
  assert.equal(c.url, `https://api.telegram.org/bot${TOKEN}/sendMessage`)
  assert.equal(c.body.chat_id, -100)
  assert.equal(c.body.text, 'سلام')
  assert.equal(c.body.parse_mode, 'HTML')
  assert.deepEqual(c.body.reply_parameters, { message_id: 7, allow_sending_without_reply: true })
  assert.equal(c.body.disable_web_page_preview, true)
})

test('بدنه‌ی بیش از ۴۰۹۶ نویسه بریده می‌شود', async () => {
  const { calls, f } = stubHandler(() => ({ json: { ok: true, result: {} } }))
  const bot = new TelegramBot(TOKEN, { fetch: f })
  await bot.sendMessage(1, 'x'.repeat(5000))
  assert.equal(String(calls[0]!.body.text).length, 4096)
})

test('۴۲۹: با retry_after تلگرام صبر و تلاش می‌کند', async () => {
  const slept: number[] = []
  const { calls, f } = stubHandler((_c, n) => (n === 0 ? { status: 429, json: { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 4 } } } : { json: { ok: true, result: { message_id: 5 } } }))
  const bot = new TelegramBot(TOKEN, {
    fetch: f,
    sleep: async ms => {
      slept.push(ms)
    },
  })
  const r = await bot.sendMessage(1, 'hi')
  assert.equal(r.message_id, 5)
  assert.equal(calls.length, 2)
  assert.equal(slept[0], 4250, '۴ ثانیه + فاصله')
})

test('۴۲۹ با retry_after بزرگ سقف دارد', async () => {
  const slept: number[] = []
  const { f } = stubHandler((_c, n) => (n < 2 ? { status: 429, json: { ok: false, error_code: 429, parameters: { retry_after: 600 } } } : { json: { ok: true, result: {} } }))
  const bot = new TelegramBot(TOKEN, {
    fetch: f,
    sleep: async ms => {
      slept.push(ms)
    },
  })
  await bot.sendMessage(1, 'hi')
  assert.equal(slept[0], 30250)
})

test('خطای تلگرام با پیام اصلی و نشانک benign', async () => {
  const { f } = stubHandler(() => ({ status: 400, json: { ok: false, error_code: 400, description: 'BOT_KICKED_FROM_CHAT' } }))
  const bot = new TelegramBot(TOKEN, { fetch: f })
  await assert.rejects(() => bot.sendMessage(1, 'x'), (e: unknown) => {
    assert.ok(e instanceof TelegramError)
    assert.equal((e as TelegramError).status, 400)
    assert.match((e as TelegramError).message, /BOT_KICKED/)
    return true
  })
  assert.equal(new TelegramError(400, { ok: false, description: 'bot was kicked from the group chat' }).benign, true)
  assert.equal(new TelegramError(400, { ok: false, description: 'some real problem' }).benign, false)
})

test('trySend خطای بی‌خطر را می‌خورد و بقیه را نه', async () => {
  const f: FetchLike = async () => ({ status: 403, json: async () => ({ ok: false, error_code: 403, description: 'bot was blocked by the user' }), text: async () => '' })
  const bot = new TelegramBot(TOKEN, { fetch: f })
  assert.equal(await bot.trySend(1, 'x'), null)

  const f2: FetchLike = async () => ({ status: 400, json: async () => ({ ok: false, error_code: 400, description: 'REPLY_MESSAGE_WRONG' }), text: async () => '' })
  const bot2 = new TelegramBot(TOKEN, { fetch: f2 })
  await assert.rejects(() => bot2.trySend(1, 'x'))
})

test('قطع شبکه: retry با backoff و در نهایت خطای خوانا', async () => {
  let n = 0
  const slept: number[] = []
  const bot = new TelegramBot(TOKEN, {
    fetch: async () => {
      n++
      if (n <= 2) throw new Error('socket hang up')
      return { status: 200, json: async () => ({ ok: true, result: { id: 7 } }), text: async () => '{}' }
    },
    sleep: async ms => {
      slept.push(ms)
    },
  })
  const me = await bot.getMe()
  assert.equal(me.id, 7)
  assert.deepEqual(slept, [400, 800])

  const always = new TelegramBot(TOKEN, {
    fetch: async () => {
      throw new Error('boom')
    },
    sleep: async () => undefined,
    maxRetries: 1,
  })
  await assert.rejects(() => always.getMe(), /ارتباط با تلگرام برقرار نشد/)
})

test('پاسخ غیرJSON (مثلاً صفحهٔ خطای پروکسی) قابل‌فهم است', async () => {
  const bot = new TelegramBot(TOKEN, {
    fetch: async () => ({
      status: 502,
      json: async () => {
        throw new Error('Unexpected token <')
      },
      text: async () => '<html>bad gateway</html>',
    }),
  })
  await assert.rejects(() => bot.getMe(), /پاسخ غیرJSON/)
})

test('mute/unmute/ban payload ها', async () => {
  const { calls, f } = stubHandler(() => ({ json: { ok: true, result: true } }))
  const bot = new TelegramBot(TOKEN, { fetch: f })
  await bot.restrict(-1, 2, 999)
  await bot.restrict(-1, 2, 0)
  await bot.ban(-1, 2, true)
  await bot.kick(-1, 2)
  assert.equal(calls[0]!.body.until_date, 999)
  assert.equal('until_date' in calls[1]!.body, false, 'صفر یعنی بدون until_date')
  assert.deepEqual((calls[0]!.body.permissions as Record<string, unknown>).can_send_messages, false)
  assert.equal(calls[2]!.body.revoke_messages, true)
  assert.equal(calls[3]!.url.endsWith('/banChatMember'), true, 'kick همان ban بدون revoke است')
})

test('setWebhook با allowed_updates و secret', async () => {
  const { calls, f } = stubHandler(() => ({ json: { ok: true, result: true } }))
  const bot = new TelegramBot(TOKEN, { fetch: f })
  await bot.setWebhook('https://x.workers.dev', 'sec123')
  const b = calls[0]!.body
  assert.equal(b.url, 'https://x.workers.dev')
  assert.equal(b.secret_token, 'sec123')
  assert.equal(b.drop_pending_updates, true)
  assert.ok(Array.isArray(b.allowed_updates))
  assert.ok((b.allowed_updates as string[]).includes('callback_query'))
})

test('صف کلیدواژه با kb: سقف ۱۲ ردیف و برش متن', () => {
  const many: [string, string][][] = Array.from({ length: 30 }, (_, i) => [[`دکمه ${'ز'.repeat(80)} ${i}`, `d${i}`]])
  const m = kb(many)
  assert.equal(m.inline_keyboard.length, 12, 'سقف ردیف')
  assert.ok(m.inline_keyboard[0]![0]!.text.length <= 64)
  assert.ok(m.inline_keyboard[0]![0]!.callback_data!.length <= 64)
  const wide = kb([Array.from({ length: 25 }, (_, i) => [`b${i}`, `c${i}`] as [string, string])])
  assert.equal(wide.inline_keyboard[0]!.length, 8, 'سقف دکمه در هر ردیف')
  assert.equal(kb([[], []]).inline_keyboard.length, 0, 'ردیف خالی حذف می‌شود')
})
