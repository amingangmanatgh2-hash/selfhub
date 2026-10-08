/* SelfHub — Worker ورودی
 * سه کار: ۱) پذیرش webhook تلگرام ۲) احراز هویت و پروکسی API پنل ۳) cron برای زمان‌بند
 * هیچ اتصال دائمی، هیچ WASM، هیچ ربات هلپری — فقط Bot API رسمی.
 */

import { HubDO } from './hub.do.ts'
import type { Env } from './hub.do.ts'
import { hmacHex, hmacVerifyHex, json, err, readJson, parseCookies } from './util.ts'

export { HubDO }

const COOKIE = 'sh_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

let secretCache: { bytes: Uint8Array | null; exp: number } = { bytes: null, exp: 0 }

async function signingSecret(env: Env): Promise<Uint8Array | null> {
  if (secretCache.bytes && secretCache.exp > Date.now()) return secretCache.bytes
  const hub = env.HUB.get(env.HUB.idFromName('global'))
  const data = await (await hub.fetch('https://hub/internal/signing')).json<{ secret?: string }>()
  if (!data.secret) return null
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data.secret) as unknown as ArrayBuffer)
  secretCache = { bytes: new Uint8Array(bytes), exp: Date.now() + 60_000 }
  return secretCache.bytes
}

async function makeToken(secret: Uint8Array): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS
  return `${exp}.${await hmacHex(secret, `sess:${exp}`)}`
}

async function checkToken(secret: Uint8Array, token: string | undefined): Promise<boolean> {
  if (!token) return false
  const [expStr, sig] = token.split('.')
  const exp = Number(expStr)
  if (!exp || !sig || Date.now() > exp) return false
  return hmacVerifyHex(secret, `sess:${exp}`, sig)
}

function cookie(res: Response, value: string, maxAge: number): Response {
  const r = new Response(res.body, res)
  r.headers.append(
    'set-cookie',
    `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
  )
  return r
}

function hubFetch(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const hub = env.HUB.get(env.HUB.idFromName('global'))
  return hub.fetch(`https://hub${path}`, init)
}

async function passThrough(res: Response): Promise<Response> {
  const body = await res.arrayBuffer()
  const out = new Response(body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json; charset=utf-8' } })
  const cache = res.headers.get('cache-control')
  if (cache) out.headers.set('cache-control', cache)
  return out
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname

    /* ---------- وب‌هوک تلگرام ---------- */
    const hook = path.match(/^\/webhook\/([A-Za-z0-9_-]{16,128})$/)
    if (hook) {
      const secret = hook[1] ?? ''
      const headerSecret = req.headers.get('x-telegram-bot-api-secret-token')
      let body: unknown = null
      try {
        body = await req.json()
      } catch {
        return err('bad json', 400)
      }
      // پاسخ سریع به تلگرام + پردازش در پس‌زمینه (ctx.waitUntil تا ایزوله زنده بماند)
      const p = hubFetch(env, '/internal/hook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret, headerSecret, update: body }),
      })
      ctx.waitUntil(p.catch(() => undefined))
      return json({ ok: true })
    }

    /* ---------- API پنل ---------- */
    if (path === '/api/health') return json({ ok: true, app: 'SelfHub', ts: Date.now() })

    if (path.startsWith('/api/')) {
      // CSRF: هر درخواست تغییردهنده باید هدر اختصاصی داشته باشد
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.get('x-selfhub') !== '1') {
        return err('درخواست نامعتبر (هدر x-selfhub ندارید)', 403)
      }

      const forward = async (target: string, withBody: boolean): Promise<Response> => {
        return passThrough(
          await hubFetch(env, target, {
            method: req.method,
            headers: { 'content-type': 'application/json' },
            body: withBody && !['GET', 'HEAD'].includes(req.method) ? await req.text() : undefined,
          }),
        )
      }

      if (path === '/api/state') {
        const info = await (await hubFetch(env, '/internal/info')).json<Record<string, unknown>>()
        // اگر نشست معتبر باشد پنل مستقیم وارد می‌شود (بدون فرم ورود)
        const secret = await signingSecret(env)
        const authed = secret ? await checkToken(secret, parseCookies(req)[COOKIE]) : false
        return json({ ok: true, authed, ...info })
      }

      // شبیه‌ساز محلی: فقط وقتی SIMULATE=1 در محیط باشد فعال است (برای تست بدون اکانت ربات)
      if (path === '/api/simulate' && req.method === 'POST') {
        const res = await hubFetch(env, '/internal/simulate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: await req.text(),
        })
        return passThrough(res)
      }

      if (path === '/api/setup' && req.method === 'POST') {
        const b = await readJson<{ token?: string; password?: string }>(req)
        const res = await hubFetch(env, '/admin/setup', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...b, url: url.origin }),
        })
        const data = (await res.json()) as { ok?: boolean; error?: string }
        if (!data.ok) return json(data, res.status)
        const secret = await signingSecret(env)
        if (!secret) return err('کلید امضا ساخته نشد', 500)
        return cookie(json({ ok: true }), await makeToken(secret), SESSION_TTL_MS / 1000)
      }

      if (path === '/api/login' && req.method === 'POST') {
        const b = await readJson<{ password?: string }>(req)
        const res = await hubFetch(env, '/admin/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: b.password }),
        })
        const data = (await res.json()) as { ok?: boolean }
        if (!data.ok) return json(data, res.status)
        const secret = await signingSecret(env)
        if (!secret) return err('کلید امضا ساخته نشد', 500)
        return cookie(json({ ok: true }), await makeToken(secret), SESSION_TTL_MS / 1000)
      }

      if (path === '/api/logout') {
        return cookie(json({ ok: true }), '', 0)
      }

      // بقیه‌ی /api/* نیاز به نشست معتبر دارد
      const secret = await signingSecret(env)
      if (!secret) return err('نصب انجام نشده است', 404)
      const cookies = parseCookies(req)
      if (!(await checkToken(secret, cookies[COOKIE]))) return err('unauthorized', 401)

      const rest = path.slice(4) + (url.search || '') // /api/x/y?a=1 → /admin/x/y?a=1
      if (rest === '/logs/stream' || rest.startsWith('/events')) {
        const hub = env.HUB.get(env.HUB.idFromName('global'))
        const res = await hub.fetch('https://hub/admin/events')
        return new Response(res.body, {
          headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' },
        })
      }
      return forward(`/admin${rest}`, true)
    }

    /* ---------- بقیه‌ی مسیرها: Static Assets ---------- */
    return new Response('Not Found', { status: 404 })
  },

  /* ---------- زمان‌بند و یادآور ---------- */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const hub = env.HUB.get(env.HUB.idFromName('global'))
    ctx.waitUntil(hub.fetch('https://hub/internal/tick', { method: 'POST' }).catch(() => undefined))
  },
}
