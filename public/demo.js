/* SelfHub — داده‌ی نمایشی (حالت دمو)
 * وقتی توکن واقعی ندارید، کل پنل با همین داده‌ها کار می‌کند:
 * نه سروری لازم است نه اکانت تلگرام. تغییرات فقط در همان نشست مرورگر می‌مانند.
 */
;(function () {
  'use strict'

  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  const rnd = (min, max) => Math.floor(min + Math.random() * (max - min))

  function settingsFor(chat) {
    return {
      title: chat.title,
      type: chat.type,
      moderation: true,
      adminOnlyCommands: true,
      autoreply: true,
      welcome: true,
      welcomeText: 'خوش آمدی {name} 🌸\nقبل از سؤال، قاعده‌ها را با /rules بخوان.\nعضو {count}م گروه هستی.',
      leaveMsg: false,
      rulesText: '۱. احترام متقابل.\n۲. اسپم، لینک تبلیغاتی و تبلیغ ارز نه.\n۳. موضوع چت را نگه‌دار.\n۴. برای مسئلهٔ شخصی به ادمین پیام خصوصی نده.',
      captcha: chat.id === -100123,
      captchaTimeoutMin: 10,
      flood: { on: true, windowSec: 8, max: 6, action: 'delete', muteMin: 5 },
      words: { on: true, patterns: ['کلاهبرداری', 'فروش فالوور', 'ارز دیجیتال*'], action: 'warn', muteMin: 30 },
      links: { on: true, allowInvite: false, allowOwnChannel: true, action: 'delete' },
      caps: { on: false, minChars: 12, maxRatio: 0.7, action: 'delete' },
      media: { on: chat.id === -100456, blocked: chat.id === -100456 ? ['sticker', 'animation'] : [] },
      duplicate: { on: true, windowSec: 30, max: 3, action: 'delete' },
      joinBan: { on: false, namePatterns: ['airdrop', 'crypto', 'regex:^bot_\\d+$'] },
      length: { on: false, maxChars: 1500, action: 'delete' },
      warnLimit: 3,
      warnAction: 'mute',
      warnActionMuteMin: 60,
      broadcast: chat.broadcast,
      logChatId: -100999,
      ...chat.extra,
    }
  }

  const chats = [
    { id: -100123, title: 'انجمن برنامه‌نویسان', type: 'supergroup', members: 4820, broadcast: true, active: true, updatedAt: Date.now() - 60000 },
    { id: -100456, title: 'گروه خانوادگی', type: 'group', members: 34, broadcast: false, active: true, updatedAt: Date.now() - 3600000 },
    { id: -100789, title: 'کانال announcements', type: 'channel', members: 1203, broadcast: true, active: true, updatedAt: Date.now() - 7200000 },
    { id: -100999, title: 'لاگ مدیریتی', type: 'channel', members: 3, broadcast: false, active: true, updatedAt: Date.now() - 8000000 },
    { id: 48210, title: 'پی‌وی مالک', type: 'private', members: 1, broadcast: true, active: true, updatedAt: Date.now() - 600000 },
  ]

  const store = {
    chats,
    settings: new Map(chats.map((c) => [c.id, settingsFor(c)])),
    keywords: [
      { id: 1, chatId: -100123, pattern: 'سلام', reply: 'سلام {name} 👋 برای سؤال فنی از #faq استفاده کن.', mode: 'contains', enabled: true, hits: 421 },
      { id: 2, chatId: -100123, pattern: 'سورس', reply: 'منابع آموزشی: #resources', mode: 'contains', enabled: true, hits: 88 },
      { id: 3, chatId: -100123, pattern: 'regex:^(کد|api)\\s*چنده', reply: 'لطفاً سؤال را کامل‌تر بپرس 🙏', mode: 'regex', enabled: false, hits: 3 },
    ],
    notes: [
      { chatId: -100123, name: 'قوانین', text: 'قاعده‌های گروه:\n• احترام\n• بدون تبلیغ\n• سؤال فنی با کد', createdBy: 48210, createdAt: Date.now() - 8e8, hits: 312 },
      { chatId: -100123, name: 'faq', text: 'راهنمای شروع: https://example.com/start', createdBy: 48210, createdAt: Date.now() - 5e8, hits: 940 },
      { chatId: -100123, name: 'resources', text: 'کتاب و دوره: لینک‌ها در پین شدهٔ گروه', createdBy: 48210, createdAt: Date.now() - 3e8, hits: 74 },
    ],
    jobs: [
      { id: 11, chatId: -100123, text: '📢 نشست هفتگی ساعت ۲۰ شروع می‌شود', at: Math.floor(Date.now() / 1000) + 3600, everyMin: 0, enabled: true, note: 'از پنل', createdBy: 0, lastSent: 0, sentCount: 0 },
      { id: 12, chatId: -100789, text: '🌙 یادآوری: گزارش روزانه را ثبت کنید', at: Math.floor(Date.now() / 1000) + 7200, everyMin: 1440, enabled: true, note: 'تکراری', createdBy: 0, lastSent: Math.floor(Date.now() / 1000) - 80000, sentCount: 12 },
      { id: 13, chatId: 48210, text: '💧 آب بخور', at: Math.floor(Date.now() / 1000) + 900, everyMin: 60, enabled: false, note: 'یادآور شخصی', createdBy: 48210, lastSent: 0, sentCount: 4 },
    ],
    modlog: [
      { id: 30, chatId: -100123, action: 'حذف خودکار', targetId: 771203, targetName: '@promo_king', moderator: 'خودکار', reason: 'لینک: t.me/+AbCdEf', ts: Date.now() - 12 * 60000 },
      { id: 29, chatId: -100123, action: 'سکوت', targetId: 551002, targetName: '@spam_bot2', moderator: 'خودکار', reason: 'فلود: ۹ پیام در ۸ ثانیه', ts: Date.now() - 40 * 60000 },
      { id: 28, chatId: -100456, action: 'اخطار', targetId: 330011, targetName: '@reza', moderator: 'خودکار', reason: 'کلمات ممنوعه: فروش فالوور', ts: Date.now() - 3 * 3600000 },
      { id: 27, chatId: -100123, action: 'بن', targetId: 991122, targetName: 'Airdrop Hunter', moderator: 'خودکار', reason: 'نام مشکوک: airdrop', ts: Date.now() - 5 * 3600000 },
      { id: 26, chatId: -100123, action: 'پاک‌سازی', targetId: null, targetName: '', moderator: '@admin', reason: '۲۴ پیام', ts: Date.now() - 9 * 3600000 },
    ],
    events: [
      { id: 9, ts: Date.now() - 30000, level: 'info', msg: 'فعال شد در «کانال announcements» — نقش: administrator', chatId: -100789 },
      { id: 8, ts: Date.now() - 90000, level: 'warn', msg: '[-100123] اقدام سکوت روی @spam_bot2 — فلود', chatId: -100123 },
      { id: 7, ts: Date.now() - 200000, level: 'success', msg: '[-100123] تأیید انسانی: @new_guy', chatId: -100123 },
      { id: 6, ts: Date.now() - 400000, level: 'error', msg: '429 از تلگرام — retry_after 6 ثانیه', chatId: null },
    ],
  }

  function statsRows(chatId, days) {
    const out = []
    const base = chatId === -100123 ? 900 : chatId === -100456 ? 40 : chatId ? 200 : 60
    for (let i = days - 1; i >= 0; i--) {
      const factor = new Date(Date.now() - i * 86400000).getUTCDay() === 5 ? 0.6 : 1
      out.push({
        day: day(-i),
        msgs: Math.round(base * factor + rnd(-40, 120)),
        members: rnd(-3, 14),
        deleted: rnd(0, 9),
        warns: rnd(0, 3),
        mutes: rnd(0, 2),
        bans: rnd(0, 1),
        replies: rnd(2, 40),
        commands: rnd(0, 18),
      })
    }
    if (chatId === null) {
      const merged = new Map()
      for (const c of store.chats) {
        for (const r of statsRows(c.id, days)) {
          const cur = merged.get(r.day) || { day: r.day, msgs: 0, members: 0, deleted: 0, warns: 0, mutes: 0, bans: 0, replies: 0, commands: 0 }
          for (const k of ['msgs', 'members', 'deleted', 'warns', 'mutes', 'bans', 'replies', 'commands']) cur[k] += r[k]
          merged.set(r.day, cur)
        }
      }
      return [...merged.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
    }
    return out
  }

  function hourly() {
    const nowH = Math.floor(Date.now() / 3600000)
    const out = []
    for (let i = 47; i >= 0; i--) {
      const h = (nowH - i) % 24
      const night = h < 7
      out.push({ hour: nowH - i, msgs: night ? rnd(5, 40) : rnd(80, 320) })
    }
    return out
  }

  const nextId = () => Math.max(0, ...store.keywords.map((k) => k.id), ...store.jobs.map((j) => j.id)) + rnd(1, 9)

  function info() {
    return {
      ok: true,
      installed: true,
      authed: true,
      version: '2.0.0',
      createdAt: Date.now() - 86400000 * 23,
      lastError: null,
      panelUrl: 'https://selfhub.example.workers.dev',
      me: { id: 6612004, username: 'selfhub_demo_bot', first_name: 'SelfHub (نمایشی)', can_read_all_group_messages: false },
      webhook: { url: 'https://selfhub.example.workers.dev/webhook/demo-secret', is_running: true, pending_update_count: 0, last_error_message: '', has_secret: true },
      chats: store.chats.length,
      subscribers: store.chats.filter((c) => c.broadcast).length,
      commands: 33,
      lastUpdateId: 842193,
    }
  }

  const totalOf = (rows) => rows.reduce((a, r) => ({ msgs: a.msgs + r.msgs, members: a.members + r.members, deleted: a.deleted + r.deleted, warns: a.warns + r.warns, mutes: a.mutes + r.mutes, bans: a.bans + r.bans, replies: a.replies + r.replies, commands: a.commands + r.commands, days: rows.length, avgMsgsPerDay: 0 }), { msgs: 0, members: 0, deleted: 0, warns: 0, mutes: 0, bans: 0, replies: 0, commands: 0, days: 0, avgMsgsPerDay: 0 })

  async function demoApi(path, opts) {
    await new Promise((r) => setTimeout(r, 90))
    opts = { ...(opts || {}), method: (opts && opts.method) || 'GET' }
    const url = new URL(path, 'http://x')
    const p = url.pathname
    const num = (v, d) => (v === null || Number.isNaN(Number(v)) ? d : Number(v))
    const key = `${opts?.method || 'GET'} ${p}`

    if (p === '/api/state' || p === '/api/health') return info()
    if (p === '/api/login' || p === '/api/logout') return { ok: true }

    if (p === '/api/overview') {
      const days = num(url.searchParams.get('days'), 14)
      const rows = statsRows(null, days)
      const h = hourly()
      const seriesVals = rows.map((r) => r.msgs)
      return {
        ok: true,
        totals: { ...totalOf(rows), avgMsgsPerDay: Math.round(rows.reduce((s, r) => s + r.msgs, 0) / (rows.length || 1)) },
        series: { labels: rows.map((r) => r.day.slice(5)), values: seriesVals, max: Math.max(1, ...seriesVals), sum: seriesVals.reduce((a, b) => a + b, 0) },
        growth: (() => {
          const half = Math.max(1, Math.floor(rows.length / 2))
          const nowV = rows.slice(-half).reduce((s, r) => s + r.msgs, 0)
          const prevV = rows.slice(-half * 2, -half).reduce((s, r) => s + r.msgs, 0) || 1
          const pct = Math.round(((nowV - prevV) / prevV) * 100)
          return { pct, dir: pct > 2 ? 'up' : pct < -2 ? 'down' : 'flat', now: nowV, prev: prevV }
        })(),
        hourly: { labels: h.map((x) => String(((x.hour % 24) + 24) % 24).padStart(2, '0')), values: h.map((x) => x.msgs), max: Math.max(1, ...h.map((x) => x.msgs)), sum: h.reduce((a, b) => a + b.msgs, 0) },
        chats: store.chats.map((c) => ({ id: c.id, title: c.title, type: c.type, members: c.members })),
        top: store.chats.map((c) => ({ chat: { id: c.id, title: c.title, members: c.members }, t: totalOf(statsRows(c.id, days)) })),
        events: store.events,
      }
    }

    if (p === '/api/chats') {
      return { ok: true, chats: store.chats.map((c) => ({ ...c, settings: store.settings.get(c.id) })) }
    }

    const chatM = p.match(/^\/api\/chats\/(-?\d+)(\/.*)?$/)
    if (chatM) {
      const id = Number(chatM[1])
      const sub = chatM[2] || ''
      const st = () => store.settings.get(id) || settingsFor({ id, title: String(id), type: 'supergroup' })
      const rows = statsRows(id, 30)
      if (opts.method === 'PUT' && sub === '/settings') {
        const merged = { ...st(), ...JSON.parse(opts.body) }
        store.settings.set(id, merged)
        return { ok: true, settings: merged }
      }
      if (sub === '/keywords' && opts.method === 'POST') {
        const b = JSON.parse(opts.body)
        store.keywords.push({ id: nextId(), chatId: id, pattern: b.pattern, reply: b.reply, mode: b.mode || 'contains', enabled: b.enabled !== false, hits: 0 })
        return { ok: true, keywords: store.keywords.filter((k) => k.chatId === id) }
      }
      const kwDel = sub.match(/^\/keywords\/(\d+)$/)
      if (kwDel && opts.method === 'DELETE') {
        const i = store.keywords.findIndex((k) => k.id === Number(kwDel[1]))
        if (i >= 0) store.keywords.splice(i, 1)
        return { ok: true }
      }
      if (sub === '/notes' && opts.method === 'POST') {
        const b = JSON.parse(opts.body)
        store.notes = store.notes.filter((n) => !(n.chatId === id && n.name === b.name))
        store.notes.push({ chatId: id, name: b.name, text: b.text, createdBy: 0, createdAt: Date.now(), hits: 0 })
        return { ok: true, notes: store.notes.filter((n) => n.chatId === id) }
      }
      const noteDel = sub.match(/^\/notes\/(.+)$/)
      if (noteDel && opts.method === 'DELETE') {
        store.notes = store.notes.filter((n) => !(n.chatId === id && n.name === decodeURIComponent(noteDel[1])))
        return { ok: true }
      }
      if (sub === '/test' && opts.method === 'POST') {
        const text = (JSON.parse(opts.body).text || '').toLowerCase()
        const s = st()
        const hit = (s.words.patterns || []).find((w) => text.includes(String(w).toLowerCase().replace(/\*/g, '')))
        return { ok: true, chatId: id, wouldDelete: !!hit && s.words.on, action: hit ? (s.words.action === 'warn' ? 'warn' : 'delete') : 'none', reasons: hit ? [`کلمات ممنوعه: ${hit}`] : [] }
      }
      if (opts.method === 'GET') {
        return {
          ok: true,
          settings: st(),
          keywords: store.keywords.filter((k) => k.chatId === id),
          notes: store.notes.filter((n) => n.chatId === id),
          jobs: store.jobs.filter((j) => j.chatId === id),
          modlog: store.modlog.filter((m) => m.chatId === id),
          stats: totalOf(rows),
        }
      }
    }

    if (p === '/api/schedule') {
      if (opts.method === 'POST') {
        const b = JSON.parse(opts.body)
        const j = { id: nextId(), chatId: b.chatId, text: b.text, at: Math.floor(Date.now() / 1000) + 3600, everyMin: /every|هر/.test(b.when || '') ? 1800 : 0, enabled: true, note: 'از پنل (دمو)', createdBy: 0, lastSent: 0, sentCount: 0 }
        store.jobs.push(j)
        return { ok: true, job: j }
      }
      return { ok: true, jobs: store.jobs }
    }
    const jobRun = p.match(/^\/api\/schedule\/(\d+)\/run$/)
    if (jobRun) return { ok: true, sent: 1 }
    const jobDel = p.match(/^\/api\/schedule\/(\d+)$/)
    if (jobDel && opts.method === 'DELETE') {
      store.jobs = store.jobs.filter((j) => j.id !== Number(jobDel[1]))
      return { ok: true }
    }

    if (p === '/api/modlog') return { ok: true, rows: store.modlog }
    if (p === '/api/global') {
      if (opts.method === 'PUT') return { ok: true, global: JSON.parse(opts.body) }
      return {
        ok: true,
        global: {
          tzOffsetMin: 210,
          admins: [48210],
          defaults: settingsFor({ id: 0, title: '', type: 'supergroup' }),
          broadcastMaxPerTick: 20,
          broadcastGapMs: 120,
          helpFooter: 'SelfHub — پنل ربات تلگرام',
        },
      }
    }
    if (p === '/api/broadcast') {
      const b = JSON.parse(opts.body)
      const list = store.chats.filter((c) => c.broadcast)
      if (b.dryRun) return { ok: true, preview: list.length, text: b.text }
      return { ok: true, sent: list.length, total: list.length, left: 0 }
    }
    if (p.startsWith('/api/security/') || p === '/api/danger/wipe') return { ok: true }
    if (p === '/api/export') return { ok: true, dump: { version: 1, exportedAt: Date.now(), chats: [...store.settings.entries()].map(([id, settings]) => ({ id, settings })), keywords: store.keywords, notes: store.notes, schedule: store.jobs } }
    if (p === '/api/stats.csv') return 'day,msgs,members,deleted,warns,mutes,bans,replies,commands\n' + statsRows(null, 30).map((r) => [r.day, r.msgs, r.members, r.deleted, r.warns, r.mutes, r.bans, r.replies, r.commands].join(',')).join('\n')

    return { ok: true }
  }

  window.DEMO = { api: demoApi, info, store }
})()
