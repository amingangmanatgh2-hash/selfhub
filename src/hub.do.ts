/* SelfHub — Durable Object مرکزی
 * پیکربندی نصب (API creds + هش رمز ادمین + کلیدها)، رجیستری اکانت‌ها، لاگ‌ها، اعلان‌ها و استریم زنده.
 */

import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env'
import { pbkdf2Hash, pbkdf2Verify, randBytes, b64encode, json, nowSec, readJson, id, passwordStrength, isValidApiHash, isValidBotToken } from './util'

export interface AccountMeta {
  id: string
  label: string
  type: 'user' | 'bot' | 'demo'
  phone?: string
  createdAt: number
}

interface AppConfig {
  apiId: number
  apiHash: string
  botToken: string
  adminSalt: string
  adminHash: string
  adminIter: number
  secret: string // امضای کوکی + کلید اصلی رمزنگاری نشست‌ها
  createdAt: number
}

interface LogEntry {
  ts: number
  accountId: string | null
  label: string | null
  level: string
  msg: string
}

export class HubDO extends DurableObject<Env> {
  private cfg: AppConfig | null = null
  private logs: LogEntry[] = []
  private notifications: { ts: number; title: string; body: string; accountId: string | null }[] = []
  private failCount = 0
  private lockUntil = 0
  private sseWriters: { write: (s: string) => Promise<void>; close: () => void }[] = []
  // نشست کوتاه‌مدت احراز هویت my.telegram.org فقط برای راه‌اندازی اولیه
  private mytg: { phone: string; randomHash: string; cookies: string; expires: number } | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.ctx.storage.get<AppConfig>('config').then(c => {
      if (c) this.cfg = c
    })
    this.ctx.storage.get<LogEntry[]>('logs').then(l => {
      if (Array.isArray(l)) this.logs = l
    })
    this.ctx.storage.get<typeof this.notifications>('notifications').then(n => {
      if (Array.isArray(n)) this.notifications = n
    })
  }

  private addLog(entry: LogEntry): void {
    this.logs.push(entry)
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500)
    const line = `data: ${JSON.stringify(entry)}\n\n`
    for (const w of this.sseWriters) w.write(line).catch(() => {})
    // ذخیره‌ی دوره‌ای
    if (this.logs.length % 25 === 0) this.ctx.storage.put('logs', this.logs).catch(() => {})
  }

  private addNotification(n: { title: string; body: string; accountId: string | null }): void {
    this.notifications.unshift({ ...n, ts: Date.now() })
    if (this.notifications.length > 100) this.notifications.length = 100
    this.ctx.storage.put('notifications', this.notifications).catch(() => {})
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method

    /* ---------- نصب اولیه ---------- */
    if (path === '/setup' && method === 'POST') {
      if (this.cfg) return json({ ok: false, error: 'نصب قبلاً انجام شده' }, 400)
      const b = await readJson<any>(req)
      const apiId = Number(b.apiId)
      const apiHash = String(b.apiHash ?? '').trim()
      const botToken = String(b.botToken ?? '').trim()
      const adminPassword = String(b.adminPassword ?? '')
      if (!Number.isInteger(apiId) || apiId <= 0) return json({ ok: false, error: 'API ID نامعتبر است (عدد صحیح از my.telegram.org)' }, 400)
      if (!isValidApiHash(apiHash)) return json({ ok: false, error: 'API Hash نامعتبر است (۳۲ نویسه هگز)' }, 400)
      if (botToken && !isValidBotToken(botToken)) return json({ ok: false, error: 'قالب Bot Token نامعتبر است (می‌توانید خالی بگذارید — نیازی به ربات نیست)' }, 400)
      const pw = passwordStrength(adminPassword)
      if (!pw.ok) return json({ ok: false, error: pw.message! }, 400)
      const hash = await pbkdf2Hash(adminPassword)
      this.cfg = {
        apiId,
        apiHash,
        botToken,
        adminSalt: hash.salt,
        adminHash: hash.hash,
        adminIter: hash.iter,
        secret: b64encode(randBytes(32)),
        createdAt: Date.now(),
      }
      await this.ctx.storage.put('config', this.cfg)
      this.addLog({ ts: Date.now(), accountId: null, label: null, level: 'success', msg: 'نصب SelfHub کامل شد — خوش آمدید!' })
      return json({ ok: true })
    }

    /* ---------- دریافت خودکار API ID/Hash از my.telegram.org ---------- */
    if (path === '/mytg/start' && method === 'POST') {
      if (this.cfg) return json({ ok: false, error: 'نصب قبلاً انجام شده است' }, 400)
      const b = await readJson<any>(req)
      const phone = String(b.phone ?? '').trim()
      if (!/^\+?[1-9]\d{6,14}$/.test(phone)) return json({ ok: false, error: 'شماره را با کد کشور وارد کنید؛ مثل +989123456789' }, 400)
      try {
        const r = await fetch('https://my.telegram.org/auth/send_password', {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'SelfHub/1.0' },
          body: new URLSearchParams({ phone_number: phone }).toString(),
        })
        const text = await r.text()
        if (!r.ok) return json({ ok: false, error: 'my.telegram.org کد ارسال نکرد؛ شماره و دسترسی اینترنت را بررسی کنید' }, 502)
        let data: any = null; try { data = JSON.parse(text) } catch {}
        const randomHash = String(data?.random_hash ?? '')
        if (!randomHash) return json({ ok: false, error: 'پاسخ my.telegram.org نامعتبر بود؛ کمی بعد دوباره تلاش کنید' }, 502)
        const cookies = r.headers.get('set-cookie') ?? ''
        this.mytg = { phone, randomHash, cookies, expires: Date.now() + 10 * 60_000 }
        return json({ ok: true, message: 'کد به تلگرام شما ارسال شد' })
      } catch { return json({ ok: false, error: 'ارتباط با my.telegram.org برقرار نشد' }, 502) }
    }

    if (path === '/mytg/verify' && method === 'POST') {
      if (this.cfg) return json({ ok: false, error: 'نصب قبلاً انجام شده است' }, 400)
      const b = await readJson<any>(req)
      const code = String(b.code ?? '').trim()
      if (!this.mytg || this.mytg.expires < Date.now()) return json({ ok: false, error: 'نشست منقضی شد؛ دوباره شماره را ثبت کنید' }, 400)
      if (!/^\d{3,8}$/.test(code)) return json({ ok: false, error: 'کد تلگرام نامعتبر است' }, 400)
      try {
        const headers: Record<string,string> = { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'SelfHub/1.0' }
        if (this.mytg.cookies) headers.cookie = this.mytg.cookies
        const r = await fetch('https://my.telegram.org/auth/login', { method: 'POST', headers, body: new URLSearchParams({ phone_number: this.mytg.phone, random_hash: this.mytg.randomHash, password: code }).toString() })
        const loginText = await r.text()
        if (!r.ok || /error|invalid|wrong/i.test(loginText)) return json({ ok: false, error: 'کد اشتباه است یا منقضی شده؛ کد جدید بگیرید' }, 401)
        const cookie = [this.mytg.cookies, r.headers.get('set-cookie') ?? ''].filter(Boolean).join('; ')
        const apps = await fetch('https://my.telegram.org/apps', { headers: { cookie, 'user-agent': 'SelfHub/1.0' } })
        const html = await apps.text()
        const idMatch = html.match(/name=["']?app_id["']?[^>]*value=["']?(\d+)/i) || html.match(/app_id[^\d]{0,20}(\d+)/i)
        const hashMatch = html.match(/name=["']?app_hash["']?[^>]*value=["']?([a-f0-9]{32})/i) || html.match(/app_hash[^a-f0-9]{0,20}([a-f0-9]{32})/i)
        if (idMatch && hashMatch) { this.mytg = null; return json({ ok: true, apiId: Number(idMatch[1]), apiHash: hashMatch[1], existing: true }) }
        // حساب تازه معمولاً صفحه ساخت اپ را برمی‌گرداند؛ ساخت خودکار بدون ربات
        const short = 'selfhub' + Math.random().toString(36).slice(2, 8)
        const cr = await fetch('https://my.telegram.org/apps/create', { method: 'POST', headers: { ...headers, cookie }, body: new URLSearchParams({ app_title: 'SelfHub', app_shortname: short, app_url: 'https://selfhub.local', app_platform: 'Other', app_desc: 'Personal Telegram automation panel' }).toString() })
        if (!cr.ok) return json({ ok: false, error: 'ورود انجام شد اما ساخت API در my.telegram.org رد شد؛ از API development tools بسازید' }, 502)
        const html2 = await (await fetch('https://my.telegram.org/apps', { headers: { cookie, 'user-agent': 'SelfHub/1.0' } })).text()
        const id2 = html2.match(/name=["']?app_id["']?[^>]*value=["']?(\d+)/i) || html2.match(/app_id[^\d]{0,20}(\d+)/i)
        const hash2 = html2.match(/name=["']?app_hash["']?[^>]*value=["']?([a-f0-9]{32})/i) || html2.match(/app_hash[^a-f0-9]{0,20}([a-f0-9]{32})/i)
        this.mytg = null
        if (!id2 || !hash2) return json({ ok: false, error: 'اپ ساخته شد اما دریافت API ID/Hash ممکن نشد؛ آن‌ها را از صفحه Apps کپی کنید' }, 502)
        return json({ ok: true, apiId: Number(id2[1]), apiHash: hash2[1], created: true })
      } catch { return json({ ok: false, error: 'خطا در ارتباط با my.telegram.org؛ می‌توانید API را دستی وارد کنید' }, 502) }
    }

    /* ---------- ورود با رمز ---------- */
    if (path === '/verify' && method === 'POST') {
      if (!this.cfg) return json({ ok: false, error: 'نصب انجام نشده' }, 400)
      if (Date.now() < this.lockUntil) {
        const remain = Math.ceil((this.lockUntil - Date.now()) / 1000)
        return json({ ok: false, error: `به دلیل تلاش‌های ناموفق، ${remain} ثانیه صبر کنید` }, 429)
      }
      const b = await readJson<{ password?: string }>(req)
      const ok = await pbkdf2Verify(String(b.password ?? ''), this.cfg.adminSalt, this.cfg.adminHash, this.cfg.adminIter)
      if (!ok) {
        this.failCount++
        if (this.failCount >= 5) {
          this.lockUntil = Date.now() + 5 * 60_000
          this.failCount = 0
          this.addLog({ ts: Date.now(), accountId: null, label: null, level: 'error', msg: '🚨 ۵ تلاش ناموفق ورود! پنل تا ۵ دقیقه قفل شد' })
        }
        return json({ ok: false, error: 'رمز عبور نادرست است' }, 401)
      }
      this.failCount = 0
      return json({ ok: true })
    }

    /* ---------- تغییر رمز ---------- */
    if (path === '/change-password' && method === 'POST') {
      if (!this.cfg) return json({ ok: false, error: 'نصب انجام نشده' }, 400)
      const b = await readJson<any>(req)
      const ok = await pbkdf2Verify(String(b.current ?? ''), this.cfg.adminSalt, this.cfg.adminHash, this.cfg.adminIter)
      if (!ok) return json({ ok: false, error: 'رمز فعلی نادرست است' }, 401)
      const pw = passwordStrength(String(b.next ?? ''))
      if (!pw.ok) return json({ ok: false, error: pw.message! }, 400)
      const hash = await pbkdf2Hash(String(b.next))
      this.cfg.adminSalt = hash.salt
      this.cfg.adminHash = hash.hash
      this.cfg.adminIter = hash.iter
      await this.ctx.storage.put('config', this.cfg)
      this.addLog({ ts: Date.now(), accountId: null, label: null, level: 'warn', msg: 'رمز عبور ادمین تغییر کرد' })
      return json({ ok: true })
    }

    /* ---------- وضعیت عمومی ---------- */
    if (path === '/config' && method === 'GET') {
      if (!this.cfg) return json({ ok: true, installed: false })
      return json({
        ok: true,
        installed: true,
        apiId: this.cfg.apiId,
        apiHash: this.cfg.apiHash,
        botToken: this.cfg.botToken,
        createdAt: this.cfg.createdAt,
      })
    }

    /* برای Worker: خروجی کامل شامل secret — فقط داخلی */
    if (path === '/internal' && method === 'GET') {
      return json({ ok: true, cfg: this.cfg })
    }

    /* ---------- اکانت‌ها ---------- */
    if (path === '/accounts' && method === 'GET') {
      const accounts = (await this.ctx.storage.get<AccountMeta[]>('accounts')) ?? []
      return json({ ok: true, accounts })
    }

    if (path === '/accounts' && method === 'POST') {
      const b = await readJson<any>(req)
      const accounts = (await this.ctx.storage.get<AccountMeta[]>('accounts')) ?? []
      const meta: AccountMeta = {
        id: id('acc_'),
        label: String(b.label ?? 'سلف جدید').slice(0, 40),
        type: b.type === 'bot' ? 'bot' : b.type === 'demo' ? 'demo' : 'user',
        phone: b.phone ? String(b.phone) : undefined,
        createdAt: Date.now(),
      }
      accounts.push(meta)
      await this.ctx.storage.put('accounts', accounts)
      this.addLog({ ts: Date.now(), accountId: meta.id, label: meta.label, level: 'info', msg: `اکانت «${meta.label}» اضافه شد` })
      return json({ ok: true, account: meta })
    }

    if (path === '/accounts' && method === 'PUT') {
      const b = await readJson<{ id: string; label?: string }>(req)
      const accounts = (await this.ctx.storage.get<AccountMeta[]>('accounts')) ?? []
      const acc = accounts.find(a => a.id === b.id)
      if (acc && b.label) acc.label = String(b.label).slice(0, 40)
      await this.ctx.storage.put('accounts', accounts)
      return json({ ok: true })
    }

    if (path === '/accounts' && method === 'DELETE') {
      const idParam = url.searchParams.get('id') ?? ''
      let accounts = (await this.ctx.storage.get<AccountMeta[]>('accounts')) ?? []
      const acc = accounts.find(a => a.id === idParam)
      accounts = accounts.filter(a => a.id !== idParam)
      await this.ctx.storage.put('accounts', accounts)
      if (acc) this.addLog({ ts: Date.now(), accountId: idParam, label: acc.label, level: 'warn', msg: `اکانت «${acc.label}» حذف شد` })
      return json({ ok: true })
    }

    /* ---------- لاگ‌ها / اعلان‌ها ---------- */
    if (path === '/log' && method === 'POST') {
      const b = await readJson<any>(req)
      for (const e of b.entries ?? []) {
        this.addLog({ ts: e.ts ?? Date.now(), accountId: b.accountId ?? null, label: b.label ?? null, level: e.level ?? 'info', msg: String(e.msg ?? '') })
      }
      return json({ ok: true })
    }

    if (path === '/notify' && method === 'POST') {
      const b = await readJson<any>(req)
      this.addNotification({ title: String(b.title ?? ''), body: String(b.body ?? ''), accountId: b.accountId ?? null })
      return json({ ok: true })
    }

    if (path === '/notifications' && method === 'GET') {
      return json({ ok: true, notifications: this.notifications })
    }

    if (path === '/logs' && method === 'GET') {
      const since = Number(url.searchParams.get('since') ?? 0)
      return json({ ok: true, logs: this.logs.filter(l => l.ts > since) })
    }

    /* استریم زنده رویدادها (SSE) */
    if (path === '/stream') {
      const { readable, writable } = new TransformStream()
      const writer = writable.getWriter()
      const enc = new TextEncoder()
      const handle = {
        write: async (s: string) => {
          await writer.write(enc.encode(s))
        },
        close: () => {
          const i = this.sseWriters.indexOf(handle)
          if (i >= 0) this.sseWriters.splice(i, 1)
          try {
            writer.close()
          } catch {}
        },
      }
      this.sseWriters.push(handle)
      // ارسال آخرین لاگ‌ها بلافاصله
      for (const l of this.logs.slice(-30)) handle.write(`data: ${JSON.stringify(l)}\n\n`).catch(() => {})
      req.signal.addEventListener('abort', () => handle.close())
      return new Response(readable, {
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'connection': 'keep-alive' },
      })
    }

    if (path === '/master-key' && method === 'GET') {
      // فقط از طریق Worker داخلی صدا زده می‌شود (DOs قابل آدرس‌دهی عمومی نیستند)
      return json({ ok: true, secret: this.cfg?.secret ?? null })
    }

    return json({ ok: false, error: 'مسیر ناشناخته' }, 404)
  }
}
