/* SelfHub — موتور امکانات سلف‌بات
 * هر قابلیت یک بخش از FeatureConfig است و در handleNewMessage / handleMemberUpdate / runTick پردازش می‌شود.
 * طراحی: بدون هیچ ربات هلپری — کنترل کامل از پنل وب.
 */

export type Level = 'info' | 'success' | 'warn' | 'error'

export interface Stats {
  sent: number
  received: number
  replies: number
  forwarded: number
  deleted: number
  dms: number
  joins: number
  reactions: number
  storyViews: number
  reads: number
  floodWaits: number
  lastFloodWait: number
  lastActivity: number
}

export interface RuntimeState {
  status: 'idle' | 'connecting' | 'awaiting_code' | 'awaiting_password' | 'connected' | 'error' | 'stopped' | 'removed'
  me: { id: number; displayName: string; username?: string; phone?: string; isBot?: boolean } | null
  lastError: string | null
  floodWaitUntil: number
  seenPm: Record<string, number>
  lastOut: Record<string, number>
  afkNotified: Record<string, number>
  storyViewed: Record<string, number[]>
  welcomeSeen: Record<string, number>
  lastScrape: { chat: string; count: number; at: number; members: ScrapeMember[] } | null
  massdm: MassdmJob | null
  joiner: JoinerJob | null
  health: { connectedSince: number; disconnects: number; lastExport: number }
  startedAt: number
}

export interface ScrapeMember {
  id: number
  username: string | null
  name: string
  type: string
}

export interface MassdmJob {
  active: boolean
  text: string
  targets: string[]
  idx: number
  sent: number
  errors: number
  dailySent: number
  dayStamp: string
  minDelayMs: number
  maxDelayMs: number
  dailyCap: number
  perTick: number
  lastError: string | null
  skipped: string[]
}

export interface JoinerJob {
  active: boolean
  links: string[]
  idx: number
  joined: number
  errors: number
  minDelayMs: number
  maxDelayMs: number
  results: { link: string; ok: boolean; error?: string }[]
}

export interface FeatureConfig {
  secretary: {
    on: boolean
    mode: 'all' | 'first' | 'offline' | 'keywords'
    text: string
    firstText: string
    offlineAfterMin: number
    keywords: { k: string; reply: string }[]
    scope: 'pm' | 'groups' | 'both'
    typing: boolean
    ignore: string[]
  }
  afk: { on: boolean; reason: string; since: number }
  forward: {
    on: boolean
    rules: { id: string; from: string; to: string; filter: string; mode: 'forward' | 'copy'; delaySec: number }[]
  }
  schedule: { jobs: { id: string; chat: string; text: string; at: number; everyMin: number; next: number; last?: number }[] }
  autoread: { pm: boolean; groups: boolean; channels: boolean; mentions: boolean }
  ghost: { on: boolean; offline: boolean; noRead: boolean; noTyping: boolean }
  stories: { on: boolean; peers: string[]; delaySec: number }
  react: { on: boolean; emojis: string[]; chance: number; chats: string[] }
  antispam: {
    on: boolean
    chats: string[]
    words: string[]
    action: 'delete' | 'delete_kick' | 'delete_ban'
    notifyPanel: boolean
  }
  welcome: { on: boolean; chats: string[]; text: string; onlyNewUsers: boolean }
  watcher: { on: boolean; keywords: string[]; chats: string[]; notifyChat: string }
  keeper: { on: boolean; chats: string[]; types: string[]; toChat: string }
  profile: { nameOn: boolean; nameTpl: string; bioOn: boolean; bioList: string[]; bioEveryMin: number; _lastBioIdx: number; _nextBioAt: number; _nextNameAt: number }
  commands: { on: boolean; prefix: string }
}

export function defaultConfig(): FeatureConfig {
  return {
    secretary: {
      on: false,
      mode: 'all',
      text: 'سلام! در حال حاضر نمی‌توانم پاسخ دهم، به‌زودی برگردم 🌸',
      firstText: 'سلام عزیز 🌸 پیامت رسید، به‌زودی جواب می‌دهم!',
      offlineAfterMin: 10,
      keywords: [{ k: 'سلام', reply: 'سلام! 🌹' }],
      scope: 'pm',
      typing: true,
      ignore: [],
    },
    afk: { on: false, reason: 'در دسترس نیستم، بزودی برمی‌گردم 🙏', since: 0 },
    forward: { on: false, rules: [] },
    schedule: { jobs: [] },
    autoread: { pm: true, groups: false, channels: false, mentions: true },
    ghost: { on: false, offline: true, noRead: false, noTyping: false },
    stories: { on: false, peers: [], delaySec: 7 },
    react: { on: false, emojis: ['👍', '❤️', '🔥', '🤩'], chance: 50, chats: [] },
    antispam: { on: false, chats: [], words: [], action: 'delete', notifyPanel: true },
    welcome: { on: false, chats: [], text: 'خوش اومدی {name} عزیز 🌹', onlyNewUsers: false },
    watcher: { on: false, keywords: [], chats: [], notifyChat: '' },
    keeper: { on: false, chats: [], types: ['photo', 'video'], toChat: 'me' },
    profile: {
      nameOn: false,
      nameTpl: '{name} | {time}',
      bioOn: false,
      bioList: ['[{time}] در حال کار'],
      bioEveryMin: 15,
      _lastBioIdx: 0,
      _nextBioAt: 0,
      _nextNameAt: 0,
    },
    commands: { on: true, prefix: '.' },
  }
}

/** هوک‌هایی که SelfDO در اختیار موتور می‌گذارد */
export interface EngineHooks {
  client: any
  meId: number
  stats: Stats
  state: RuntimeState
  cfg: FeatureConfig
  demo: boolean
  log(level: Level, msg: string): void
  notify(title: string, body: string): void
  persist(): Promise<void>
}

export function floodWaitSec(e: any): number | null {
  if (!e) return null
  if (typeof e.seconds === 'number') return e.seconds
  const m = String(e.errorMessage || e.message || '').match(/FLOOD_WAIT_(\d+)/)
  return m ? Number(m[1]) : null
}

export function chatKey(peer: any): string {
  return String(peer?.id ?? peer ?? '')
}

function chatMatches(list: string[], chat: any): boolean {
  if (list.includes('*')) return true
  const id = String(chat?.id ?? '')
  const un = (chat?.username ?? '').toLowerCase()
  return list.some(x => {
    const v = x.trim().toLowerCase().replace(/^@/, '')
    if (!v) return false
    return v === un || v === id || x.trim() === id
  })
}

export function textMatches(filter: string, text: string): boolean {
  if (!filter) return true
  if (/^\/.+\/[gimsu]*$/.test(filter)) {
    try {
      return new RegExp(filter.slice(1, filter.lastIndexOf('/')), filter.slice(filter.lastIndexOf('/') + 1)).test(text)
    } catch {
      return false
    }
  }
  return filter
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .some(w => text.toLowerCase().includes(w))
}

export function persianTime(d = new Date()): { time: string; date: string } {
  try {
    const time = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
    const date = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
    return { time, date }
  } catch {
    return { time: d.toTimeString().slice(0, 5), date: d.toISOString().slice(0, 10) }
  }
}

export function fillTemplate(tpl: string, extra: Record<string, string> = {}): string {
  const { time, date } = persianTime()
  return tpl
    .replaceAll('{time}', time)
    .replaceAll('{date}', date)
    .replaceAll('{name}', extra.name ?? '')
    .replaceAll('{username}', extra.username ?? '')
    .replaceAll('{id}', extra.id ?? '')
    .replaceAll('{chat}', extra.chat ?? '')
}

/** ارسال متن با شبیه‌سازی تایپینگ اختیاری */
export async function sendSmart(eng: EngineHooks, chat: any, text: string, replyTo?: number, entities?: any[]): Promise<any> {
  if (eng.demo) {
    eng.log('success', `(نمایشی) ارسال پیام به «${chat?.displayName ?? chat}»`)
    eng.stats.sent++
    return { id: Math.floor(Math.random() * 100000) }
  }
  const noTyping = eng.cfg.ghost.on && eng.cfg.ghost.noTyping
  if (!noTyping) {
    try {
      await eng.client.sendTyping(chat, 'typing')
      await new Promise(r => setTimeout(r, 400 + Math.random() * 1200))
    } catch {}
  }
  const payload: any = entities ? { text, entities } : text
  const msg = await eng.client.sendText(chat, payload, replyTo ? { replyTo } : undefined)
  eng.stats.sent++
  eng.state.lastOut[chatKey(chat)] = Date.now()
  return msg
}

async function safe(fn: () => Promise<void>, eng: EngineHooks, tag: string): Promise<void> {
  try {
    await fn()
  } catch (e: any) {
    const fw = floodWaitSec(e)
    if (fw) {
      eng.stats.floodWaits++
      eng.state.floodWaitUntil = Date.now() + fw * 1000
      eng.stats.lastFloodWait = Date.now()
      eng.log('warn', `[${tag}] محدودیت تلگرام (FloodWait ${fw}s) — توقف موقت`)
    } else {
      eng.log('error', `[${tag}] ${e?.errorMessage ?? e?.message ?? String(e)}`)
    }
  }
}

/* ---------------------------------------------------------------
 * پردازش پیام جدید — قلب موتور
 * --------------------------------------------------------------- */
export async function handleNewMessage(eng: EngineHooks, msg: any): Promise<void> {
  const cfg = eng.cfg
  const st = eng.state
  const chat = msg.chat
  const sender = msg.sender
  const isSelf = sender && sender.id === eng.meId
  const text: string = msg.text ?? ''
  const chatType = chat?.type ?? ''

  eng.stats.received++
  eng.stats.lastActivity = Date.now()

  if (isSelf) {
    st.lastOut[chatKey(chat)] = Date.now()
    // دستورات چتی (بدون ربات هلپر!)
    if (cfg.commands.on) await handleChatCommand(eng, msg)
    return
  }

  // ---- ردیاب کلیدواژه ----
  if (cfg.watcher.on && cfg.watcher.keywords.length) {
    const kwHit = cfg.watcher.keywords.find(k => k && text.toLowerCase().includes(k.toLowerCase()))
    if (kwHit && (chatMatches(cfg.watcher.chats, chat) || cfg.watcher.chats.length === 0)) {
      const where = chat?.displayName ?? chatKey(chat)
      const who = sender?.displayName ?? chatKey(sender)
      eng.notify(`🔑 کلیدواژه «${kwHit}»`, `در «${where}» توسط ${who}: ${text.slice(0, 120)}`)
      if (cfg.watcher.notifyChat) {
        await safe(async () => {
          await sendSmart(eng, cfg.watcher.notifyChat, `🔑 «${kwHit}» — ${who} در «${where}»:\n${text.slice(0, 500)}`)
        }, eng, 'watcher')
      }
    }
  }

  // ---- فوروارد هوشمند ----
  if (cfg.forward.on) {
    for (const rule of cfg.forward.rules) {
      const from = rule.from.trim()
      const matches =
        from === '*' ||
        from.replace(/^@/, '').toLowerCase() === (chat?.username ?? '').toLowerCase() ||
        from === String(chat?.id) ||
        from === String(chat?.id?.toString?.().replace('-100', ''))
      if (!matches) continue
      if (rule.filter && !textMatches(rule.filter, text)) continue
      await safe(async () => {
        if (rule.delaySec > 0) await new Promise(r => setTimeout(r, Math.min(rule.delaySec, 300) * 1000))
        if (rule.mode === 'copy' && text) {
          await eng.client.sendText(rule.to, text)
          eng.stats.sent++
        } else {
          await eng.client.forwardMessages({ fromChat: chat, messages: [msg], toChatId: rule.to })
          eng.stats.forwarded++
        }
        eng.log('info', `فوروارد از «${chat?.displayName ?? from}» به «${rule.to}»`)
      }, eng, 'forward')
    }
  }

  // ---- ذخیره‌خودکار رسانه (Media Keeper) ----
  if (cfg.keeper.on && msg.media && cfg.keeper.types.includes(msg.media?.type) && chatMatches(cfg.keeper.chats, chat)) {
    const to = cfg.keeper.toChat === 'saved' || cfg.keeper.toChat === 'me' ? 'me' : cfg.keeper.toChat
    await safe(async () => {
      await eng.client.forwardMessages({ fromChat: chat, messages: [msg], toChatId: to })
      eng.stats.forwarded++
      eng.log('info', `ذخیره رسانه (${msg.media.type}) از «${chat?.displayName}»`)
    }, eng, 'keeper')
  }

  // ---- ضد اسپم گروه ----
  if (cfg.antispam.on && (chatType === 'group' || chatType === 'supergroup') && chatMatches(cfg.antispam.chats, chat)) {
    const hit = cfg.antispam.words.find(w => w && text.toLowerCase().includes(w.toLowerCase()))
    if (hit) {
      await safe(async () => {
        await eng.client.deleteMessages([msg], { revoke: true })
        eng.stats.deleted++
        if (cfg.antispam.action !== 'delete') {
          try {
            if (cfg.antispam.action === 'delete_kick') await eng.client.kickChatMember(chat, sender.id)
            else await eng.client.banChatMember(chat, sender.id)
          } catch {}
        }
        if (cfg.antispam.notifyPanel) eng.notify('🛡 ضداسپم', `پیام حاوی «${hit}» از ${sender?.displayName} حذف شد`)
        eng.log('warn', `حذف پیام اسپم (کلیدواژه «${hit}») از ${sender?.displayName}`)
      }, eng, 'antispam')
      return
    }
  }

  // ---- ری‌اکشن خودکار ----
  if (cfg.react.on && cfg.react.emojis.length && Math.random() * 100 < cfg.react.chance && chatMatches(cfg.react.chats, chat) && chatType !== 'channel') {
    const emoji = cfg.react.emojis[Math.floor(Math.random() * cfg.react.emojis.length)]
    await safe(async () => {
      await eng.client.sendReaction({ chat: chat, messageId: msg.id, emoji })
      eng.stats.reactions++
    }, eng, 'react')
  }

  // ---- خودخوان (Auto-read) ----
  const wantRead =
    !cfg.ghost.noRead &&
    ((cfg.autoread.pm && (chatType === 'user' || chatType === 'bot')) ||
      (cfg.autoread.groups && (chatType === 'group' || chatType === 'supergroup')) ||
      (cfg.autoread.channels && chatType === 'channel') ||
      (cfg.autoread.mentions && msg.isMention))
  if (wantRead) {
    await safe(async () => {
      await eng.client.readHistory(chat, { maxId: msg.id })
      eng.stats.reads++
    }, eng, 'autoread')
  }

  // ---- منشی هوشمند + AFK (فقط پی‌وی/گروه طبق تنظیم) ----
  const inPm = chatType === 'user' || chatType === 'bot'
  const inGroup = chatType === 'group' || chatType === 'supergroup'
  const scopeOk = (cfg.secretary.scope === 'pm' && inPm) || (cfg.secretary.scope === 'groups' && inGroup) || cfg.secretary.scope === 'both'
  const ignored = cfg.secretary.ignore.some(u => u.replace('@', '').toLowerCase() === (sender?.username ?? '').toLowerCase() || u === String(sender?.id))
  if (scopeOk && !ignored && !(sender?.type === 'bot')) {
    let replyText: string | null = null
    // ۱) کلیدواژه‌ها همیشه اولویت دارند
    for (const kw of cfg.secretary.keywords) {
      if (kw.k && text.toLowerCase().includes(kw.k.toLowerCase())) {
        replyText = kw.reply
        break
      }
    }
    // ۲) AFK
    if (!replyText && cfg.afk.on) {
      const key = chatKey(sender)
      const last = st.afkNotified[key] ?? 0
      if (Date.now() - last > 30 * 60 * 1000) {
        st.afkNotified[key] = Date.now()
        replyText = `⏰ ${cfg.afk.reason}`
        eng.notify('💤 پیام در غیاب', `${sender?.displayName}: ${text.slice(0, 100)}`)
      }
    }
    // ۳) حالت‌های منشی
    if (!replyText && cfg.secretary.on) {
      const key = chatKey(chat)
      if (cfg.secretary.mode === 'all') replyText = cfg.secretary.text
      else if (cfg.secretary.mode === 'first') replyText = st.seenPm[key] ? null : cfg.secretary.firstText || cfg.secretary.text
      else if (cfg.secretary.mode === 'offline') {
        const lastOut = st.lastOut[key] ?? 0
        if (Date.now() - lastOut > cfg.secretary.offlineAfterMin * 60 * 1000) replyText = cfg.secretary.text
      }
    }
    if (replyText) {
      st.seenPm[chatKey(chat)] = Date.now()
      await safe(async () => {
        await sendSmart(eng, chat, replyText!, msg.id)
        eng.stats.replies++
        eng.log('success', `پاسخ خودکار به ${sender?.displayName ?? chatKey(sender)}`)
      }, eng, 'secretary')
    }
  }
}

/* ---------------------------------------------------------------
 * رویداد عضو جدید گروه — خوش‌آمد
 * --------------------------------------------------------------- */
export async function handleMemberUpdate(eng: EngineHooks, upd: any): Promise<void> {
  const cfg = eng.cfg
  if (!cfg.welcome.on) return
  const t = upd?.type
  if (t !== 'joined' && t !== 'added') return
  const chat = upd.chat
  if (!chatMatches(cfg.welcome.chats, chat)) return
  const user = upd.user
  if (!user) return
  const key = `${chatKey(chat)}:${user.id}`
  const last = eng.state.welcomeSeen[key] ?? 0
  if (cfg.welcome.onlyNewUsers && Date.now() - last < 24 * 60 * 60 * 1000) return
  eng.state.welcomeSeen[key] = Date.now()
  await safe(async () => {
    const text = fillTemplate(cfg.welcome.text, { name: user.displayName ?? 'کاربر', username: user.username ?? '', id: String(user.id), chat: chat.displayName ?? '' })
    await eng.client.sendText(chat, text)
    eng.stats.sent++
    eng.log('info', `خوش‌آمد برای ${user.displayName} در «${chat.displayName}»`)
  }, eng, 'welcome')
}

/* ---------------------------------------------------------------
 * تیک دوره‌ای (alarm) — زمان‌بند، انبوه، جوینر، استوری، پروفایل
 * --------------------------------------------------------------- */
export async function runTick(eng: EngineHooks): Promise<void> {
  const cfg = eng.cfg
  const st = eng.state

  // محدودیت FloodWait فعال است؟ کارهای ارسالی را نگه دار
  const floodPaused = Date.now() < st.floodWaitUntil

  // ---- زمان‌بند ارسال ----
  if (cfg.schedule.jobs.length && !floodPaused) {
    for (const job of cfg.schedule.jobs) {
      if (job.next && Date.now() >= job.next) {
        await safe(async () => {
          await eng.client.sendText(job.chat, job.text)
          eng.stats.sent++
          job.last = Date.now()
          job.next = job.everyMin > 0 ? Date.now() + job.everyMin * 60_000 : 0
          eng.log('success', `زمان‌بند: ارسال به «${job.chat}»${job.everyMin ? ' (تکرارشونده)' : ' (تمام)'}`)
        }, eng, 'schedule')
        if (job.everyMin === 0) job.next = 0
      }
    }
  }

  // ---- پیام انبوه ----
  const dm = st.massdm
  if (dm?.active && !floodPaused) {
    // سقف روزانه
    const day = new Date().toISOString().slice(0, 10)
    if (dm.dayStamp !== day) {
      dm.dayStamp = day
      dm.dailySent = 0
    }
    let budget = Math.min(dm.perTick, dm.dailyCap - dm.dailySent)
    while (budget > 0 && dm.idx < dm.targets.length) {
      const target = dm.targets[dm.idx]
      try {
        if (eng.demo) {
          eng.log('success', `(نمایشی) پیام انبوه به ${target}`)
        } else {
          await eng.client.sendText(target, dm.text)
        }
        dm.sent++
        dm.dailySent++
        eng.stats.dms++
      } catch (e: any) {
        dm.errors++
        const fw = floodWaitSec(e)
        if (fw) {
          st.floodWaitUntil = Date.now() + fw * 1000
          eng.stats.floodWaits++
          dm.lastError = `FloodWait ${fw}s`
          eng.log('warn', `پیام انبوه متوقف شد: FloodWait ${fw}s`)
          break
        }
        dm.skipped.push(target)
        dm.lastError = String(e?.errorMessage ?? e?.message ?? e).slice(0, 120)
      }
      dm.idx++
      budget--
      if (budget > 0) await new Promise(r => setTimeout(r, dm.minDelayMs + Math.random() * (dm.maxDelayMs - dm.minDelayMs)))
    }
    if (dm.idx >= dm.targets.length || dm.dailySent >= dm.dailyCap) {
      dm.active = false
      eng.notify('📨 پیام انبوه تمام شد', `ارسال: ${dm.sent} | خطا: ${dm.errors} | سقف روزانه: ${dm.dailySent}/${dm.dailyCap}`)
    }
  }

  // ---- جوینر ----
  const jn = st.joiner
  if (jn?.active) {
    const perTick = 1
    for (let i = 0; i < perTick && jn.idx < jn.links.length; i++) {
      const link = jn.links[jn.idx]
      try {
        if (eng.demo) {
          eng.log('success', `(نمایشی) عضویت در ${link}`)
        } else {
          const l = link.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '')
          await eng.client.joinChat(l)
        }
        jn.joined++
        jn.results.push({ link, ok: true })
        eng.stats.joins++
      } catch (e: any) {
        jn.errors++
        jn.results.push({ link, ok: false, error: String(e?.errorMessage ?? e?.message ?? e).slice(0, 120) })
      }
      jn.idx++
      if (jn.idx < jn.links.length) await new Promise(r => setTimeout(r, jn.minDelayMs + Math.random() * (jn.maxDelayMs - jn.minDelayMs)))
    }
    if (jn.idx >= jn.links.length) {
      jn.active = false
      eng.notify('➕ جوینر تمام شد', `موفق: ${jn.joined} | ناموفق: ${jn.errors}`)
    }
  }

  // ---- ویو خودکار استوری ----
  if (cfg.stories.on && cfg.stories.peers.length && !floodPaused) {
    for (const peer of cfg.stories.peers.slice(0, 5)) {
      try {
        const stories = await eng.client.getPeerStories(peer)
        const ids = (stories?.stories ?? []).map((s: any) => s.id)
        const seen = st.storyViewed[peer] ?? []
        const fresh = ids.filter((id: number) => !seen.includes(id))
        if (fresh.length) {
          if (eng.demo) {
            eng.log('success', `(نمایشی) ویو ${fresh.length} استوری از ${peer}`)
          } else {
            await eng.client.incrementStoriesViews(peer, fresh)
          }
          st.storyViewed[peer] = [...seen, ...fresh].slice(-50)
          eng.stats.storyViews += fresh.length
        }
      } catch (e: any) {
        eng.log('warn', `استوری ${peer}: ${e?.errorMessage ?? e?.message ?? e}`)
      }
      await new Promise(r => setTimeout(r, cfg.stories.delaySec * 1000))
    }
  }

  // ---- اتوماسیون پروفایل (نام/بیوی زمان‌دار — بر اساس سورس پایه) ----
  const p = cfg.profile
  if (p.bioOn && p.bioList.length) {
    if (Date.now() >= p._nextBioAt) {
      p._lastBioIdx = (p._lastBioIdx + 1) % p.bioList.length
      const bio = fillTemplate(p.bioList[p._lastBioIdx]).slice(0, 70)
      await safe(async () => {
        if (eng.demo) eng.log('info', `(نمایشی) بیو جدید: ${bio}`)
        else await eng.client.updateProfile({ bio })
        eng.log('info', `بیو به‌روزرسانی شد: ${bio}`)
      }, eng, 'profile')
      p._nextBioAt = Date.now() + Math.max(1, p.bioEveryMin) * 60_000
    }
  }
  if (p.nameOn && p.nameTpl) {
    // نام فقط هر دقیقه آپدیت می‌شود (محدودیت تلگرام)
    if (Date.now() >= p._nextNameAt) {
      const me = st.me
      const base = (me?.displayName ?? 'من').split('|')[0].trim()
      const name = fillTemplate(p.nameTpl, { name: base }).slice(0, 64)
      await safe(async () => {
        if (eng.demo) eng.log('info', `(نمایشی) نام جدید: ${name}`)
        else await eng.client.updateProfile({ firstName: name })
      }, eng, 'profile')
      p._nextNameAt = Date.now() + 60_000
    }
  }

  // ---- حالت شبح: آفلاین به نظر رسیدن ----
  if (cfg.ghost.on && cfg.ghost.offline && !eng.demo) {
    try {
      await eng.client.call({ _: 'account.updateStatus', offline: true })
    } catch {}
  }
}

/* ---------------------------------------------------------------
 * دستورات چتی — بدون نیاز به هیچ رباتی
 * --------------------------------------------------------------- */
export async function handleChatCommand(eng: EngineHooks, msg: any): Promise<void> {
  const cfg = eng.cfg
  const p = cfg.commands.prefix || '.'
  const text: string = msg.text ?? ''
  if (!text.startsWith(p)) return
  const [cmd, ...rest] = text.slice(p.length).trim().split(/\s+/)
  const arg = rest.join(' ')
  const chat = msg.chat
  const replyThenDelete = async (t: string) => {
    const m = await sendSmart(eng, chat, t, msg.id)
    setTimeout(() => {
      void Promise.allSettled([
        eng.client.deleteMessages([msg], { revoke: true }),
        m?.id ? eng.client.deleteMessages([m], { revoke: true }) : Promise.resolve(),
      ])
    }, 15_000)
  }

  switch (cmd) {
    case 'ping': {
      const t0 = Date.now()
      await eng.client.resolvePeer('me').catch(() => {})
      await replyThenDelete(`🏓 پنگ! ${Date.now() - t0}ms — سلف فعال است`)
      break
    }
    case 'help':
      await replyThenDelete(
        ['🤖 SelfHub — دستورات سلف (بدون ربات هلپر):',
          `${p}ping — تست وضعیت`,
          `${p}stats — آمار اکانت`,
          `${p}id — شناسه این چت`,
          `${p}info — اطلاعات کاربر (ریپلای)`,
          `${p}afk [متن] — روشن کردن حالت غیبت`,
          `${p}afk off — خاموش کردن غیبت`,
          `${p}read — خواندن این چت`,
          `${p}purge [تعداد] — حذف پیام‌های من`,
          `${p}tagall [متن] — منشن همه اعضا`,
          `${p}join <لینک> — عضویت`,
          `${p}ghost on|off — حالت شبح`,
        ].join('\n'),
      )
      break
    case 'stats': {
      const s = eng.stats
      await replyThenDelete(
        `📊 آمار از ${new Date(st_startedAt(eng)).toLocaleString('fa-IR')}\n` +
          `📩 دریافت: ${s.received} | ارسال: ${s.sent}\n` +
          `💬 پاسخ خودکار: ${s.replies} | فوروارد: ${s.forwarded}\n` +
          `📨 پیام انبوه: ${s.dms} | عضویت: ${s.joins}\n` +
          `❤️ ری‌اکشن: ${s.reactions} | 📖 خواندن: ${s.reads}\n` +
          `⏳ FloodWait: ${s.floodWaits}`,
      )
      break
    }
    case 'id':
      await replyThenDelete(`🆔 این چت: \`${chat?.id}\`\n👤 من: \`${eng.meId}\``)
      break
    case 'info': {
      const target = msg.replyToMessage ? msg.replyToMessage : null
      const u = target?.sender ?? null
      await replyThenDelete(
        u
          ? `👤 ${u.displayName}\n🆔 ${u.id}\n🔀 @${u.username ?? '—'}\n🤖 ${u.isBot ? 'بله' : 'خیر'}`
          : 'روی پیام کاربر ریپلای کن تا اطلاعاتش را ببینی.',
      )
      break
    }
    case 'afk':
      if (arg === 'off') {
        cfg.afk.on = false
        eng.state.afkNotified = {}
        await replyThenDelete('✅ حالت غیبت خاموش شد')
      } else {
        cfg.afk.on = true
        cfg.afk.since = Date.now()
        if (arg) cfg.afk.reason = arg
        await replyThenDelete(`💤 حالت غیبت روشن شد: ${cfg.afk.reason}`)
      }
      break
    case 'read':
      await eng.client.readHistory(chat, { maxId: msg.id }).catch(() => {})
      await replyThenDelete('📖 خوانده شد')
      break
    case 'purge': {
      const n = Math.min(parseInt(arg || '50', 10) || 50, 500)
      await replyThenDelete(`🧹 حذف ${n} پیام آخر من از این چت...`)
      const hist = await eng.client.getHistory(chat, { limit: Math.min(n * 2, 200) })
      const mine = hist.filter((m: any) => m.sender?.id === eng.meId).slice(0, n)
      if (mine.length) {
        await eng.client.deleteMessages(mine, { revoke: true })
        eng.stats.deleted += mine.length
      }
      break
    }
    case 'tagall': {
      await replyThenDelete('📣 در حال منشن کردن اعضا...')
      const members = await eng.client.getChatMembers(chat, { limit: 200 })
      const list = members.filter((m: any) => m.user && !m.user.isBot)
      for (let i = 0; i < list.length; i += 20) {
        const chunk = list.slice(i, i + 20)
        const text = arg || '👋'
        const entities: any[] = []
        let cursor = text.length + 1
        const parts = chunk.map((m: any) => {
          const label = `@${m.user.username ?? m.user.displayName ?? m.user.id}`
          entities.push({ _: 'messageEntityMentionName', offset: cursor, length: label.length, userId: m.user.id })
          cursor += label.length + 1
          return label
        })
        await eng.client.sendText(chat, { text: `${text}\n${parts.join(' ')}`, entities })
        eng.stats.sent++
        await new Promise(r => setTimeout(r, 2500))
      }
      break
    }
    case 'join':
      if (arg) {
        try {
          await eng.client.joinChat(arg.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, ''))
          eng.stats.joins++
          await replyThenDelete(`✅ عضو شدم: ${arg}`)
        } catch (e: any) {
          await replyThenDelete(`❌ ${e?.errorMessage ?? e?.message}`)
        }
      }
      break
    case 'ghost':
      cfg.ghost.on = arg === 'on'
      await replyThenDelete(cfg.ghost.on ? '👻 حالت شبح روشن شد' : '👁 حالت شبح خاموش شد')
      break
    default:
      break
  }
}

function st_startedAt(eng: EngineHooks): number {
  return eng.state.startedAt || Date.now()
}
