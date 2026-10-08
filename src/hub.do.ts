/* SelfHub — Durable Object مرکزی (قلب ربات)
 * دو کار: ۱) انبار داده روی SQLite داخل DO ۲) اجرای موتور روی updateها و cron.
 * هیچ اتصال دائمی لازم نیست: webhook برای رویدادها، cron برای زمان‌بند.
 */

import { DurableObject } from 'cloudflare:workers'
import { TelegramBot } from './bot.ts'
import { doBroadcast, processUpdate, runDueJobs } from './engine.ts'
import type { HubCtx, StatField } from './engine.ts'
import { COMMANDS } from './engine.ts'
import { prune } from './logic/flood.ts'
import { defaultGlobal, defaultSettings, mergeGlobal, mergeSettings } from './logic/settings.ts'
import { csv, growth, hourlySeries, series, totals } from './logic/stats.ts'
import { parseWhen } from './logic/schedule.ts'
import { decide } from './logic/rules.ts'
import type { HistoryEntry } from './logic/rules.ts'
import type {
  ChatSettings,
  GlobalSettings,
  KeywordRule,
  ModlogRow,
  Note,
  ScheduledJob,
  TgUpdate,
  WarnRow,
} from './types.ts'
import { dayKey, hourKey, json, err, nowSec, readJson, randHex, aesKeyFromBytes, aesEncrypt, aesDecrypt, pbkdf2Hash, pbkdf2Verify, passwordStrength, timingSafeB64Equal, clamp, toInt, delay, sha256Hex } from './util.ts'
import { truncate } from './tgfmt.ts'

export interface Env {
  HUB: DurableObjectNamespace<HubDO>
  /** کلید اصلی؛ اگر ست نشود خودش یک کلید تصادفی می‌سازد و ذخیره می‌کند */
  SECRET?: string
  /** نصب بی‌سر و صدا (بدون پنل) */
  BOT_TOKEN?: string
  ADMIN_PASSWORD?: string
  /** فقط برای دیباگ محلی: '1' بگذارید تا /api/simulate و /internal/simulate باز شوند */
  SIMULATE?: string
}

const VERSION = '2.0.0'
const STAT_FIELDS: StatField[] = ['msgs', 'members', 'deleted', 'warns', 'mutes', 'bans', 'replies', 'commands']

type Row = Record<string, string | number | null>

const SCHEMA = `
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT 'supergroup',
  settings TEXT NOT NULL DEFAULT '{}', members INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL DEFAULT 0,
  pattern TEXT NOT NULL, reply TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'contains',
  enabled INTEGER NOT NULL DEFAULT 1, hits INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notes (
  chat_id INTEGER NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL,
  created_by INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, name)
);
CREATE TABLE IF NOT EXISTS warns (
  chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL, points INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
);
CREATE TABLE IF NOT EXISTS modlog (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, action TEXT NOT NULL,
  target_id INTEGER, target_name TEXT NOT NULL DEFAULT '', moderator TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, text TEXT NOT NULL,
  at INTEGER NOT NULL, every_min INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL DEFAULT 0,
  last_sent INTEGER NOT NULL DEFAULT 0, sent_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stats_day (
  chat_id INTEGER NOT NULL DEFAULT 0, day TEXT NOT NULL,
  msgs INTEGER NOT NULL DEFAULT 0, members INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
  warns INTEGER NOT NULL DEFAULT 0, mutes INTEGER NOT NULL DEFAULT 0, bans INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0, commands INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, day)
);
CREATE TABLE IF NOT EXISTS stats_hour (
  chat_id INTEGER NOT NULL DEFAULT 0, hour INTEGER NOT NULL, msgs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, hour)
);
CREATE TABLE IF NOT EXISTS verify (
  chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL, msg_id INTEGER NOT NULL, exp INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, level TEXT NOT NULL, msg TEXT NOT NULL, chat_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
CREATE INDEX IF NOT EXISTS idx_modlog_chat ON modlog (chat_id, ts);
CREATE INDEX IF NOT EXISTS idx_schedule_at ON schedule (at);
`

interface LogLine {
  id: number
  ts: number
  level: string
  msg: string
  chatId: number | null
}

export class HubDO extends DurableObject<Env> {
  private ready: Promise<void> | null = null
  private cfgCache: Map<string, string> | null = null
  private aesKey: CryptoKey | null = null
  private _bot: TelegramBot | null = null
  private _botId = 0
  private _global: GlobalSettings | null = null
  private chatCache = new Map<number, { at: number; v: ChatSettings }>()
  private adminCache = new Map<string, { status: string; exp: number }>()
  private hist = new Map<string, HistoryEntry>()
  /** update_idهای اخیر؛ تلگرام در retry ممکن است id کوچک‌تر را بعدی بفرستد، پس فقط «بزرگ‌ترین» کافی نیست */
  private seen = new Set<number>()
  private seenOrder: number[] = []
  private lastId = 0
  /** صف سریال: ترتیب برای پنجرهٔ فلود، نردبان اخطار و modlog مهم است */
  private queue: Promise<unknown> = Promise.resolve()
  private sse: { write: (s: string) => Promise<void>; close: () => void }[] = []
  private logs: LogLine[] = []
  private logsDirty = false

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    // محدودیت CPU Workers: کارهای سنگین را در batch انجام بده و بعد بیدار شو
    this.ctx.blockConcurrencyWhile(async () => {
      await this.boot()
    })
  }

  /* ---------------- راه‌اندازی ---------------- */

  private async boot(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        this.ctx.storage.sql.exec(SCHEMA)
        await this.loadCfg()
        await this.loadLogs()
        if (this.env.BOT_TOKEN && this.env.ADMIN_PASSWORD && !this.cfg('installed')) {
          const r = await this.install(this.env.BOT_TOKEN, this.env.ADMIN_PASSWORD)
          if (!r.ok) console.error(`[selfhub] نصب خودکار از متغیرهای محیطی نشد: ${r.error}`)
        }
      })()
    }
    await this.ready
  }

  private async loadCfg(): Promise<void> {
    const rows = this.ctx.storage.sql.exec<Row>('SELECT key, value FROM config')
    const map = new Map<string, string>()
    for (const r of rows.toArray()) map.set(String(r.key), String(r.value))
    this.cfgCache = map
  }

  private async loadLogs(): Promise<void> {
    const rows = this.ctx.storage.sql.exec<Row>('SELECT id, ts, level, msg, chat_id FROM events ORDER BY id DESC LIMIT 200')
    this.logs = rows
      .toArray()
      .reverse()
      .map(r => ({ id: Number(r.id), ts: Number(r.ts), level: String(r.level), msg: String(r.msg), chatId: r.chat_id === null ? null : Number(r.chat_id) }))
  }

  private cfg(key: string): string | null {
    return this.cfgCache?.get(key) ?? null
  }

  private async cfgSet(key: string, value: string | null): Promise<void> {
    this.cfgCache ??= new Map()
    if (value === null) {
      this.cfgCache.delete(key)
      this.ctx.storage.sql.exec('DELETE FROM config WHERE key = ?', key)
      return
    }
    this.cfgCache.set(key, value)
    this.ctx.storage.sql.exec('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
  }

  private async global(): Promise<GlobalSettings> {
    if (this._global) return this._global
    const raw = this.cfg('global')
    this._global = raw ? mergeGlobal(defaultGlobal(), JSON.parse(raw)) : defaultGlobal()
    return this._global
  }

  private async saveGlobal(patch: unknown): Promise<GlobalSettings> {
    this._global = mergeGlobal(await this.global(), patch)
    await this.cfgSet('global', JSON.stringify(this._global))
    return this._global
  }

  /* ---------------- رمزنگاری ---------------- */

  /** بذر کلید: یا از Secret محیط، یا یک مقدار تصادفی که در DO ذخیره می‌شود */
  private async seed(): Promise<string> {
    const fromEnv = this.env.SECRET?.trim()
    if (fromEnv) return fromEnv
    let stored = this.cfg('enc_seed')
    if (!stored) {
      stored = randHex(48)
      await this.cfgSet('enc_seed', stored)
    }
    return stored
  }

  private async key(): Promise<CryptoKey> {
    if (this.aesKey) return this.aesKey
    const digest = await sha256Hex(`enc:${await this.seed()}`)
    const bytes = new Uint8Array(32)
    for (let i = 0; i < 32; i++) bytes[i] = Number.parseInt(digest.slice(i * 2, i * 2 + 2), 16)
    this.aesKey = await aesKeyFromBytes(bytes)
    return this.aesKey
  }

  /** کلید امضای کوکی پنل — مستقل از بذر رمزنگاری، پایدار در سراسر تخلیه‌ها */
  async signingSecret(): Promise<string> {
    let s = this.cfg('cookie_secret')
    if (!s) {
      s = randHex(32)
      await this.cfgSet('cookie_secret', s)
    }
    return s
  }

  private async setToken(token: string): Promise<void> {
    const k = await this.key()
    await this.cfgSet('token_enc', await aesEncrypt(k, token))
    this._bot = null
    this._botId = 0
  }

  private async token(): Promise<string | null> {
    const enc = this.cfg('token_enc')
    if (!enc) return null
    try {
      return await aesDecrypt(await this.key(), enc)
    } catch {
      this.log('error', 'رمزگشایی توکن ناموفق — SECRET تغییر کرده است؟ دوباره توکن را در پنل ذخیره کنید.')
      return null
    }
  }

  private async bot(): Promise<TelegramBot> {
    if (this._bot) return this._bot
    const token = await this.token()
    if (!token) throw new Error('توکن ربات تنظیم نشده است')
    this._bot = new TelegramBot(token)
    return this._bot
  }

  /* ---------------- نصب و ورود ---------------- */

  private async install(botToken: string, adminPassword: string): Promise<{ ok: boolean; error?: string }> {
    if (this.cfg('installed')) return { ok: false, error: 'نصب انجام شده است' }
    if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(botToken)) return { ok: false, error: 'قالب Bot Token نامعتبر است (از @BotFather)' }
    const pw = passwordStrength(adminPassword)
    if (!pw.ok) return { ok: false, error: pw.message ?? 'رمز ضعیف است' }
    const hash = await pbkdf2Hash(adminPassword)
    await this.setToken(botToken)
    await this.cfgSet('admin_salt', hash.salt)
    await this.cfgSet('admin_hash', hash.hash)
    await this.cfgSet('admin_iter', String(hash.iter))
    await this.cfgSet('webhook_secret', randHex(24))
    await this.cfgSet('installed', '1')
    await this.cfgSet('installed_at', String(Date.now()))
    await this.syncWebhook()
    return { ok: true }
  }

  private async syncWebhook(): Promise<string | null> {
    const url = this.cfg('panel_url')
    if (!url) return null
    try {
      const secret = this.cfg('webhook_secret') ?? randHex(24)
      if (!this.cfg('webhook_secret')) await this.cfgSet('webhook_secret', secret)
      await (await this.bot()).setWebhook(`${url.replace(/\/$/, '')}/webhook/${secret}`, secret)
      await this.cfgSet('webhook_url', `${url.replace(/\/$/, '')}/webhook/${secret}`)
      return null
    } catch (e) {
      const msg = String((e as Error).message).slice(0, 200)
      await this.cfgSet('last_error', msg)
      return msg
    }
  }

  private async verifyPassword(pw: string): Promise<boolean> {
    const salt = this.cfg('admin_salt')
    const hash = this.cfg('admin_hash')
    const iter = toInt(this.cfg('admin_iter'), 210_000)
    if (!salt || !hash) return false
    return pbkdf2Verify(pw, salt, hash, iter)
  }

  /** قفل ورود پایدار در SQLite (برخلاف v1 که در حافظه بود و با هر تخلیه ریست می‌شد) */
  private async loginGuard(ok: boolean): Promise<{ allowed: boolean; retryIn?: number }> {
    const row = this.ctx.storage.sql.exec<Row>('SELECT value FROM config WHERE key = ?', 'login_guard').toArray()[0]
    const st = row ? JSON.parse(String(row.value)) : { fails: 0, lockUntil: 0 }
    if (Date.now() < Number(st.lockUntil ?? 0)) return { allowed: false, retryIn: Math.ceil((Number(st.lockUntil) - Date.now()) / 1000) }
    if (ok) {
      if (Number(st.fails) > 0) await this.cfgSet('login_guard', null)
      return { allowed: true }
    }
    const fails = Number(st.fails ?? 0) + 1
    const lock = fails >= 5 ? Date.now() + 15 * 60_000 : 0
    await this.cfgSet('login_guard', JSON.stringify({ fails: lock ? 0 : fails, lockUntil: lock }))
    if (lock) this.log('error', '🚨 ۵ تلاش ناموفق ورود به پنل — ۱۵ دقیقه قفل شد')
    return { allowed: true }
  }

  /* ---------------- داده‌ی چت ---------------- */

  private async ensureChat(chat: { id: number; title?: string; type?: string }): Promise<ChatSettings> {
    const title = String(chat.title ?? '').slice(0, 80)
    this.ctx.storage.sql.exec(
      `INSERT INTO chats (id, title, type, created_at, updated_at, last_seen, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, type = excluded.type, last_seen = excluded.last_seen, updated_at = excluded.updated_at, active = 1`,
      chat.id,
      title,
      chat.type ?? 'supergroup',
      nowSec(),
      nowSec(),
      nowSec(),
    )
    this.chatCache.delete(chat.id)
    return this.settings(chat.id)
  }

  private async settings(chatId: number): Promise<ChatSettings> {
    const hit = this.chatCache.get(chatId)
    if (hit && hit.at > Date.now() - 60_000) return hit.v
    const row = this.ctx.storage.sql
      .exec<Row>('SELECT c.settings AS s, c.title AS title, c.type AS type FROM chats c WHERE c.id = ?', chatId)
      .toArray()[0]
    const base = defaultSettings({ id: chatId, title: row ? String(row.title ?? '') : '', type: (row?.type as ChatSettings['type']) ?? 'supergroup' })
    const saved = row?.s ? (JSON.parse(String(row.s)) as unknown) : {}
    const merged = mergeSettings(mergeSettings(base, await this.defaultsRaw()), saved)
    this.chatCache.set(chatId, { at: Date.now(), v: merged })
    return merged
  }

  private async defaultsRaw(): Promise<Partial<ChatSettings>> {
    const g = await this.global()
    return g.defaults
  }

  private async patchSettings(chatId: number, patch: Partial<ChatSettings>): Promise<ChatSettings> {
    const cur = await this.settings(chatId)
    const next = mergeSettings(cur, patch)
    this.ctx.storage.sql.exec('INSERT INTO chats (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET settings = ?, updated_at = ?', chatId, nowSec(), JSON.stringify(stripDefaults(next)), nowSec())
    this.chatCache.delete(chatId)
    return next
  }

  private async saveSettings(chatId: number, patch: unknown): Promise<ChatSettings> {
    return this.patchSettings(chatId, (patch ?? {}) as Partial<ChatSettings>)
  }

  /* ---------------- آمار ---------------- */

  private async bump(chatId: number, field: StatField, n = 1): Promise<void> {
    if (!STAT_FIELDS.includes(field)) return
    const tz = (await this.global()).tzOffsetMin
    const now = Date.now()
    this.ctx.storage.sql.exec(
      `INSERT INTO stats_day (chat_id, day, ${field}) VALUES (?, ?, ?)
       ON CONFLICT(chat_id, day) DO UPDATE SET ${field} = ${field} + excluded.${field}`,
      chatId,
      dayKey(now, tz),
      n,
    )
    if (field === 'msgs') {
      this.ctx.storage.sql.exec(
        'INSERT INTO stats_hour (chat_id, hour, msgs) VALUES (?, ?, 1) ON CONFLICT(chat_id, hour) DO UPDATE SET msgs = msgs + 1',
        chatId,
        hourKey(now, tz),
      )
    }
  }

  private async statsRows(chatId: number | null, days: number) {
    const rows =
      chatId === null
        ? this.ctx.storage.sql
            .exec<Row>(
              `SELECT day, SUM(msgs) msgs, SUM(members) members, SUM(deleted) deleted, SUM(warns) warns, SUM(mutes) mutes, SUM(bans) bans, SUM(replies) replies, SUM(commands) commands
               FROM stats_day WHERE day >= date('now', ?) GROUP BY day ORDER BY day`,
              `-${Math.max(1, Math.min(90, days))} day`,
            )
            .toArray()
        : this.ctx.storage.sql
            .exec<Row>(
              `SELECT day, msgs, members, deleted, warns, mutes, bans, replies, commands
               FROM stats_day WHERE chat_id = ? AND day >= date('now', ?) ORDER BY day`,
              chatId,
              `-${Math.max(1, Math.min(90, days))} day`,
            )
            .toArray()
    return rows.map(r => ({
      day: String(r.day ?? ''),
      msgs: Number(r.msgs ?? 0),
      members: Number(r.members ?? 0),
      deleted: Number(r.deleted ?? 0),
      warns: Number(r.warns ?? 0),
      mutes: Number(r.mutes ?? 0),
      bans: Number(r.bans ?? 0),
      replies: Number(r.replies ?? 0),
      commands: Number(r.commands ?? 0),
    }))
  }

  private async hourly(chatId: number | null, hours: number) {
    const from = hourKey(Date.now(), (await this.global()).tzOffsetMin) - Math.max(1, Math.min(168, hours))
    const rows =
      chatId === null
        ? this.ctx.storage.sql.exec<Row>('SELECT hour, SUM(msgs) msgs FROM stats_hour WHERE hour >= ? GROUP BY hour', from).toArray()
        : this.ctx.storage.sql.exec<Row>('SELECT hour, msgs FROM stats_hour WHERE chat_id = ? AND hour >= ?', chatId, from).toArray()
    return rows.map(r => ({ hour: Number(r.hour), msgs: Number(r.msgs ?? 0) }))
  }

  private async memberCount(chatId: number): Promise<number> {
    const row = this.ctx.storage.sql.exec<Row>('SELECT members FROM chats WHERE id = ?', chatId).toArray()[0]
    return Number(row?.members ?? 0)
  }

  private async incMembers(chatId: number, n: number): Promise<void> {
    this.ctx.storage.sql.exec('INSERT INTO chats (id, created_at, members) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET members = MAX(0, members + ?)', chatId, nowSec(), Math.max(0, n), n)
  }

  /* ---------------- اخطارها، نوت‌ها، لاگ ---------------- */

  private async getWarn(chatId: number, userId: number): Promise<WarnRow> {
    const r = this.ctx.storage.sql.exec<Row>('SELECT * FROM warns WHERE chat_id = ? AND user_id = ?', chatId, userId).toArray()[0]
    return { chatId, userId, points: Number(r?.points ?? 0), reason: String(r?.reason ?? ''), updatedAt: Number(r?.updated_at ?? 0) }
  }

  private async setWarn(chatId: number, userId: number, points: number, reason: string): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO warns (chat_id, user_id, points, reason, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, user_id) DO UPDATE SET points = excluded.points, reason = excluded.reason, updated_at = excluded.updated_at`,
      chatId,
      userId,
      Math.max(0, points),
      String(reason).slice(0, 120),
      nowSec(),
    )
    await this.forwardModlog(chatId, `اخطار <code>${userId}</code> → ${points}`)
  }

  private async modlog(row: Omit<ModlogRow, 'id' | 'ts'>): Promise<void> {
    this.ctx.storage.sql.exec(
      'INSERT INTO modlog (chat_id, action, target_id, target_name, moderator, reason, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
      row.chatId,
      row.action.slice(0, 40),
      row.targetId,
      row.targetName.slice(0, 80),
      row.moderator.slice(0, 60),
      row.reason.slice(0, 400),
      Date.now(),
    )
    await this.forwardModlog(row.chatId, `${row.action} → ${row.targetName || row.targetId || ''} ${row.reason ? `(${truncate(row.reason, 60)})` : ''}`)
  }

  private async forwardModlog(chatId: number, text: string): Promise<void> {
    const s = await this.settings(chatId)
    if (!s.logChatId) return
    await (await this.bot())
      .trySend(s.logChatId, `📋 <code>${chatId}</code> ${text}`)
      .catch(() => undefined)
  }

  private async modlogList(chatId: number | null, limit: number): Promise<ModlogRow[]> {
    const n = clamp(toInt(limit, 20), 1, 200)
    const rows =
      chatId === null
        ? this.ctx.storage.sql.exec<Row>('SELECT * FROM modlog ORDER BY id DESC LIMIT ?', n).toArray()
        : this.ctx.storage.sql.exec<Row>('SELECT * FROM modlog WHERE chat_id = ? ORDER BY id DESC LIMIT ?', chatId, n).toArray()
    return rows.map(r => ({
      id: Number(r.id),
      chatId: Number(r.chat_id),
      action: String(r.action ?? ''),
      targetId: r.target_id === null ? null : Number(r.target_id),
      targetName: String(r.target_name ?? ''),
      moderator: String(r.moderator ?? ''),
      reason: String(r.reason ?? ''),
      ts: Number(r.ts ?? 0),
    }))
  }

  private async notes(chatId: number): Promise<Note[]> {
    return this.ctx.storage.sql
      .exec<Row>('SELECT * FROM notes WHERE chat_id = ? ORDER BY name', chatId)
      .toArray()
      .map(r => ({
        chatId: Number(r.chat_id),
        name: String(r.name),
        text: String(r.text),
        createdBy: Number(r.created_by),
        createdAt: Number(r.created_at),
        hits: Number(r.hits),
      }))
  }

  private async getNote(chatId: number, name: string): Promise<Note | null> {
    const r = this.ctx.storage.sql.exec<Row>('SELECT * FROM notes WHERE chat_id = ? AND name = ?', chatId, name).toArray()[0]
    if (!r) return null
    return { chatId, name, text: String(r.text), createdBy: Number(r.created_by), createdAt: Number(r.created_at), hits: Number(r.hits) }
  }

  private async saveNote(chatId: number, name: string, text: string, by: number): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO notes (chat_id, name, text, created_by, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, name) DO UPDATE SET text = excluded.text, created_by = excluded.created_by, created_at = excluded.created_at`,
      chatId,
      name.toLowerCase().slice(0, 40),
      text.slice(0, 4000),
      by,
      nowSec(),
    )
  }

  private async delNote(chatId: number, name: string): Promise<boolean> {
    const before = this.ctx.storage.sql.exec<Row>('SELECT COUNT(*) n FROM notes WHERE chat_id = ? AND name = ?', chatId, name).toArray()[0]
    this.ctx.storage.sql.exec('DELETE FROM notes WHERE chat_id = ? AND name = ?', chatId, name)
    return Number(before?.n ?? 0) > 0
  }

  private async hitNote(chatId: number, name: string): Promise<void> {
    this.ctx.storage.sql.exec('UPDATE notes SET hits = hits + 1 WHERE chat_id = ? AND name = ?', chatId, name)
  }

  private async keywords(chatId: number): Promise<KeywordRule[]> {
    return this.ctx.storage.sql
      .exec<Row>('SELECT * FROM keywords WHERE chat_id = ? ORDER BY id', chatId)
      .toArray()
      .map(r => ({
        id: Number(r.id),
        chatId: Number(r.chat_id),
        pattern: String(r.pattern),
        reply: String(r.reply),
        mode: String(r.mode) as KeywordRule['mode'],
        enabled: Number(r.enabled) === 1,
        hits: Number(r.hits),
      }))
  }

  private async hitKeyword(id: number): Promise<void> {
    this.ctx.storage.sql.exec('UPDATE keywords SET hits = hits + 1 WHERE id = ?', id)
  }

  private async jobs(chatId: number | null): Promise<ScheduledJob[]> {
    const rows =
      chatId === null
        ? this.ctx.storage.sql.exec<Row>('SELECT * FROM schedule ORDER BY at LIMIT 200').toArray()
        : this.ctx.storage.sql.exec<Row>('SELECT * FROM schedule WHERE chat_id = ? ORDER BY at LIMIT 200', chatId).toArray()
    return rows.map(r => ({
      id: Number(r.id),
      chatId: Number(r.chat_id),
      text: String(r.text),
      at: Number(r.at),
      everyMin: Number(r.every_min),
      enabled: Number(r.enabled) === 1,
      note: String(r.note ?? ''),
      createdBy: Number(r.created_by),
      lastSent: Number(r.last_sent),
      sentCount: Number(r.sent_count),
    }))
  }

  private async addJob(job: Omit<ScheduledJob, 'id' | 'lastSent' | 'sentCount'>): Promise<ScheduledJob> {
    const info = this.ctx.storage.sql.exec<Row>(
      `INSERT INTO schedule (chat_id, text, at, every_min, enabled, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      job.chatId,
      job.text.slice(0, 4000),
      job.at,
      job.everyMin,
      job.enabled ? 1 : 0,
      job.note.slice(0, 120),
      job.createdBy,
    )
    const id = Number(info.toArray()[0]?.id ?? 0)
    return { ...job, id, lastSent: 0, sentCount: 0 }
  }

  private async delJob(id: number, chatId: number): Promise<boolean> {
    const r = this.ctx.storage.sql.exec<Row>('SELECT id FROM schedule WHERE id = ? AND chat_id = ?', id, chatId).toArray()
    this.ctx.storage.sql.exec('DELETE FROM schedule WHERE id = ? AND chat_id = ?', id, chatId)
    return r.length > 0
  }

  private async markSent(id: number, nextAt: number): Promise<void> {
    this.ctx.storage.sql.exec('UPDATE schedule SET at = ?, last_sent = ?, sent_count = sent_count + 1 WHERE id = ?', nextAt, nowSec(), id)
  }

  private async verifyAdd(chatId: number, userId: number, msgId: number, exp: number): Promise<void> {
    this.ctx.storage.sql.exec(
      'INSERT INTO verify (chat_id, user_id, msg_id, exp) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id, user_id) DO UPDATE SET msg_id = excluded.msg_id, exp = excluded.exp',
      chatId,
      userId,
      msgId,
      exp,
    )
  }

  private async verifyDone(chatId: number, userId: number): Promise<{ msgId: number } | null> {
    const r = this.ctx.storage.sql.exec<Row>('SELECT msg_id FROM verify WHERE chat_id = ? AND user_id = ?', chatId, userId).toArray()[0]
    this.ctx.storage.sql.exec('DELETE FROM verify WHERE chat_id = ? AND user_id = ?', chatId, userId)
    return r ? { msgId: Number(r.msg_id) } : null
  }

  private async verifyExpired(now: number): Promise<{ chatId: number; userId: number }[]> {
    return this.ctx.storage.sql
      .exec<Row>('SELECT chat_id, user_id FROM verify WHERE exp < ? LIMIT 20', now)
      .toArray()
      .map(r => {
        this.ctx.storage.sql.exec('DELETE FROM verify WHERE chat_id = ? AND user_id = ?', Number(r.chat_id), Number(r.user_id))
        return { chatId: Number(r.chat_id), userId: Number(r.user_id) }
      })
  }

  private async broadcastList(): Promise<number[]> {
    const rows = this.ctx.storage.sql.exec<Row>("SELECT id FROM chats WHERE active = 1 AND json_extract(settings, '$.broadcast') = 1").toArray()
    return rows.map(r => Number(r.id)).filter(n => Number.isFinite(n))
  }

  private async broadcastState(): Promise<{ text: string; remaining: number[] } | null> {
    const raw = this.cfg('broadcast')
    if (!raw) return null
    try {
      return JSON.parse(raw) as { text: string; remaining: number[] }
    } catch {
      return null
    }
  }

  private async broadcastSet(state: { text: string; remaining: number[] } | null): Promise<void> {
    await this.cfgSet('broadcast', state ? JSON.stringify(state) : null)
  }

  /* ---------------- cache‌های اجرایی ---------------- */

  private async isAdmin(chatId: number, userId: number): Promise<boolean> {
    const key = `${chatId}:${userId}`
    const hit = this.adminCache.get(key)
    if (hit && hit.exp > Date.now()) return hit.status === 'creator' || hit.status === 'administrator'
    try {
      const m = await (await this.bot()).getChatMember(chatId, userId)
      this.adminCache.set(key, { status: m.status, exp: Date.now() + 10 * 60_000 })
      return m.status === 'creator' || m.status === 'administrator'
    } catch {
      this.adminCache.set(key, { status: 'unknown', exp: Date.now() + 60_000 })
      return false
    }
  }

  /** پنجره‌ی لغویی هر کاربر: زمان پیام‌ها و متن‌های اخیر (برای فلود و تکرار) */
  private history(chatId: number, userId: number, text: string, at: number): HistoryEntry {
    const key = `${chatId}:${userId}`
    const prev = this.hist.get(key)
    const timestamps = prune(prev?.timestamps ?? [], 600, at)
    const texts = prev ? prev.texts.slice(Math.max(0, (prev.timestamps.length ?? 0) - timestamps.length)) : []
    const before: HistoryEntry = { timestamps: [...timestamps], texts: [...texts] }
    timestamps.push(at)
    texts.push(truncate(text, 200))
    if (timestamps.length > 40) timestamps.splice(0, timestamps.length - 40)
    if (texts.length > 40) texts.splice(0, texts.length - 40)
    this.hist.set(key, { timestamps, texts })
    return before
  }

  private log(level: 'info' | 'success' | 'warn' | 'error', msg: string, chatId: number | null = null): void {
    const entry: LogLine = { id: (this.logs.at(-1)?.id ?? 0) + 1, ts: Date.now(), level, msg: String(msg).slice(0, 500), chatId }
    this.logs.push(entry)
    if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400)
    this.logsDirty = true
    const line = `data: ${JSON.stringify(entry)}\n\n`
    for (const w of this.sse) w.write(line).catch(() => undefined)
    // لاگ‌های مهم بیرون از درخواست را از دست نده
    this.ctx.waitUntil(this.flushLogs())
    const prefix = chatId ? `[${chatId}] ` : ''
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    fn(`[selfhub] ${prefix}${entry.msg}`)
  }

  private async flushLogs(): Promise<void> {
    if (!this.logsDirty) return
    this.logsDirty = false
    const recent = this.logs.slice(-200)
    this.ctx.storage.sql.exec('DELETE FROM events WHERE id < ?', Math.max(0, (recent[0]?.id ?? 0) - 500))
    for (const l of recent.slice(-40)) {
      this.ctx.storage.sql.exec('INSERT INTO events (id, ts, level, msg, chat_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING', l.id, l.ts, l.level, l.msg, l.chatId)
    }
  }

  /* ---------------- ctx برای موتور ---------------- */

  private buildCtx(): HubCtx {
    const self = this
    return {
      bot: () => {
        if (!self._bot) throw new Error('کلاینت آماده نیست')
        return self._bot
      },
      botId: () => self._botId,
      global: () => self.global(),
      settings: id => self.settings(id),
      patchSettings: (id, patch) => self.patchSettings(id, patch),
      ensureChat: async chat => {
        const s = await self.ensureChat(chat)
        return s
      },
      isAdmin: (c, u) => self.isAdmin(c, u),
      history: (c, u, t, at) => self.history(c, u, t, at),
      bump: async (c, f, n) => {
        if (f === 'members') await self.incMembers(c, n ?? 1)
        await self.bump(c, f, n ?? 1)
      },
      log: (lvl, msg, chatId) => self.log(lvl, msg, chatId ?? null),
      modlog: r => self.modlog(r),
      modlogList: (c, n) => self.modlogList(c, n),
      getWarn: (c, u) => self.getWarn(c, u),
      setWarn: (c, u, p, r) => self.setWarn(c, u, p, r),
      statsRows: (c, d) => self.statsRows(c, d),
      hourly: (c, h) => self.hourly(c, h),
      memberCount: c => self.memberCount(c),
      notes: c => self.notes(c),
      getNote: (c, n) => self.getNote(c, n),
      saveNote: (c, n, t, by) => self.saveNote(c, n, t, by),
      delNote: (c, n) => self.delNote(c, n),
      hitNote: (c, n) => self.hitNote(c, n),
      keywords: c => self.keywords(c),
      hitKeyword: id => self.hitKeyword(id),
      jobs: c => self.jobs(c),
      addJob: j => self.addJob(j),
      delJob: (id, c) => self.delJob(id, c),
      markSent: (id, at) => self.markSent(id, at),
      verifyAdd: (c, u, m, e) => self.verifyAdd(c, u, m, e),
      verifyDone: (c, u) => self.verifyDone(c, u),
      verifyExpired: n => self.verifyExpired(n),
      broadcastList: () => self.broadcastList(),
      broadcastState: () => self.broadcastState(),
      broadcastSet: s => self.broadcastSet(s),
      sleep: ms => delay(ms),
    }
  }

  /* ---------------- چرخه‌ی حیات ---------------- */

  override async fetch(req: Request): Promise<Response> {
    await this.boot()
    const url = new URL(req.url)
    const p = url.pathname
    const m = req.method

    try {
      if (p === '/internal/tick' && m === 'POST') return json({ ok: true, ...(await this.tick()) })

      // وب‌هوک: راستی‌آزمایی رمز + حذف تکراری + صف ترتیب‌دار
      if (p === '/internal/hook' && m === 'POST') {
        const b = await readJson<{ secret?: string; update?: TgUpdate; headerSecret?: string | null }>(req)
        if (!this.cfg('installed')) return json({ ok: true, skipped: 'not-installed' })
        const secret = this.cfg('webhook_secret')
        const provided = String(b.headerSecret || b.secret || '')
        // مقایسهٔ زمان‌ثابت؛ رمز از هدر تلگرام یا از مسیر هر دو قابل‌پذیرش‌اند
        if (!secret || provided.length < 16 || !timingSafeB64Equal(provided, secret)) return err('forbidden', 403)
        const upd = b.update
        if (!upd?.update_id) return json({ ok: true })
        // علامت‌زدن پیش از هر await: اگر دو retry هم‌زمان برسند، دومی همین‌جا می‌ایستد
        if (this.seen.has(upd.update_id)) return json({ ok: true, duplicate: true })
        this.markSeen(upd.update_id)
        return this.enqueue(async () => {
          await this.runUpdate(upd)
          return json({ ok: true })
        })
      }
      // شبیه‌سازی ورودی (محلی): update ساختگی را بدون رمز وب‌هوک وارد می‌کند
      if (p === '/internal/simulate' && m === 'POST') {
        if (this.env.SIMULATE !== '1') return err('فقط در حالت دیباگ (SIMULATE=1)', 403)
        const b = await readJson<{ update?: TgUpdate }>(req)
        const upd = b.update
        if (upd) {
          const forced: TgUpdate = { ...upd, update_id: Math.max(1, toInt(upd.update_id, 1)) }
          if (forced.update_id > this.lastId) this.lastId = forced.update_id
          await this.enqueue(() => this.runUpdate(forced))
        }
        return json({ ok: true, simulated: true })
      }

      if (p === '/internal/info' && m === 'GET') return json({ ok: true, ...(await this.info()) })
      if (p === '/internal/signing' && m === 'GET') return json({ ok: true, secret: await this.signingSecret() })
      if (p === '/internal/install' && m === 'POST') {
        const b = await readJson<{ token?: string; password?: string }>(req)
        const r = await this.install(String(b.token ?? ''), String(b.password ?? ''))
        return r.ok ? json({ ok: true }) : err(r.error ?? 'نصب نشد', 400)
      }

      if (p.startsWith('/admin/')) return await this.admin(p.slice(6), url, req)

      return err('مسیر ناشناخته', 404)
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      this.log('error', `DO: ${msg.slice(0, 200)}`)
      return err(msg.slice(0, 300), 500)
    }
  }

  private markSeen(id: number): void {
    this.seen.add(id)
    this.seenOrder.push(id)
    while (this.seenOrder.length > 512) {
      const drop = this.seenOrder.shift()
      if (drop !== undefined) this.seen.delete(drop)
    }
    if (id > this.lastId) this.lastId = id
  }

  /**
   * یک DO چند request را هم‌زمان اجرا می‌کند؛ بدون این صف دو پیام پشت‌سرهم ممکن است برعکس
   * پردازش شوند (فلود از قلم می‌افتد، اخطارها جابه‌جا می‌شوند). پاسخ هر request تا تمام‌شدن
   * کارش باز نمی‌گردد، پس waitUntilِ ورکر زنجیره را زنده نگه می‌دارد.
   */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async runUpdate(update: TgUpdate): Promise<void> {
    const token = await this.token()
    if (!token) return
    this._bot = new TelegramBot(token)
    this._botId = Number(token.split(':')[0] ?? 0)
    const me = this._botId
    if (!me) return
    await processUpdate(this.buildCtx(), update)
    await this.flushLogs()
  }

  private async tick(): Promise<{ jobs: number; installed: boolean }> {
    const token = await this.token()
    if (!token) return { jobs: 0, installed: false }
    this._bot = new TelegramBot(token)
    this._botId = Number(token.split(':')[0] ?? 0)
    const jobs = await runDueJobs(this.buildCtx(), nowSec())
    await this.flushLogs()
    // پاک‌سازی کش‌ها تا DO متورم نشود
    if (this.adminCache.size > 4000) this.adminCache.clear()
    if (this.hist.size > 8000) this.hist.clear()
    if (this.chatCache.size > 4000) this.chatCache.clear()
    this.ctx.storage.sql.exec('DELETE FROM stats_hour WHERE hour < ?', hourKey(Date.now(), (await this.global()).tzOffsetMin) - 168)
    return { jobs, installed: true }
  }

  /** cron trigger — همان tick */
  async scheduled(): Promise<void> {
    await this.boot()
    await this.tick()
  }

  private async info() {
    const installed = !!this.cfg('installed')
    let me = null as Awaited<ReturnType<TelegramBot['getMe']>> | null
    let webhook = null as Awaited<ReturnType<TelegramBot['getWebhookInfo']>> | null
    let lastError = this.cfg('last_error')
    if (installed) {
      try {
        const b = await this.bot()
        me = await b.getMe()
        webhook = await b.getWebhookInfo()
      } catch (e) {
        lastError = String((e as Error).message).slice(0, 200)
      }
    }
    return {
      installed,
      version: VERSION,
      createdAt: toInt(this.cfg('installed_at'), 0),
      lastError,
      lastUpdateId: this.lastId,
      panelUrl: this.cfg('panel_url'),
      me: me ? { id: me.id, username: me.username ?? '', first_name: me.first_name, can_read_all_group_messages: !!me.can_read_all_group_messages } : null,
      webhook: webhook
        ? {
            url: webhook.url,
            is_running: !!webhook.url,
            pending_update_count: webhook.pending_update_count,
            last_error_message: webhook.last_error_message ?? '',
            has_secret: true,
          }
        : null,
      chats: Number(this.ctx.storage.sql.exec<Row>('SELECT COUNT(*) n FROM chats WHERE active = 1').toArray()[0]?.n ?? 0),
      subscribers: Number(this.ctx.storage.sql.exec<Row>('SELECT COUNT(*) n FROM chats WHERE active = 1 AND json_extract(settings, \'$.broadcast\') = 1').toArray()[0]?.n ?? 0),
      commands: COMMANDS.length,
    }
  }

  /* ---------------- API پنل ---------------- */

  private async admin(path: string, url: URL, req: Request): Promise<Response> {
    const q = url.searchParams
    const post = async <T = Row>(): Promise<T> => (await readJson<T>(req)) as T

    switch (true) {
      case path === '/state' && req.method === 'GET':
        return json({ ok: true, ...(await this.info()) })

      case path === '/login' && req.method === 'POST': {
        const b = await post<{ password?: string }>()
        const ok = await this.verifyPassword(String(b.password ?? ''))
        const guard = await this.loginGuard(ok)
        if (!guard.allowed) return err(`به دلیل تلاش‌های ناموفق، ${guard.retryIn} ثانیه صبر کنید`, 429)
        if (!ok) return err('رمز عبور نادرست است', 401)
        return json({ ok: true })
      }

      case path === '/setup' && req.method === 'POST': {
        const b = await post<{ token?: string; password?: string; url?: string }>()
        if (b.url) await this.cfgSet('panel_url', String(b.url).replace(/\/$/, ''))
        const r = await this.install(String(b.token ?? ''), String(b.password ?? ''))
        return r.ok ? json({ ok: true, ...(await this.info()) }) : err(r.error ?? 'نصب نشد', 400)
      }

      case path === '/overview' && req.method === 'GET': {
        const days = clamp(toInt(q.get('days'), 14), 1, 90)
        const rows = await this.statsRows(null, days)
        const hours = await this.hourly(null, 48)
        const tz = (await this.global()).tzOffsetMin
        const chats = this.ctx.storage.sql
          .exec<Row>('SELECT id, title, type, members, active FROM chats WHERE active = 1 ORDER BY updated_at DESC LIMIT 50')
          .toArray()
          .map(r => ({ id: Number(r.id), title: String(r.title ?? ''), type: String(r.type ?? ''), members: Number(r.members ?? 0) }))
        const top = await Promise.all(
          chats.slice(0, 8).map(async c => ({ chat: c, t: totals(await this.statsRows(c.id, days)) })),
        )
        return json({
          ok: true,
          totals: totals(rows),
          series: series(rows),
          growth: growth(rows),
          hourly: hourlySeries(hours, 24, hourKey(Date.now(), tz)),
          chats,
          top,
          events: this.logs.slice(-40).reverse(),
        })
      }

      case path === '/chats' && req.method === 'GET': {
        const rows = this.ctx.storage.sql
          .exec<Row>("SELECT id, title, type, members, active, updated_at, settings FROM chats WHERE active = 1 ORDER BY updated_at DESC LIMIT 200")
          .toArray()
        return json({
          ok: true,
          chats: rows.map(r => ({
            id: Number(r.id),
            title: String(r.title ?? ''),
            type: String(r.type ?? ''),
            members: Number(r.members ?? 0),
            active: Number(r.active) === 1,
            updatedAt: Number(r.updated_at ?? 0),
            settings: mergeSettings(defaultSettings({ id: Number(r.id), title: String(r.title ?? ''), type: String(r.type ?? 'supergroup') as ChatSettings['type'] }), r.settings ? JSON.parse(String(r.settings)) : {}),
          })),
        })
      }

      case /^\/chats\/-?\d+$/ .test(path) && req.method === 'GET': {
        const id = Number(path.split('/')[2])
        return json({ ok: true, settings: await this.settings(id), keywords: await this.keywords(id), notes: await this.notes(id), jobs: await this.jobs(id), modlog: await this.modlogList(id, 20), stats: totals(await this.statsRows(id, 30)) })
      }

      case /^\/chats\/-?\d+\/settings$/.test(path) && req.method === 'PUT': {
        const id = Number(path.split('/')[2])
        const next = await this.saveSettings(id, await post())
        return json({ ok: true, settings: next })
      }

      case /^\/chats\/-?\d+\/keywords$/.test(path) && req.method === 'POST': {
        const id = Number(path.split('/')[2])
        const b = await post<{ pattern?: string; reply?: string; mode?: string; enabled?: boolean }>()
        const pattern = String(b.pattern ?? '').slice(0, 200)
        const reply = String(b.reply ?? '').slice(0, 2000)
        if (!pattern || !reply) return err('الگو و پاسخ لازم است', 400)
        this.ctx.storage.sql.exec(
          'INSERT INTO keywords (chat_id, pattern, reply, mode, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          id,
          pattern,
          reply,
          ['contains', 'exact', 'regex', 'starts'].includes(String(b.mode)) ? String(b.mode) : 'contains',
          b.enabled === false ? 0 : 1,
          nowSec(),
        )
        return json({ ok: true, keywords: await this.keywords(id) })
      }

      case /^\/chats\/-?\d+\/keywords\/\d+$/.test(path) && req.method === 'DELETE': {
        const [, , idStr, , kwStr] = path.split('/')
        this.ctx.storage.sql.exec('DELETE FROM keywords WHERE chat_id = ? AND id = ?', Number(idStr), Number(kwStr))
        return json({ ok: true })
      }

      case /^\/chats\/-?\d+\/notes$/.test(path) && req.method === 'POST': {
        const id = Number(path.split('/')[2])
        const b = await post<{ name?: string; text?: string }>()
        if (!b.name || !b.text) return err('نام و متن لازم است', 400)
        await this.saveNote(id, String(b.name).toLowerCase().slice(0, 40), String(b.text).slice(0, 4000), 0)
        return json({ ok: true, notes: await this.notes(id) })
      }

      case /^\/chats\/-?\d+\/notes\/\w+$/.test(path) && req.method === 'DELETE': {
        const parts = path.split('/')
        const ok = await this.delNote(Number(parts[2]), String(parts[4] ?? ''))
        return json({ ok })
      }

      case path === '/schedule' && req.method === 'GET':
        return json({ ok: true, jobs: await this.jobs(null) })

      case path === '/schedule' && req.method === 'POST': {
        const b = await post<{ chatId?: number; when?: string; text?: string }>()
        const chatId = Number(b.chatId)
        if (!Number.isFinite(chatId) || !b.text) return err('chatId و text لازم است', 400)
        const parsed = parseWhen(String(b.when ?? ''), nowSec(), (await this.global()).tzOffsetMin)
        if (!parsed) return err('زمان را نفهمیدم (مثال: +20m یا فردا ۸:۰۰ یا every 30m)', 400)
        const job = await this.addJob({
          chatId,
          text: String(b.text).slice(0, 4000),
          at: parsed.at,
          everyMin: Math.round(parsed.everySec / 60),
          enabled: true,
          note: 'از پنل',
          createdBy: 0,
        })
        return json({ ok: true, job })
      }

      case /^\/schedule\/\d+\/run$/.test(path) && req.method === 'POST': {
        const id = Number(path.split('/')[2])
        const jobs = (await this.jobs(null)).filter(j => j.id === id)
        for (const j of jobs) {
          await (await this.bot()).trySend(j.chatId, j.text)
          const next = j.everyMin > 0 ? nowSec() + j.everyMin * 60 : 0
          if (next === 0) await this.delJob(j.id, j.chatId)
          else await this.markSent(j.id, next)
        }
        return json({ ok: true, sent: jobs.length })
      }

      case /^\/schedule\/\d+$/.test(path) && req.method === 'DELETE': {
        const id = Number(path.split('/')[2])
        const rows = this.ctx.storage.sql.exec<Row>('SELECT chat_id FROM schedule WHERE id = ?', id).toArray()
        for (const r of rows) this.ctx.storage.sql.exec('DELETE FROM schedule WHERE id = ? AND chat_id = ?', id, Number(r.chat_id))
        return json({ ok: true })
      }

      case path === '/modlog' && req.method === 'GET':
        return json({ ok: true, rows: await this.modlogList(q.get('chat') ? Number(q.get('chat')) : null, toInt(q.get('limit'), 50)) })

      case path === '/global' && req.method === 'GET':
        return json({ ok: true, global: await this.global() })

      case path === '/global' && req.method === 'PUT':
        return json({ ok: true, global: await this.saveGlobal(await post()) })

      case path === '/broadcast' && req.method === 'POST': {
        const b = await post<{ text?: string; chatIds?: number[]; dryRun?: boolean }>()
        const text = String(b.text ?? '').slice(0, 4000)
        if (!text) return err('متن خالی است', 400)
        const all = await this.broadcastList()
        const only = Array.isArray(b.chatIds) ? b.chatIds : null
        const list = only?.length ? all.filter(x => only.includes(x)) : all
        if (b.dryRun) return json({ ok: true, preview: list.length, text })
        const r = await doBroadcast(this.buildCtx(), text, list)
        return json({ ok: true, ...r })
      }

      // آزمون فیلترها: پیام نمونه را با تنظیمات *همین چت* می‌سنجد (بدون ارسال به تلگرام)
      case /^\/chats\/-?\d+\/test$/.test(path) && req.method === 'POST': {
        const id = Number(path.split('/')[2])
        const b = await post<{ text?: string; mediaTypes?: string[] }>()
        const s = await this.settings(id)
        const text = String(b.text ?? '').slice(0, 4096)
        const d = decide(
          s,
          {
            messageId: 0,
            fromId: 1,
            isBot: false,
            text,
            firstName: 'نمونه',
            username: 'sample',
            mediaTypes: (Array.isArray(b.mediaTypes) ? b.mediaTypes : []) as never,
            isForward: false,
            chatType: s.type,
            date: nowSec(),
          },
          { timestamps: [], texts: [] } as HistoryEntry,
          { isAdmin: false, warnPoints: 0, allowDomains: [] },
        )
        return json({ ok: true, chatId: id, wouldDelete: d.delete, action: d.action, reasons: d.reasons, muteMin: d.muteMin, violations: d.violations })
      }

      case path === '/security/password' && req.method === 'POST': {
        const b = await post<{ current?: string; next?: string }>()
        if (!(await this.verifyPassword(String(b.current ?? '')))) return err('رمز فعلی نادرست است', 401)
        const pw = passwordStrength(String(b.next ?? ''))
        if (!pw.ok) return err(pw.message ?? 'رمز ضعیف است', 400)
        const h = await pbkdf2Hash(String(b.next))
        await this.cfgSet('admin_salt', h.salt)
        await this.cfgSet('admin_hash', h.hash)
        await this.cfgSet('admin_iter', String(h.iter))
        this.log('warn', 'رمز عبور پنل تغییر کرد')
        return json({ ok: true })
      }

      case path === '/security/token' && req.method === 'PUT': {
        const b = await post<{ token?: string }>()
        const token = String(b.token ?? '').trim()
        if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) return err('قالب توکن نامعتبر است', 400)
        await this.setToken(token)
        this._bot = new TelegramBot(token)
        this._botId = Number(token.split(':')[0] ?? 0)
        await this.syncWebhook()
        return json({ ok: true, ...(await this.info()) })
      }

      case path === '/security/webhook/drop' && req.method === 'POST': {
        try {
          await (await this.bot()).deleteWebhook()
          await this.cfgSet('webhook_url', '')
          this.log('warn', 'وب‌هوک حذف شد؛ از این پس رویدادی از تلگرام نمی‌رسد')
          return json({ ok: true, ...(await this.info()) })
        } catch (e) {
          return err(String((e as Error).message).slice(0, 200), 502)
        }
      }

      case path === '/security/webhook' && req.method === 'POST': {
        if (q.get('url')) await this.cfgSet('panel_url', String(q.get('url')).replace(/\/$/, ''))
        const e = await this.syncWebhook()
        return e ? json({ ok: false, error: e, ...(await this.info()) }) : json({ ok: true, ...(await this.info()) })
      }

      case path === '/stats.csv' && req.method === 'GET': {
        const rows = await this.statsRows(q.get('chat') ? Number(q.get('chat')) : null, toInt(q.get('days'), 30))
        return new Response(csv(rows), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="selfhub-stats.csv"' } })
      }

      case path === '/export' && req.method === 'GET': {
        const dump = {
          version: 1,
          exportedAt: Date.now(),
          global: await this.global(),
          chats: this.ctx.storage.sql.exec<Row>('SELECT id, title, type, settings FROM chats').toArray(),
          keywords: this.ctx.storage.sql.exec<Row>('SELECT * FROM keywords').toArray(),
          notes: this.ctx.storage.sql.exec<Row>('SELECT * FROM notes').toArray(),
          schedule: this.ctx.storage.sql.exec<Row>('SELECT * FROM schedule').toArray(),
        }
        return json({ ok: true, dump })
      }

      case path === '/events' && req.method === 'GET':
        return this.stream(req)

      case path === '/danger/wipe' && req.method === 'POST': {
        const b = await post<{ confirm?: string }>()
        if (b.confirm !== 'WIPE') return err('برای تأیید WIPE را بفرستید', 400)
        for (const t of ['chats', 'keywords', 'notes', 'warns', 'modlog', 'schedule', 'stats_day', 'stats_hour', 'verify', 'events']) {
          this.ctx.storage.sql.exec(`DELETE FROM ${t}`)
        }
        this.chatCache.clear()
        this.hist.clear()
        this.adminCache.clear()
        this.log('warn', 'همه‌ی داده‌های چت‌ها پاک شد (تنظیمات نصب دست‌نخورده)')
        return json({ ok: true })
      }

      default:
        return err('مسیر ناشناخته', 404)
    }
  }

  private stream(req: Request): Response {
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const enc = new TextEncoder()
    const handle = {
      write: async (s: string): Promise<void> => {
        await writer.write(enc.encode(s))
      },
      close: (): void => {
        const i = this.sse.indexOf(handle)
        if (i >= 0) this.sse.splice(i, 1)
        try {
          writer.close().catch(() => undefined)
        } catch {
          /* already closed */
        }
      },
    }
    this.sse.push(handle)
    for (const l of this.logs.slice(-25)) handle.write(`data: ${JSON.stringify(l)}\n\n`).catch(() => undefined)
    req.signal.addEventListener('abort', () => handle.close())
    return new Response(readable, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' } })
  }
}

/** ذخیره‌ی فقط تفاوت‌ها — تا تغییر پیش‌فرض‌ها به همه‌ی چت‌ها سرریز کند */
function stripDefaults(s: ChatSettings): Partial<ChatSettings> {
  const base = defaultSettings() as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s as unknown as Record<string, unknown>)) {
    const b = base[k]
    if (k === 'title' || k === 'type' || k === 'logChatId' || k === 'broadcast') {
      out[k] = v
      continue
    }
    if (JSON.stringify(v) !== JSON.stringify(b)) out[k] = v
  }
  return out as Partial<ChatSettings>
}

export { VERSION }
