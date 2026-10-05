/* SelfHub — Durable Object هر اکانت سلف
 * چرخه حیات کلاینت mtcute، لاگین تعاملی از پنل، موتور امکانات، زمان‌بند و ابزارها.
 */

import { DurableObject } from 'cloudflare:workers'
import { TelegramClient } from '@mtcute/core/client.js'
import { MemoryStorage } from '@mtcute/core'
import type { Env } from './env'
import { makeTransport, WorkersCryptoProvider, WorkersPlatform } from './platform'
import {
  defaultConfig, handleNewMessage, handleMemberUpdate, runTick,
  type FeatureConfig, type RuntimeState, type Stats, type Level, type EngineHooks, type ScrapeMember,
} from './engine'
import { aesEncrypt, aesDecrypt, b64decode, json, nowSec, readJson, humanDelay, id } from './util'

interface InitInfo {
  accountId: string
  label: string
  type: 'user' | 'bot' | 'demo'
  apiId: number
  apiHash: string
  masterKey: string
}

interface LogBuf {
  level: Level
  msg: string
  ts: number
}

export class SelfDO extends DurableObject<Env> {
  private info: InitInfo | null = null
  private client: any = null
  private cfg: FeatureConfig = defaultConfig()
  private state: RuntimeState = this.freshState()
  private stats: Stats = this.freshStats()
  private started = false
  private aesKey: CryptoKey | null = null
  private waiters: { code?: (v: string) => void; password?: (v: string) => void } = {}
  private loginTimeout: any = null
  private loginBusy = false
  private logBuffer: LogBuf[] = []
  private persistDirty = false
  private eng: EngineHooks | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  private freshState(): RuntimeState {
    return {
      status: 'idle', me: null, lastError: null, floodWaitUntil: 0,
      seenPm: {}, lastOut: {}, afkNotified: {}, storyViewed: {}, welcomeSeen: {},
      lastScrape: null, massdm: null, joiner: null,
      health: { connectedSince: 0, disconnects: 0, lastExport: 0 },
      startedAt: Date.now(),
    }
  }

  private freshStats(): Stats {
    return { sent: 0, received: 0, replies: 0, forwarded: 0, deleted: 0, dms: 0, joins: 0, reactions: 0, storyViews: 0, reads: 0, floodWaits: 0, lastFloodWait: 0, lastActivity: 0 }
  }

  /* ---------------- storage ---------------- */
  private async loadAll(): Promise<void> {
    if (this.started) return
    this.started = true
    const [info, cfg, state, stats] = await Promise.all([
      this.ctx.storage.get('info'),
      this.ctx.storage.get<FeatureConfig>('cfg'),
      this.ctx.storage.get<RuntimeState>('state'),
      this.ctx.storage.get<Stats>('stats'),
    ])
    if (info) this.info = info as InitInfo
    if (cfg) this.cfg = this.mergeCfg(this.cfg, cfg as FeatureConfig)
    if (state) {
      const s = state as RuntimeState
      // state اجرای قبل از ری‌استارت: اگر متصل بود، دوباره وصل شو
      if (s.status === 'connected') s.status = 'connecting'
      this.state = { ...this.freshState(), ...s, massdm: s.massdm ?? null, joiner: s.joiner ?? null }
    }
    if (stats) this.stats = { ...this.freshStats(), ...(stats as Stats) }
    if (this.info) {
      await this.initAes()
      // اگر DO وسط لاگین ری‌استارت شده باشد (لاگین مرده است) — پیام مناسب بده
      if (this.state.status === 'connecting' && !this.loginBusy) {
        this.state.status = 'error'
        this.state.lastError = 'فرایند قبلی ناتمام ماند (اجرای پس‌زمینه قطع شد) — دوباره «اتصال» یا «ورود مجدد» را بزنید'
      }
    }
    this.buildEngine()
    await this.scheduleAlarm()
  }

  private mergeCfg(base: FeatureConfig, saved: any): FeatureConfig {
    const out: any = { ...base }
    for (const k of Object.keys(base)) {
      if (saved && typeof saved[k] === 'object' && saved[k] !== null && !Array.isArray(saved[k])) out[k] = { ...(base as any)[k], ...saved[k] }
      else if (saved && saved[k] !== undefined) out[k] = saved[k]
    }
    return out as FeatureConfig
  }

  private async initAes(): Promise<void> {
    if (!this.info) return
    const raw = b64decode(this.info.masterKey)
    this.aesKey = await crypto.subtle.importKey('raw', raw.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  }

  private async persist(force = false): Promise<void> {
    if (!force && !this.persistDirty) return
    this.persistDirty = false
    await Promise.all([
      this.ctx.storage.put('cfg', this.cfg),
      this.ctx.storage.put('state', this.state),
      this.ctx.storage.put('stats', this.stats),
    ])
  }

  /* ---------------- logging → Hub ---------------- */
  log(level: Level, msg: string): void {
    const entry = { level, msg, ts: Date.now() }
    this.logBuffer.push({ ...entry })
    if (this.logBuffer.length > 100) this.logBuffer.shift()
    this.pushLogs().catch(() => {})
  }

  private async pushLogs(): Promise<void> {
    if (!this.logBuffer.length || !this.info) return
    const batch = this.logBuffer
    this.logBuffer = []
    try {
      const hub = this.env.HUB.get(this.env.HUB.idFromName('global'))
      await hub.fetch('https://hub/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: this.info.accountId, label: this.info.label, entries: batch }),
      })
    } catch {
      /* هاب موقتاً در دسترس نیست — بی‌خیال */
    }
  }

  private async notify(title: string, body: string): Promise<void> {
    this.log('success', `${title} — ${body}`)
    if (!this.info) return
    try {
      const hub = this.env.HUB.get(this.env.HUB.idFromName('global'))
      await hub.fetch('https://hub/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: this.info.accountId, label: this.info.label, title, body, ts: Date.now() }),
      })
    } catch {}
  }

  /* ---------------- engine hooks ---------------- */
  private buildEngine(): void {
    this.eng = {
      client: () => this.clientOrDemo(),
      get meId() { return 0 },
      stats: this.stats,
      state: this.state,
      cfg: this.cfg,
      demo: this.info?.type === 'demo',
      log: (l, m) => this.log(l, m),
      notify: (t, b) => { this.notify(t, b).catch(() => {}) },
      persist: async () => { this.persistDirty = true; await this.persist() },
    }
    // client به‌صورت lazy تا بعد از لاگین مقدار بگیرد
    Object.defineProperty(this.eng, 'client', { get: () => this.clientOrDemo() })
  }

  private clientOrDemo(): any {
    if (this.info?.type === 'demo') return this.demoClient()
    if (!this.client) throw new Error('کلاینت متصل نیست')
    return this.client
  }

  private _demo: any = null
  private demoClient(): any {
    if (this._demo) return this._demo
    const self = this
    this._demo = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'getMe') {
            return async () => ({ id: 777000, displayName: 'اکانت نمایشی', username: 'demo_account', isBot: false })
          }
          if (prop === 'resolvePeer') return async () => ({ _: 'inputPeerSelf' })
          return async (..._args: any[]) => {
            self.log('info', `(نمایشی) فراخوانی ${String(prop)}`)
            return undefined
          }
        },
      },
    )
    return this._demo
  }

  /* ---------------- mtcute client ---------------- */
  private async makeClient(): Promise<any> {
    if (!this.info) throw new Error('اکانت مقداردهی نشده')
    return new TelegramClient({
      apiId: this.info.apiId,
      apiHash: this.info.apiHash,
      storage: new MemoryStorage(),
      transport: makeTransport(),
      crypto: new WorkersCryptoProvider(),
      platform: new WorkersPlatform(),
    })
  }

  private wireClient(client: any): void {
    client.onNewMessage.add((msg: any) => {
      this.runEngine(async () => handleNewMessage(this.eng!, msg)).catch(() => {})
    })
    client.onChatMemberUpdate.add((upd: any) => {
      this.runEngine(async () => handleMemberUpdate(this.eng!, upd)).catch(() => {})
    })
    // هشدار نشست جدید (امنیت)
    client.onRawUpdate.add((info: any) => {
      try {
        const u = info?.update
        if (u && u._ === 'updateNewSession') {
          this.notify('🔐 نشست جدید', 'یک نشست تازه به این اکانت وارد شده است! اگر خودت نیستی از بخش نشست‌ها خارجش کن.').catch(() => {})
        }
      } catch {}
    })
    client.onError?.add?.((e: any) => this.log('error', `خطای کلاینت: ${e?.errorMessage ?? e?.message ?? e}`))
  }

  private runEngine = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
      this.persistDirty = true
    } catch (e: any) {
      this.log('error', `موتور: ${e?.errorMessage ?? e?.message ?? String(e)}`)
    }
  }

  private waitInput(kind: 'code' | 'password', timeoutMs = 5 * 60_000): Promise<string> {
    return new Promise((resolve, reject) => {
      clearTimeout(this.loginTimeout)
      this.loginTimeout = setTimeout(() => {
        delete this.waiters[kind]
        reject(new Error('زمان انتظار به پایان رسید (۵ دقیقه)'))
      }, timeoutMs)
      this.waiters[kind] = (v: string) => {
        clearTimeout(this.loginTimeout)
        resolve(v)
      }
    })
  }

  private async startLogin(phone?: string, botToken?: string): Promise<Response> {
    await this.loadAll()
    if (!this.info) return json({ ok: false, error: 'ابتدا اکانت را از پنل اضافه کنید' }, 400)
    if (this.info.type === 'demo') {
      this.state.status = 'connected'
      this.state.me = { id: 777000, displayName: 'اکانت نمایشی', username: 'demo_account' }
      await this.persist(true)
      return json({ ok: true, status: 'connected' })
    }
    if (this.client) {
      try { await this.client.close() } catch {}
      this.client = null
    }
    this.state.status = 'connecting'
    this.state.lastError = null
    const client = await this.makeClient()
    this.client = client
    this.wireClient(client)

    this.loginBusy = true
    const runLogin = (async () => {
      const LOGIN_TIMEOUT = 3 * 60_000
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('اتصال به تلگرام در ۳ دقیقه برقرار نشد — اگر در حالت dev لوکال هستید، اتصال خروجی WebSocket پشتیبانی نمی‌شود؛ دپلوی کنید یا --remote بزنید')), LOGIN_TIMEOUT)
      })
      try {
        await Promise.race([
          (async () => {
            const params: any = {
              codeSentCallback: () => {
                this.state.status = 'awaiting_code'
                this.log('info', 'کد تأیید ارسال شد — از پنل وارد کنید')
                this.persist(true).catch(() => {})
              },
            }
            if (phone) {
              params.phone = phone
              params.code = async () => {
                this.state.status = 'awaiting_code'
                this.persist(true).catch(() => {})
                return await this.waitInput('code')
              }
              params.password = async () => {
                this.state.status = 'awaiting_password'
                this.log('info', 'این اکانت رمز دو مرحله‌ای دارد — از پنل وارد کنید')
                this.persist(true).catch(() => {})
                return await this.waitInput('password')
              }
              params.invalidCodeCallback = (t: string) => {
                this.log('warn', `${t === 'code' ? 'کد' : 'رمز'} نامعتبر بود، دوباره وارد کنید`)
                this.state.status = t === 'code' ? 'awaiting_code' : 'awaiting_password'
              }
            } else {
              params.botToken = botToken
            }
            const me = await client.start(params)
            this.state.status = 'connected'
            this.state.me = {
              id: me.id,
              displayName: me.displayName,
              username: me.username ?? undefined,
              isBot: !!me.isBot,
            }
            this.state.health.connectedSince = Date.now()
            await this.saveSession(client)
            this.log('success', `سلف متصل شد: ${me.displayName} (@${me.username ?? '—'})`)
            this.notify('✅ اکانت متصل شد', `${me.displayName} با موفقیت وارد شد`).catch(() => {})
            this.loginBusy = false
            await this.persist(true)
            await this.scheduleAlarm()
          })(),
          timeout,
        ])
      } catch (e: any) {
        // اگر این لاگین با لاگین جدیدتری جایگزین شده، وضعیت را دست نزن
        if (this.client === client) {
          this.state.status = 'error'
          this.state.lastError = String(e?.errorMessage ?? e?.message ?? e)
          this.log('error', `خطای لاگین: ${this.state.lastError}`)
          try { await client.close() } catch {}
          this.client = null
          this.loginBusy = false
          await this.persist(true)
        }
      }
    })()

    // پاسخ فوری به پنل؛ لاگین در پس‌زمینه ادامه دارد
    runLogin.catch(() => {})
    await new Promise(r => setTimeout(r, phone ? 1200 : 400))
    return json({ ok: true, status: this.state.status })
  }

  private async saveSession(client: any): Promise<void> {
    if (!this.aesKey) return
    try {
      const session = await client.exportSession()
      const enc = await aesEncrypt(this.aesKey, session)
      await this.ctx.storage.put('session', enc)
      this.state.health.lastExport = Date.now()
    } catch (e: any) {
      this.log('warn', `ذخیره نشست ناموفق: ${e?.message}`)
    }
  }

  private async reconnect(): Promise<void> {
    if (!this.info || this.info.type === 'demo') return
    const enc = await this.ctx.storage.get<string>('session')
    if (!enc) {
      this.state.status = 'idle'
      return
    }
    try {
      const session = await aesDecrypt(this.aesKey!, enc)
      const client = await this.makeClient()
      this.client = client
      this.wireClient(client)
      await client.importSession(session, true)
      await client.connect()
      const me = await client.getMe()
      this.state.status = 'connected'
      this.state.me = { id: me.id, displayName: me.displayName, username: me.username ?? undefined, isBot: !!me.isBot }
      this.state.health.connectedSince = Date.now()
      this.log('success', 'اتصال بازیابی شد')
    } catch (e: any) {
      this.state.status = 'error'
      this.state.lastError = String(e?.errorMessage ?? e?.message ?? e)
      this.state.health.disconnects++
      this.log('error', `بازیابی اتصال ناموفق: ${this.state.lastError}`)
    }
  }

  /* ---------------- alarm ---------------- */
  private async scheduleAlarm(): Promise<void> {
    const busy = !!(this.state.massdm?.active || this.state.joiner?.active)
    const connected = this.state.status === 'connected'
    const next = busy ? Date.now() + 15_000 : connected ? Date.now() + 45_000 : Date.now() + 5 * 60_000
    await this.ctx.storage.setAlarm(next)
  }

  async alarm(): Promise<void> {
    await this.loadAll()
    if (this.info?.type === 'demo') {
      await this.scheduleAlarm()
      return
    }
    // اگر لاگین تعاملی در جریان است، دخالت نکن
    if (this.loginBusy) {
      await this.scheduleAlarm()
      return
    }
    // بازیابی اتصال در صورت قطع شدن
    if (this.state.status === 'connected' && !this.client) {
      this.state.status = 'connecting'
      await this.reconnect()
    } else if (this.state.status === 'connecting') {
      await this.reconnect()
    }
    if (this.state.status === 'connected' && this.eng) {
      try {
        await runTick(this.eng)
      } catch (e: any) {
        this.log('error', `تیک موتور: ${e?.message ?? e}`)
      }
      // خروجی نشست هر ۱۰ دقیقه
      if (Date.now() - this.state.health.lastExport > 10 * 60_000 && this.client) {
        await this.saveSession(this.client)
      }
    }
    this.persistDirty = true
    await this.persist(true)
    await this.pushLogs()
    await this.scheduleAlarm()
  }

  /* ---------------- HTTP ---------------- */
  async fetch(req: Request): Promise<Response> {
    await this.loadAll()
    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method

    try {
      if (path === '/init' && method === 'POST') {
        const body = await readJson<Partial<InitInfo>>(req)
        if (!this.info) {
          this.info = {
            accountId: body.accountId ?? id('acc_'),
            label: body.label ?? 'سلف',
            type: body.type ?? 'user',
            apiId: body.apiId!,
            apiHash: body.apiHash!,
            masterKey: body.masterKey!,
          }
          await this.ctx.storage.put('info', this.info)
          await this.initAes()
          this.buildEngine()
        }
        return json({ ok: true })
      }

      if (path === '/login' && method === 'POST') {
        const b = await readJson<{ phone?: string; botToken?: string }>(req)
        return this.startLogin(b.phone, b.botToken)
      }

      if (path === '/code' && method === 'POST') {
        const b = await readJson<{ code: string }>(req)
        if (!this.waiters.code) return json({ ok: false, error: 'در انتظار کد نیستیم' }, 400)
        this.waiters.code(b.code ?? '')
        return json({ ok: true, status: this.state.status })
      }

      if (path === '/password' && method === 'POST') {
        const b = await readJson<{ password: string }>(req)
        if (!this.waiters.password) return json({ ok: false, error: 'در انتظار رمز نیستیم' }, 400)
        this.waiters.password(b.password ?? '')
        return json({ ok: true, status: this.state.status })
      }

      if (path === '/state' && method === 'GET') {
        return json({
          ok: true,
          status: this.state.status,
          me: this.state.me,
          lastError: this.state.lastError,
          floodWaitUntil: this.state.floodWaitUntil,
          stats: this.stats,
          massdm: this.state.massdm,
          joiner: this.state.joiner,
          lastScrape: this.state.lastScrape,
          health: this.state.health,
          type: this.info?.type,
          label: this.info?.label,
        })
      }

      if (path === '/config' && method === 'GET') {
        return json({ ok: true, config: this.cfg })
      }

      if (path === '/config' && method === 'PUT') {
        const b = await readJson<FeatureConfig>(req)
        this.cfg = this.mergeCfg(defaultConfig(), b)
        this.persistDirty = true
        await this.persist(true)
        this.log('info', 'تنظیمات امکانات ذخیره شد')
        return json({ ok: true, config: this.cfg })
      }

      if (path === '/stop' && method === 'POST') {
        if (this.client) {
          try { await this.client.close() } catch {}
          this.client = null
        }
        this.state.status = 'stopped'
        this.state.health.disconnects++
        await this.persist(true)
        this.log('warn', 'سلف متوقف شد')
        return json({ ok: true })
      }

      if (path === '/start' && method === 'POST') {
        if (this.state.status === 'stopped' || this.state.status === 'error') {
          this.state.status = 'connecting'
          await this.reconnect()
          await this.scheduleAlarm()
        }
        return json({ ok: true, status: this.state.status })
      }

      if (path === '/tool' && method === 'POST') {
        return await this.handleTool(await readJson<any>(req))
      }

      if (path === '/export' && method === 'GET') {
        const enc = (await this.ctx.storage.get<string>('session')) ?? null
        return json({ ok: true, session: enc, config: this.cfg, state: { me: this.state.me, stats: this.stats } })
      }

      if (path === '/import' && method === 'POST') {
        const b = await readJson<{ session?: string; config?: FeatureConfig }>(req)
        if (b.config) this.cfg = this.mergeCfg(defaultConfig(), b.config)
        if (b.session) await this.ctx.storage.put('session', b.session)
        this.persistDirty = true
        await this.persist(true)
        return json({ ok: true })
      }

      if (path === '/purge-data' && method === 'POST') {
        await this.ctx.storage.deleteAll()
        return json({ ok: true })
      }

      return json({ ok: false, error: 'مسیر ناشناخته' }, 404)
    } catch (e: any) {
      return json({ ok: false, error: String(e?.message ?? e) }, 500)
    }
  }

  /* ---------------- ابزارها ---------------- */
  private async handleTool(b: any): Promise<Response> {
    const eng = this.eng!
    const demo = this.info?.type === 'demo'
    const c = () => this.clientOrDemo()
    const guard = async (fn: () => Promise<any>) => {
      try {
        if (Date.now() < this.state.floodWaitUntil) return json({ ok: false, error: `محدودیت FloodWait تا ${new Date(this.state.floodWaitUntil).toLocaleTimeString('fa-IR')}` }, 429)
        return json({ ok: true, data: await fn() })
      } catch (e: any) {
        return json({ ok: false, error: String(e?.errorMessage ?? e?.message ?? e) }, 500)
      }
    }

    switch (b.action) {
      case 'send':
        return guard(async () => {
          const m = await c().sendText(b.chat, b.text)
          this.stats.sent++
          return { id: m?.id }
        })

      case 'getchat':
        return guard(async () => {
          const chat = await c().resolvePeer(b.chat)
          const full = await c().getChat(b.chat).catch(() => null)
          return { input: chat, chat: full ?? null }
        })

      case 'scrape':
        return guard(async () => {
          const limit = Math.min(b.limit ?? 200, 200)
          const members: ScrapeMember[] = []
          if (demo) {
            for (let i = 0; i < 10; i++) members.push({ id: 1000 + i, username: `demo_user_${i}`, name: `کاربر نمایشی ${i + 1}`, type: 'user' })
          } else {
            const res = await c().getChatMembers(b.chat, { limit, offset: 0 })
            for (const m of res) {
              const u = m.user
              if (!u) continue
              members.push({ id: u.id, username: u.username ?? null, name: u.displayName, type: u.isBot ? 'bot' : 'user' })
            }
          }
          this.state.lastScrape = { chat: String(b.chat), count: members.length, at: Date.now(), members }
          this.persistDirty = true
          const csv = ['id,username,name,type', ...members.map(m => `${m.id},${m.username ?? ''},"${m.name.replace(/"/g, '""')}",${m.type}`)].join('\n')
          return { count: members.length, members, csv }
        })

      case 'search':
        return guard(async () => {
          if (demo) return { results: [{ _: 'peer', title: 'کانال نمایشی', username: 'demo_channel', id: -1001234 }] }
          const r = await c().call({ _: 'contacts.search', q: String(b.query ?? ''), limit: 10 })
          const chats = (r.chats ?? []).map((ch: any) => ({ title: ch.title ?? ch.username, username: ch.username ?? null, id: ch.id }))
          const users = (r.users ?? []).map((u: any) => ({ title: u.firstName + ' ' + (u.lastName ?? ''), username: u.username ?? null, id: u.id }))
          return { results: [...chats, ...users] }
        })

      case 'massdm_start': {
        const targets: string[] = (b.targets ?? '')
          .split(/[\n,;]+/)
          .map((s: string) => s.trim().replace(/^@/, ''))
          .filter(Boolean)
        if (!targets.length) return json({ ok: false, error: 'هیچ هدفی وارد نشده' }, 400)
        this.state.massdm = {
          active: true,
          text: b.text ?? '',
          targets,
          idx: 0,
          sent: 0,
          errors: 0,
          dailySent: 0,
          dayStamp: new Date().toISOString().slice(0, 10),
          minDelayMs: Math.max(5, b.minDelaySec ?? 20) * 1000,
          maxDelayMs: Math.max(10, b.maxDelaySec ?? 45) * 1000,
          dailyCap: Math.min(b.dailyCap ?? 100, 1000),
          perTick: Math.min(b.perTick ?? 3, 10),
          lastError: null,
          skipped: [],
        }
        await this.persist(true)
        await this.scheduleAlarm()
        this.log('warn', `شروع پیام انبوه برای ${targets.length} هدف — سقف روزانه ${this.state.massdm.dailyCap}`)
        return json({ ok: true, job: this.state.massdm })
      }

      case 'massdm_stop':
        if (this.state.massdm) this.state.massdm.active = false
        await this.persist(true)
        return json({ ok: true, job: this.state.massdm })

      case 'joiner_start': {
        const links: string[] = (b.links ?? '')
          .split(/[\n,;\s]+/)
          .map((s: string) => s.trim())
          .filter(Boolean)
        if (!links.length) return json({ ok: false, error: 'لینکی وارد نشده' }, 400)
        this.state.joiner = {
          active: true,
          links,
          idx: 0,
          joined: 0,
          errors: 0,
          minDelayMs: Math.max(3, b.minDelaySec ?? 8) * 1000,
          maxDelayMs: Math.max(5, b.maxDelaySec ?? 20) * 1000,
          results: [],
        }
        await this.persist(true)
        await this.scheduleAlarm()
        return json({ ok: true, job: this.state.joiner })
      }

      case 'joiner_stop':
        if (this.state.joiner) this.state.joiner.active = false
        await this.persist(true)
        return json({ ok: true, job: this.state.joiner })

      case 'tagall':
        return guard(async () => {
          const chat = b.chat
          const text = b.text || '👋'
          const members = demo ? [] : await c().getChatMembers(chat, { limit: 200 })
          const list = members.filter((m: any) => m.user && !m.user.isBot)
          if (!demo) {
            for (let i = 0; i < list.length; i += 20) {
              const chunk = list.slice(i, i + 20)
              const entities: any[] = []
              let cursor = text.length + 1
              const parts = chunk.map((m: any) => {
                const label = `@${m.user.username ?? m.user.displayName ?? m.user.id}`
                entities.push({ _: 'messageEntityMentionName', offset: cursor, length: label.length, userId: m.user.id })
                cursor += label.length + 1
                return label
              })
              await c().sendText(chat, { text: `${text}\n${parts.join(' ')}`, entities })
              this.stats.sent++
              await humanDelay(2000, 4000)
            }
          } else {
            this.log('success', '(نمایشی) تگ‌آل انجام شد')
          }
          return { mentioned: list.length }
        })

      case 'purge':
        return guard(async () => {
          const chat = b.chat
          const count = Math.min(b.count ?? 100, 5000)
          const onlyMine = b.scope !== 'all'
          const mediaType = b.mediaType ?? null
          let ids: number[] = []
          if (!demo) {
            let offset = 0
            while (ids.length < count && offset < count * 2) {
              const hist = await c().getHistory(chat, { limit: 100, offset })
              if (!hist.length) break
              for (const m of hist) {
                if (ids.length >= count) break
                if (onlyMine && m.sender?.id !== this.state.me?.id) continue
                if (mediaType && m.media?.type !== mediaType) continue
                ids.push(m.id)
              }
              offset += 100
              if (hist.length < 100) break
            }
            if (ids.length) await c().deleteMessagesById(chat, ids, { revoke: true })
          }
          this.stats.deleted += ids.length
          this.log('warn', `پاک‌سازی ${ids.length} پیام از «${chat}»`)
          return { deleted: ids.length }
        })

      case 'forward_now':
        return guard(async () => {
          const limit = Math.min(b.limit ?? 10, 100)
          if (demo) return { forwarded: limit }
          const hist = await c().getHistory(b.from, { limit })
          const msgs = hist.reverse()
          await c().forwardMessages({ fromChat: b.from, messages: msgs, toChatId: b.to })
          this.stats.forwarded += msgs.length
          return { forwarded: msgs.length }
        })

      case 'sessions_list':
        return guard(async () => {
          if (demo) {
            return {
              sessions: [
                { hash: 'demo1', device: 'SelfHub (نمایشی)', country: 'IR', ip: '1.2.3.4', current: true, dateActive: new Date().toISOString() },
                { hash: 'demo2', device: 'Android', country: 'DE', ip: '5.6.7.8', current: false, dateActive: new Date().toISOString() },
              ],
            }
          }
          const r = await c().call({ _: 'account.getAuthorizations' })
          return {
            sessions: (r.authorizations ?? []).map((a: any) => ({
              hash: String(a.hash),
              device: `${a.deviceModel ?? ''} — ${a.platform ?? ''} ${a.systemVersion ?? ''} (${a.appName ?? '?'})`,
              country: a.country ?? '',
              ip: a.ip ?? '',
              current: !!a.current,
              dateActive: new Date((a.dateActive ?? 0) * 1000).toLocaleString('fa-IR'),
            })),
          }
        })

      case 'sessions_terminate':
        return guard(async () => {
          if (!demo) await c().call({ _: 'account.resetAuthorization', hash: Number(b.hash) })
          this.log('warn', 'یک نشست دیگر خاتمه داده شد')
          return { ok: true }
        })

      case 'sessions_terminate_others':
        return guard(async () => {
          if (!demo) await c().call({ _: 'account.resetAuthorizations' })
          this.notify('🔐 نشست‌ها', 'تمام نشست‌های دیگر از این اکانت خارج شدند').catch(() => {})
          return { ok: true }
        })

      case 'leave':
        return guard(async () => {
          if (!demo) await c().leaveChat(b.chat)
          return { ok: true }
        })

      case 'read_all':
        return guard(async () => {
          if (!demo) await c().readHistory(b.chat, {})
          this.stats.reads++
          return { ok: true }
        })

      case 'test':
        return guard(async () => {
          const t0 = Date.now()
          if (!demo) await c().resolvePeer('me')
          return { pongMs: Date.now() - t0, status: this.state.status }
        })

      default:
        return json({ ok: false, error: `ابزار ناشناخته: ${b.action}` }, 400)
    }
  }
}
