/* SelfHub — Worker اصلی: روتر API، احراز هویت، پروکسی به Durable Object ها
 *
 * بدون ربات هلپر — همه‌چیز از پنل وب با رمز ادمین کنترل می‌شود.
 */

import { HubDO } from './hub.do'
import { SelfDO } from './self.do'
import { hmacHex, json, readJson, deriveAesKey, aesEncrypt, aesDecrypt, randBytes, b64encode, isValidPhone } from './util'

export { HubDO, SelfDO }

interface Env {
  HUB: DurableObjectNamespace<HubDO>
  SELF: DurableObjectNamespace<SelfDO>
}

const COOKIE = 'sb_session'
const SESSION_TTL_MS = 2 * 60 * 60 * 1000 // ۲ ساعت

/* ---------------- session utils ---------------- */
async function getSecret(env: Env): Promise<Uint8Array | null> {
  const hub = env.HUB.get(env.HUB.idFromName('global'))
  const res = await hub.fetch('https://hub/master-key')
  const data = await res.json<any>()
  if (!data?.secret) return null
  return b64ToBytes(data.secret)
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = req.headers.get('cookie') ?? ''
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k) out[k] = v.join('=')
  }
  return out
}

async function makeToken(secret: Uint8Array): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS
  const sig = await hmacHex(secret, `sess:${exp}`)
  return `${exp}.${sig}`
}

async function checkToken(secret: Uint8Array, token: string | undefined): Promise<boolean> {
  if (!token) return false
  const [expStr, sig] = token.split('.')
  const exp = Number(expStr)
  if (!exp || !sig || Date.now() > exp) return false
  const expected = await hmacHex(secret, `sess:${exp}`)
  return expected === sig
}

function withCookie(res: Response, value: string): Response {
  const r = new Response(res.body, res)
  r.headers.append('set-cookie', `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict`)
  return r
}

function clearCookie(res: Response): Response {
  const r = new Response(res.body, res)
  r.headers.append('set-cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`)
  return r
}

/* ---------------- main router ---------------- */
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method

    if (path === '/api/ping') return json({ ok: true, ts: Date.now(), app: 'SelfHub' })

    // تست اتصال WebSocket خروجی (دیباگ)
    if (path === '/api/wstest') {
      const events: string[] = []
      const wurl = url.searchParams.get('u') ?? 'wss://venus.web.telegram.org/apiws'
      try {
        const ws = new WebSocket(wurl, 'binary')
        ws.binaryType = 'arraybuffer'
        const started = Date.now()
        await new Promise<void>((resolve) => {
          const to = setTimeout(() => { events.push('timeout-10s'); resolve() }, 10000)
          ws.addEventListener('open', () => { events.push(`open+${Date.now() - started}ms`); clearTimeout(to); resolve() })
          ws.addEventListener('error', (e: any) => { events.push('error: ' + (e?.message ?? 'unknown')); clearTimeout(to); resolve() })
          ws.addEventListener('close', () => { events.push('closed'); clearTimeout(to); resolve() })
        })
        try { ws.close() } catch {}
      } catch (e: any) {
        events.push('throw: ' + String(e?.message ?? e))
      }
      return json({ ok: true, events })
    }

    // حفاظت CSRF: درخواست‌های تغییردهنده باید هدر اختصاصی داشته باشند
    if (!['GET', 'HEAD'].includes(method) && req.headers.get('x-selfhub') !== '1') {
      return json({ ok: false, error: 'درخواست نامعتبر' }, 403)
    }

    if (!path.startsWith('/api/')) {
      // بقیه مسیرها توسط Static Assets سرو می‌شوند
      return new Response('Not Found', { status: 404 })
    }

    const hub = env.HUB.get(env.HUB.idFromName('global'))
    const secret = await getSecret(env)
    const installed = !!secret
    const cookies = parseCookies(req)
    let authed = installed ? await checkToken(secret!, cookies[COOKIE]) : false

    /* ---------------- عمومی (بدون احراز هویت) ---------------- */
    if (path === '/api/state' && method === 'GET') {
      return json({ ok: true, installed, authed })
    }

    if (path === '/api/mytg/start' && method === 'POST') {
      const res = await hub.fetch('https://hub/mytg/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: await req.text() })
      return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json; charset=utf-8' } })
    }

    if (path === '/api/mytg/verify' && method === 'POST') {
      const res = await hub.fetch('https://hub/mytg/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: await req.text() })
      return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json; charset=utf-8' } })
    }

    if (path === '/api/setup' && method === 'POST') {
      if (installed) return json({ ok: false, error: 'نصب قبلاً انجام شده است' }, 400)
      const res = await hub.fetch('https://hub/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: await req.text() })
      const data = await res.json<any>()
      if (!data.ok) return json(data, 400)
      const newSecret = await getSecret(env)
      const token = await makeToken(newSecret!)
      return withCookie(json({ ok: true }), token)
    }

    if (path === '/api/login' && method === 'POST') {
      if (!installed) return json({ ok: false, error: 'نصب انجام نشده' }, 400)
      const res = await hub.fetch('https://hub/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: await req.text() })
      const data = await res.json<any>()
      if (!data.ok) return json(data, 401)
      const token = await makeToken(secret!)
      return withCookie(json({ ok: true }), token)
    }

    if (path === '/api/logout' && method === 'POST') {
      return clearCookie(json({ ok: true }))
    }

    /* ---------------- از اینجا به بعد احراز هویت الزامی ---------------- */
    if (!authed) return json({ ok: false, error: 'unauthorized' }, 401)

    if (path === '/api/settings' && method === 'GET') {
      const res = await hub.fetch('https://hub/config')
      const data = await res.json<any>()
      return json({ ok: true, ...data })
    }

    if (path === '/api/change-password' && method === 'POST') {
      const res = await hub.fetch('https://hub/change-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: await req.text() })
      return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json; charset=utf-8' } })
    }

    if (path === '/api/notifications' && method === 'GET') {
      const res = await hub.fetch('https://hub/notifications')
      return new Response(await res.text(), { headers: { 'content-type': 'application/json; charset=utf-8' } })
    }

    /* ---------- لاگ زنده (SSE) ---------- */
    if (path === '/api/logs/stream') {
      const res = await hub.fetch('https://hub/stream')
      return new Response(res.body, {
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'connection': 'keep-alive' },
      })
    }

    /* ---------- اکانت‌ها ---------- */
    if (path === '/api/accounts' && method === 'GET') {
      const res = await hub.fetch('https://hub/accounts')
      const data = await res.json<any>()
      const accounts = (data.accounts ?? []) as any[]
      const withState = await Promise.allSettled(
        accounts.map(async a => {
          try {
            const stub = env.SELF.get(env.SELF.idFromName(a.id))
            const r = await stub.fetch('https://self/state')
            const s = await r.json<any>()
            return { ...a, status: s.status ?? 'idle', me: s.me, lastError: s.lastError, stats: s.stats, type: a.type }
          } catch {
            return { ...a, status: 'idle', me: null, stats: null }
          }
        }),
      )
      return json({ ok: true, accounts: withState.map(p => (p.status === 'fulfilled' ? p.value : null)).filter(Boolean) })
    }

    if (path === '/api/accounts' && method === 'POST') {
      const b = await readJson<any>(req)
      const type: 'user' | 'bot' | 'demo' = b.type === 'bot' ? 'bot' : b.type === 'demo' ? 'demo' : 'user'
      if (type === 'user' && b.phone && !isValidPhone(b.phone)) return json({ ok: false, error: 'شماره نامعتبر است (مثل +989123456789)' }, 400)
      // ساخت در هاب
      const res = await hub.fetch('https://hub/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: b.label, type, phone: b.phone }),
      })
      const data = await res.json<any>()
      if (!data.ok) return json(data, 400)
      const account = data.account
      // مقداردهی DO
      const internal = await (await hub.fetch('https://hub/internal')).json<any>()
      const cfg = internal.cfg
      const stub = env.SELF.get(env.SELF.idFromName(account.id))
      await stub.fetch('https://self/init', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: account.id, label: account.label, type, apiId: cfg.apiId, apiHash: cfg.apiHash, masterKey: cfg.secret }),
      })
      // بات: ورود مستقیم با توکن / دمو: اتصال نمایشی
      if (type === 'bot' && cfg.botToken) {
        const r = await stub.fetch('https://self/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ botToken: cfg.botToken }) })
        const d = await r.json<any>()
        return json({ ok: true, account, login: d })
      }
      if (type === 'demo') {
        await stub.fetch('https://self/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      }
      return json({ ok: true, account })
    }

    if (path === '/api/accounts' && method === 'DELETE') {
      const idParam = url.searchParams.get('id') ?? ''
      const stub = env.SELF.get(env.SELF.idFromName(idParam))
      await stub.fetch('https://self/purge-data', { method: 'POST' }).catch(() => {})
      const res = await hub.fetch(`https://hub/accounts?id=${encodeURIComponent(idParam)}`, { method: 'DELETE' })
      return new Response(await res.text(), { headers: { 'content-type': 'application/json; charset=utf-8' } })
    }

    if (path === '/api/accounts' && method === 'PUT') {
      const res = await hub.fetch('https://hub/accounts', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: await req.text() })
      return new Response(await res.text(), { headers: { 'content-type': 'application/json; charset=utf-8' } })
    }

    /* ---------- مسیرهای هر اکانت: /api/a/<id>/... ---------- */
    const m = path.match(/^\/api\/a\/([^/]+)\/(.*)$/)
    if (m) {
      const [, accId, sub] = m
      // بررسی وجود اکانت
      const listRes = await hub.fetch('https://hub/accounts')
      const list = (await listRes.json<any>()).accounts ?? []
      if (!list.find((a: any) => a.id === accId)) return json({ ok: false, error: 'اکانت یافت نشد' }, 404)
      const stub = env.SELF.get(env.SELF.idFromName(accId))
      const targetPath = '/' + sub
      const init = new Request(url.origin + targetPath, {
        method,
        headers: { 'content-type': 'application/json' },
        body: ['GET', 'HEAD'].includes(method) ? undefined : await req.text(),
      })
      const res = await stub.fetch(init)
      return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json; charset=utf-8' } })
    }

    /* ---------- بکاپ و بازیابی ---------- */
    if (path === '/api/backup' && method === 'POST') {
      const b = await readJson<any>(req)
      const password = String(b.password ?? '')
      if (password.length < 8) return json({ ok: false, error: 'رمز بکاپ حداقل ۸ نویسه باشد' }, 400)
      const internal = await (await hub.fetch('https://hub/internal')).json<any>()
      const cfg = internal.cfg
      const list = ((await (await hub.fetch('https://hub/accounts')).json<any>()).accounts ?? []) as any[]
      const accounts: any[] = []
      for (const a of list) {
        const stub = env.SELF.get(env.SELF.idFromName(a.id))
        const ex = await (await stub.fetch('https://self/export')).json<any>()
        accounts.push({ meta: a, session: ex.session, config: ex.config })
      }
      const payload = {
        app: 'selfhub',
        version: 1,
        createdAt: Date.now(),
        config: { apiId: cfg.apiId, apiHash: cfg.apiHash, botToken: cfg.botToken },
        accounts,
      }
      const salt = randBytes(16)
      const key = await deriveAesKey(password, salt)
      const data = await aesEncrypt(key, JSON.stringify(payload))
      return json({ ok: true, backup: { salt: b64encode(salt), data }, accounts: accounts.length })
    }

    if (path === '/api/restore' && method === 'POST') {
      const b = await readJson<any>(req)
      const password = String(b.password ?? '')
      try {
        const salt = b64ToBytes(String(b.backup?.salt ?? ''))
        const key = await deriveAesKey(password, salt)
        const plain = await aesDecrypt(key, String(b.backup?.data ?? ''))
        const payload = JSON.parse(plain)
        if (payload.app !== 'selfhub') return json({ ok: false, error: 'فایل بکاپ معتبر نیست' }, 400)
        const internal = await (await hub.fetch('https://hub/internal')).json<any>()
        if (!internal.cfg) {
          // نصب اولیه با اطلاعات بکاپ (بدون رمز ادمین — همان رمز فعلیِ لاگین لازم است)
          return json({ ok: false, error: 'ابتدا SelfHub را نصب کنید، سپس بازیابی کنید' }, 400)
        }
        const cfg = internal.cfg
        let restored = 0
        for (const a of payload.accounts ?? []) {
          const meta = a.meta
          const list = ((await (await hub.fetch('https://hub/accounts')).json<any>()).accounts ?? []) as any[]
          let acc = list.find(x => x.id === meta.id)
          if (!acc) {
            const res = await hub.fetch('https://hub/accounts', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ label: meta.label, type: meta.type, phone: meta.phone }),
            })
            acc = (await res.json<any>()).account
          }
          const stub = env.SELF.get(env.SELF.idFromName(acc.id))
          await stub.fetch('https://self/init', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accountId: acc.id, label: meta.label, type: meta.type, apiId: cfg.apiId, apiHash: cfg.apiHash, masterKey: cfg.secret }),
          })
          await stub.fetch('https://self/import', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session: a.session, config: a.config }),
          })
          restored++
        }
        return json({ ok: true, restored })
      } catch {
        return json({ ok: false, error: 'رمز بکاپ نادرست است یا فایل خراب است' }, 400)
      }
    }

    return json({ ok: false, error: 'مسیر ناشناخته' }, 404)
  },
}
