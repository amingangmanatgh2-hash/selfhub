/* SelfHub — پنل وب (Vanilla JS، بدون فریمورک، RTL)
 * ساختار: boot → (setup | login | panel) و روتر هش‌محور.
 * حالت نمایشی: اگر localStorage.selfhub_demo=1 باشد همه‌ی درخواست‌ها از demo.js می‌آیند.
 */
'use strict'

const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]
const app = $('#app')

const State = {
  demo: localStorage.getItem('selfhub_demo') === '1',
  info: null,
  overview: null,
  chat: null,
  tab: 'dash',
  es: null,
}

/* ---------------- ابزارها ---------------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fa = (s) => String(s ?? '').replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d])
const num = (n) => fa(Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, '٬'))
const nz = (v, d = '—') => (v === undefined || v === null || v === '' ? d : esc(v))
const dash = (v) => (v ? esc(v) : '—')

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${fa(s)} ثانیه پیش`
  if (s < 3600) return `${fa(Math.floor(s / 60))} دقیقه پیش`
  if (s < 86400) return `${fa(Math.floor(s / 3600))} ساعت پیش`
  return `${fa(Math.floor(s / 86400))} روز پیش`
}

function clock(tsSec) {
  const d = new Date(tsSec * 1000 + 210 * 60000)
  const p = (n) => String(n).padStart(2, '0')
  return fa(`${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`)
}

async function api(path, opts = {}) {
  if (State.demo) {
    const method = opts.method || (opts.body ? 'POST' : 'GET')
    const r = await window.DEMO.api(path, { method, body: opts.body ? JSON.stringify(opts.body) : undefined })
    if (typeof r === 'string') return r
    return r
  }
  const method = opts.method || (opts.body ? 'POST' : 'GET')
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-selfhub': '1' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  })
  if (res.status === 401 && !path.includes('/login')) {
    toast('نشست تمام شد؛ دوباره وارد شوید', 'err')
    State.info = { ...State.info, authed: false }
    renderLogin()
    throw new Error('unauthorized')
  }
  const ct = res.headers.get('content-type') || ''
  const data = ct.includes('json') ? await res.json() : await res.text()
  if (!res.ok && data && typeof data === 'object' && data.error) {
    toast(data.error, 'err')
    throw new Error(data.error)
  }
  return data
}

function toast(msg, kind = '') {
  const t = document.createElement('div')
  t.className = `toast ${kind}`
  t.textContent = msg
  $('#toasts').appendChild(t)
  setTimeout(() => t.remove(), 4600)
}

/* نمودار خطی SVG — همان منطق sparkPath سمت سرور */
function line(values, w = 640, h = 96, pad = 4) {
  if (!values.length) return ''
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0
  const pts = values.map((v, i) => [pad + i * step, pad + (h - pad * 2) - ((v - min) / span) * (h - pad * 2)])
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${d} L${pts.at(-1)[0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z`
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="نمودار">
    <path class="fill" d="${area}"/><path d="${d}"/></svg>`
}

function barsHtml(values) {
  const max = Math.max(...values, 1)
  return `<div class="bars">${values.map((v) => `<i style="height:${Math.max(3, Math.round((v / max) * 100))}%" title="${fa(v)}"></i>`).join('')}</div>`
}

/* ---------------- اجزای فرم ---------------- */

const FORM = [
  {
    g: 'رفتار ربات',
    f: [
      { k: 'moderation', t: 'sw', l: 'مدیریت و فیلتر پیام‌ها' },
      { k: 'adminOnlyCommands', t: 'sw', l: 'دستورات مدیریتی فقط برای ادمین‌ها' },
      { k: 'autoreply', t: 'sw', l: 'پاسخ خودکار به کلیدواژه‌ها' },
      { k: 'welcome', t: 'sw', l: 'خوش‌آمدگویی به عضو تازه' },
      { k: 'welcomeText', t: 'area', l: 'متن خوش‌آمد', hint: 'متغیرها: {name} {first} {username} {group} {count} {time} {date}' },
      { k: 'rulesText', t: 'area', l: 'قاعده‌ها (با /rules نشان داده می‌شود)', hint: '' },
      { k: 'leaveMsg', t: 'sw', l: 'پیام هنگام خروج عضو' },
      { k: 'logChatId', t: 'num', l: 'شناسه چت لاگ مدیریتی', hint: 'مثلاً -1001234567890 — خالی = خاموش' },
    ],
  },
  {
    g: 'فلود و تکرار',
    f: [
      { k: 'flood.on', t: 'sw', l: 'ضدفلود' },
      { k: 'flood.windowSec', t: 'num', l: 'پنجره (ثانیه)', min: 2, max: 600 },
      { k: 'flood.max', t: 'num', l: 'حداکثر پیام در پنجره', min: 2, max: 100 },
      { k: 'flood.action', t: 'act', l: 'اقدام' },
      { k: 'flood.muteMin', t: 'num', l: 'مدت سکوت (دقیقه)', min: 0, max: 43200 },
      { k: 'duplicate.on', t: 'sw', l: 'ضدتکرار' },
      { k: 'duplicate.windowSec', t: 'num', l: 'پنجره‌ی تکرار (ثانیه)', min: 5, max: 3600 },
      { k: 'duplicate.max', t: 'num', l: 'تکرار مجاز', min: 2, max: 50 },
      { k: 'duplicate.action', t: 'act', l: 'اقدام' },
    ],
  },
  {
    g: 'محتوا',
    f: [
      { k: 'words.on', t: 'sw', l: 'کلمات/عبارات ممنوعه' },
      { k: 'words.patterns', t: 'chips', l: 'الگوها', hint: '* به‌عنوان هرچیز کار می‌کند؛ با regex: شروع کنید تا regex خام باشد' },
      { k: 'words.action', t: 'act', l: 'اقدام' },
      { k: 'words.muteMin', t: 'num', l: 'مدت سکوت (دقیقه)', min: 0, max: 43200 },
      { k: 'links.on', t: 'sw', l: 'فیلتر لینک' },
      { k: 'links.allowOwnChannel', t: 'sw', l: 'لینک به همین کانال/گروه مجاز' },
      { k: 'links.allowInvite', t: 'sw', l: 'لینک دعوت (t.me/+…) مجاز' },
      { k: 'links.action', t: 'act', l: 'اقدام' },
      { k: 'length.on', t: 'sw', l: 'سقف طول پیام' },
      { k: 'length.maxChars', t: 'num', l: 'حداکثر نویسه', min: 20, max: 4096 },
      { k: 'length.action', t: 'act', l: 'اقدام' },
      { k: 'caps.on', t: 'sw', l: 'ضد بزرگ‌نویسی افراطی' },
      { k: 'caps.minChars', t: 'num', l: 'از چند نویسه بررسی شود', min: 2, max: 500 },
      { k: 'caps.maxRatio', t: 'num', l: 'سقف نسبت حروف بزرگ (۰ تا ۱)', min: 0.05, max: 1, step: 0.05 },
      { k: 'caps.action', t: 'act', l: 'اقدام' },
      { k: 'media.on', t: 'sw', l: 'محدودیت نوع رسانه' },
      { k: 'media.blocked', t: 'media', l: 'رسانه‌های ممنوع' },
    ],
  },
  {
    g: 'تأیید انسانی و اخطار',
    f: [
      { k: 'captcha', t: 'sw', l: 'کپچای «من ربات نیستم» برای عضو تازه' },
      { k: 'captchaTimeoutMin', t: 'num', l: 'مهلت تأیید (دقیقه)', min: 1, max: 240 },
      { k: 'joinBan.on', t: 'sw', l: 'بن خودکار بر اساس نام مشکوک' },
      { k: 'joinBan.namePatterns', t: 'chips', l: 'الگوهای نام/یوزرنیم' },
      { k: 'warnLimit', t: 'num', l: 'سقف اخطار (۰ = بدون تنبیه نهایی)', min: 0, max: 20 },
      { k: 'warnAction', t: 'act', l: 'بعد از سقف' },
      { k: 'warnActionMuteMin', t: 'num', l: 'مدت سکوت بعد از سقف', min: 0, max: 43200 },
    ],
  },
]

const ACTS = [['none', 'فقط حذف نبودن'], ['delete', 'حذف'], ['warn', 'اخطار'], ['mute', 'سکوت'], ['kick', 'اخراج'], ['ban', 'بن']]
const MEDIA = ['photo', 'sticker', 'document', 'video', 'voice', 'audio', 'animation', 'video_note', 'contact', 'location', 'venue', 'poll', 'dice']

const getPath = (o, k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), o)
const setPath = (o, k, v) => {
  const parts = k.split('.')
  let cur = o
  for (const p of parts.slice(0, -1)) cur = cur[p] ??= {}
  cur[parts.at(-1)] = v
}

function fieldHtml(cfg, st) {
  const v = getPath(st, cfg.k)
  const id = `f_${cfg.k.replace(/\W/g, '_')}`
  if (cfg.t === 'sw')
    return `<label class="switch"><input type="checkbox" id="${id}" data-k="${cfg.k}" ${v ? 'checked' : ''}/> ${esc(cfg.l)}</label>`
  if (cfg.t === 'act')
    return `<label for="${id}">${esc(cfg.l)}</label><select id="${id}" data-k="${cfg.k}">${ACTS.map(([a, l]) => `<option value="${a}" ${v === a ? 'selected' : ''}>${l}</option>`).join('')}</select>`
  if (cfg.t === 'num')
    return `<label for="${id}">${esc(cfg.l)}</label><input id="${id}" type="number" step="${cfg.step || 1}" min="${cfg.min ?? ''}" max="${cfg.max ?? ''}" data-k="${cfg.k}" value="${v ?? ''}"/>${cfg.hint ? `<div class="hint">${esc(cfg.hint)}</div>` : ''}`
  if (cfg.t === 'area')
    return `<label for="${id}">${esc(cfg.l)}</label><textarea id="${id}" data-k="${cfg.k}" rows="4">${esc(v ?? '')}</textarea>${cfg.hint ? `<div class="hint">${esc(cfg.hint)}</div>` : ''}`
  if (cfg.t === 'chips')
    return `<label>${esc(cfg.l)}</label><div class="chips" data-k="${cfg.k}" data-t="chips">${(v || []).map((x) => `<span class="chip">${esc(x)}<button type="button" data-del="${esc(x)}" title="حذف">×</button></span>`).join('') || '<span class="hint">موردی نیست</span>'}</div><div class="row"><input class="grow" placeholder="افزودن و Enter" data-add="${cfg.k}"/></div>${cfg.hint ? `<div class="hint">${esc(cfg.hint)}</div>` : ''}`
  if (cfg.t === 'media')
    return `<label>${esc(cfg.l)}</label><div class="chips">${MEDIA.map((m) => `<label class="switch"><input type="checkbox" data-media="${m}" ${(v || []).includes(m) ? 'checked' : ''}/> <code>${m}</code></label>`).join('')}</div>`
  return `<label for="${id}">${esc(cfg.l)}</label><input id="${id}" data-k="${cfg.k}" value="${esc(v ?? '')}"/>`
}

async function collectForm(root, base) {
  const out = structuredClone(base)
  $$('[data-k]', root).forEach((el) => {
    const k = el.dataset.k
    if (el.dataset.t === 'chips') {
      // اگر کاربر چیزی کم/زیاد کرده باشد آرایه‌ی تازه در خود عنصر نگه داشته می‌شود
      if (Array.isArray(el._vals)) setPath(out, k, el._vals)
      return
    }
    if (el.type === 'checkbox') setPath(out, k, el.checked)
    else if (el.type === 'number') setPath(out, k, el.value === '' ? 0 : Number(el.value))
    else setPath(out, k, el.value)
  })
  const blocked = $$('[data-media]', root).filter((el) => el.checked).map((el) => el.dataset.media)
  if (out.media) out.media.blocked = blocked
  return out
}

function wireChips(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]')
    if (!b) return
    const chip = b.closest('.chip')
    const host = chip.parentElement
    const key = host.dataset.k
    const list = (host._vals ||= []).filter((x) => x !== b.dataset.del)
    host._vals = list
    renderChips(host, key)
  })
  root.addEventListener('keydown', (e) => {
    const inp = e.target.closest('[data-add]')
    if (!inp || e.key !== 'Enter') return
    e.preventDefault()
    const host = $$('.chips', root).find((h) => h.dataset.k === inp.dataset.add)
    const v = inp.value.trim()
    if (!v || !host) return
    host._vals = [...new Set([...(host._vals ?? getPath(State.chat?.settings, inp.dataset.add) ?? []), v])]
    inp.value = ''
    renderChips(host, inp.dataset.add)
  })
}

function renderChips(host, key) {
  const vals = host._vals ?? []
  host.innerHTML = vals.length ? vals.map((x) => `<span class="chip">${esc(x)}<button type="button" data-del="${esc(x)}">×</button></span>`).join('') : '<span class="hint">موردی نیست</span>'
  host.dataset.k = key
}

/* ---------------- صفحه‌ها ---------------- */

function renderSetup() {
  app.className = ''
  app.innerHTML = `<div class="gate"><div class="card">
    <div class="brand"><div class="mark">🐾</div><div><b>SelfHub</b><small>ربات مدیریت گروه و کانال تلگرام</small></div></div>
    <h3 style="margin-top:14px">راه‌اندازی</h3>
    <p class="sub">فقط به توکن ربات از <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> نیاز دارد. ربات هلپر، API Hash، سرور و اتصال دائمی لازم نیست.</p>
    <label>توکن ربات</label>
    <input id="su-token" class="dir-ltr" placeholder="123456789:AA…" autocomplete="off"/>
    <label>رمز عبور پنل (حداقل ۱۰ نویسه)</label>
    <input id="su-pw" class="dir-ltr" type="password" placeholder="••••••••••"/>
    <div class="row" style="margin-top:6px">${[1, 2, 3, 4, 5].map((i) => `<i style="flex:1;height:4px;border-radius:4px;background:var(--line)" data-bar="${i}"></i>`).join('')}</div>
    <label class="switch" style="margin-top:10px"><input type="checkbox" id="su-privacy"/> از قبل در @BotFather → /setprivacy را خاموش کرده‌ام</label>
    <div class="row" style="margin-top:16px">
      <button class="btn primary" id="su-go">نصب و اتصال ربات</button>
      <button class="btn" id="su-demo">مشاهده با دادهٔ نمایشی</button>
    </div>
    <p class="hint" style="margin-top:14px">پس از نصب، وب‌هوک ربات خودکار روی همین آدرس ست می‌شود. اگر <code>Privacy Mode</code> روشن بماند، ربات پیام‌های معمولی گروه را نمی‌بیند و مدیریت کار نمی‌کند.</p>
  </div></div>`
  const pw = $('#su-pw')
  pw.addEventListener('input', () => {
    const v = pw.value
    const score = Math.min(5, (v.length >= 10 ? 1 : 0) + (v.length >= 14 ? 1 : 0) + (/[a-z]/.test(v) && /[A-Z]/.test(v) ? 1 : 0) + (/\d/.test(v) ? 1 : 0) + (/[^a-zA-Z0-9]/.test(v) ? 1 : 0))
    $$('[data-bar]').forEach((el) => (el.style.background = +el.dataset.bar <= score ? 'var(--ok)' : 'var(--line)'))
  })
  $('#su-go').addEventListener('click', async () => {
    const token = $('#su-token').value.trim()
    const password = pw.value
    if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) return toast('قالب توکن درست نیست', 'err')
    if (password.length < 10) return toast('رمز حداقل ۱۰ نویسه', 'err')
    $('#su-go').disabled = true
    try {
      await api('/api/setup', { method: 'POST', body: { token, password } })
      toast('نصب شد ✅', 'ok')
      await boot(true)
    } catch {
      $('#su-go').disabled = false
    }
  })
  $('#su-demo').addEventListener('click', () => {
    localStorage.setItem('selfhub_demo', '1')
    location.reload()
  })
}

function renderLogin() {
  app.className = ''
  app.innerHTML = `<div class="gate"><div class="card">
    <div class="brand"><div class="mark">🐾</div><div><b>SelfHub</b><small>${State.info?.me ? `@${esc(State.info.me.username)}` : 'پنل مدیریت ربات'}</small></div></div>
    <h3 style="margin-top:14px">ورود</h3>
    <label>رمز عبور پنل</label>
    <input id="lg-pw" type="password" class="dir-ltr" autocomplete="current-password"/>
    <div class="row" style="margin-top:14px">
      <button class="btn primary" id="lg-go">ورود</button>
      <button class="btn" id="lg-demo">دادهٔ نمایشی</button>
      <button class="btn" id="lg-reset">بازنشانی نصب</button>
    </div>
    <p class="hint" id="lg-note"></p>
  </div></div>`
  const go = async () => {
    try {
      await api('/api/login', { method: 'POST', body: { password: $('#lg-pw').value } })
      await boot(true)
    } catch (e) {
      $('#lg-note').textContent = String(e.message || '')
    }
  }
  $('#lg-go').addEventListener('click', go)
  $('#lg-pw').addEventListener('keydown', (e) => e.key === 'Enter' && go())
  $('#lg-demo').addEventListener('click', () => {
    localStorage.setItem('selfhub_demo', '1')
    location.reload()
  })
  $('#lg-reset').addEventListener('click', () => {
    if (confirm('حالت نمایشی خاموش و به صفحهٔ نصب می‌رویم؟')) {
      localStorage.removeItem('selfhub_demo')
      location.href = '?fresh=1'
    }
  })
}

function layout(content, title, actions = '') {
  const items = [
    ['dash', '📊', 'داشبورد'],
    ['chats', '💬', 'چت‌ها'],
    ['schedule', '⏰', 'زمان‌بند'],
    ['log', '🧾', 'لاگ و اقدامات'],
    ['settings', '⚙️', 'تنظیمات'],
    ['security', '🔐', 'ربات و امنیت'],
  ]
  const me = State.info?.me
  return `<div class="shell">
    <aside class="side">
      <div class="brand"><div class="mark">🐾</div><div><b>SelfHub</b><small>${me ? `@${esc(me.username || '')}` : 'نسخهٔ نمایشی'}</small></div></div>
      <nav class="nav">${items.map(([t, i, l]) => `<button data-nav="${t}" ${State.tab === t ? 'aria-current="page"' : ''}><span class="ico">${i}</span>${l}</button>`).join('')}</nav>
      <div class="card" style="margin-top:14px;padding:10px 12px">
        <div class="row" style="justify-content:space-between"><span class="hint">وب‌هوک</span>${State.info?.webhook?.is_running ? '<span class="pill on">● فعال</span>' : '<span class="pill off">○ غیرفعال</span>'}</div>
        <div class="row" style="justify-content:space-between"><span class="hint">چت‌ها</span><b>${num(State.info?.chats ?? 0)}</b></div>
        <div class="row" style="justify-content:space-between"><span class="hint">آخرین update</span><code>${State.info?.lastUpdateId ? fa(State.info.lastUpdateId) : '—'}</code></div>
        <div class="row" style="justify-content:space-between"><span class="hint">نسخه</span><code>${nz(State.info?.version)}</code></div>
        <div class="row" style="margin-top:8px;gap:6px"><button class="btn small" id="btn-reload">↻ تازه‌سازی</button><button class="btn small" id="btn-out">خروج</button></div>
      </div>
    </aside>
    <main class="main">
      <div class="topbar"><h2>${title}</h2><div class="row">${actions}</div></div>
      ${State.demo ? '<div class="card warnbox" style="padding:10px 14px">🔎 <b>حالت نمایشی</b> — داده‌ها نمونه‌اند و چیزی به تلگرام فرستاده نمی‌شود. <button class="btn small" id="demo-off">خاموش کردن</button></div>' : ''}
      ${State.info?.lastError ? `<div class="card errbox" style="padding:10px 14px">⚠️ ${esc(State.info.lastError)}</div>` : ''}
      ${content}
    </main>
  </div>`
}

function paint(html) {
  app.className = ''
  app.innerHTML = html
  $$('[data-nav]').forEach((b) => (b.onclick = () => nav(b.dataset.nav)))
  const r = $('#btn-reload')
  if (r) r.onclick = () => boot(true)
  const o = $('#btn-out')
  if (o)
    o.onclick = async () => {
      if (State.demo) localStorage.removeItem('selfhub_demo')
      else await api('/api/logout', { method: 'POST', body: {} }).catch(() => {})
      location.reload()
    }
  const d = $('#demo-off')
  if (d)
    d.onclick = () => {
      localStorage.removeItem('selfhub_demo')
      location.reload()
    }
  wireLive()
}

const nav = (tab, arg) => {
  location.hash = `#/${tab}${arg ? `/${arg}` : ''}`
}

function wireLive() {
  if (State.es) State.es.close(), (State.es = null)
  if (State.demo) return
  if (State.tab !== 'log') return
  try {
    State.es = new EventSource('/api/events')
    State.es.onmessage = (e) => {
      const box = $('#live')
      if (!box) return
      const d = JSON.parse(e.data)
      box.insertAdjacentHTML('afterbegin', `<div><span class="t">${new Date(d.ts).toLocaleTimeString('fa-IR')}</span> <span class="${esc(d.level)}">${esc(d.msg)}</span></div>`)
      while (box.children.length > 300) box.lastElementChild.remove()
    }
  } catch {
    /* EventSource روی برخی مرورگرها مسدود است */
  }
}

/* ---------------- نمایهٔ چت‌ها ---------------- */

const chatLine = (c) => `<tr>
  <td><b>${esc(c.title || String(c.id))}</b><div class="hint"><code>${c.id}</code> · ${esc(typeLabel(c.type))}${c.members != null ? ` · ${num(c.members)} عضو` : ''}</div></td>
  <td>${c.settings?.moderation ? '<span class="pill on">مدیریت</span>' : '<span class="pill">مدیریت خاموش</span>'} ${c.settings?.broadcast ? '<span class="pill on">اطلاعیه</span>' : ''}</td>
  <td class="hint">${c.updatedAt ? ago(c.updatedAt) : ''}</td>
  <td><button class="btn small" data-open="${c.id}">باز کردن</button></td>
</tr>`
const typeLabel = (t) => ({ supergroup: 'ابرگروه', group: 'گروه', channel: 'کانال', private: 'پی‌وی' }[t] || t || '—')

/* ---------------- صفحه‌ها ---------------- */

async function viewDash(days = 14) {
  const o = (State.overview = await api(`/api/overview?days=${days}`))
  const g = o.growth || { pct: 0, dir: 'flat' }
  const card = (l, v, extra = '') => `<div class="stat"><b>${v}</b><span>${l}</span>${extra}</div>`
  const actions = `<div class="tabs">${[7, 14, 30].map((d) => `<button data-days="${d}" aria-selected="${d === days}">${fa(d)} روز</button>`).join('')}</div>`
  paint(
    layout(
      `<div class="grid cols-4">
        ${card('پیام در دوره', num(o.totals.msgs), `<span class="delta ${g.dir}">${g.dir === 'up' ? '▲' : g.dir === 'down' ? '▼' : '◆'} ${fa(Math.abs(g.pct || 0))}٪</span>`)}
        ${card('حذف خودکار', num(o.totals.deleted))}
        ${card('اخطار / سکوت / بن', `${num(o.totals.warns)} / ${num(o.totals.mutes)} / ${num(o.totals.bans)}`)}
        ${card('پاسخ ربات', num(o.totals.replies))}
      </div>
      <div class="card"><h3>روند پیام‌ها <span class="hint">— مجموع همهٔ چت‌ها</span></h3>${line(o.series.values || [])}<div class="row" style="justify-content:space-between"><span class="hint">${nz(o.series.labels?.[0])} → ${nz(o.series.labels?.at(-1))}</span><span class="hint">اوج: ${num(o.series.max)}</span></div></div>
      <div class="grid cols-2">
        <div class="card"><h3>۲۴ ساعت اخیر (ساعتی)</h3>${barsHtml(o.hourly?.values || [])}<div class="hint">مجموع: ${num(o.hourly?.sum)}</div></div>
        <div class="card"><h3>پرتراکم‌ترین چت‌ها</h3><div class="list">${(o.top || [])
          .sort((a, b) => b.t.msgs - a.t.msgs)
          .slice(0, 6)
          .map((t) => `<div class="item"><div class="txt"><b>${esc(t.chat.title || t.chat.id)}</b><small>${num(t.t.msgs)} پیام · ${num(t.t.deleted)} حذف · ${num(t.chat.members ?? 0)} عضو</small></div><button class="btn small" data-open="${t.chat.id}">تنظیمات</button></div>`)
          .join('') || '<div class="empty">هنوز چتی ثبت نشده. ربات را در یک گروه ادمین کنید.</div>'}</div></div>
      </div>
      <div class="card"><h3>رویدادهای اخیر</h3><div class="log" id="live">${(o.events || []).map((e) => `<div><span class="t">${new Date(e.ts).toLocaleTimeString('fa-IR')}</span> <span class="${esc(e.level)}">${esc(e.msg)}</span></div>`).join('') || '<div class="empty">لاگی نیست</div>'}</div></div>`,
      'داشبورد',
      actions,
    ),
  )
  $$('[data-days]').forEach((b) => (b.onclick = () => viewDash(+b.dataset.days)))
  $$('[data-open]').forEach((b) => (b.onclick = () => nav('chat', b.dataset.open)))
}

async function viewChats() {
  const r = await api('/api/chats')
  paint(
    layout(
      `<div class="card"><h3>چت‌های فعال <span class="hint">${num(r.chats.length)} مورد</span></h3>
       ${r.chats.length ? `<table><thead><tr><th>چت</th><th>وضعیت</th><th>آخرین فعالیت</th><th></th></tr></thead><tbody>${r.chats.map(chatLine).join('')}</tbody></table>` : '<div class="empty">ربات را در گروه/کانال اضافه کنید و ادمینش کنید؛ خودش اینجا ظاهر می‌شود.</div>'}</div>`,
      'چت‌ها',
      `<span class="pill">${num(r.chats.length)} چت</span>`,
    ),
  )
  $$('[data-open]').forEach((b) => (b.onclick = () => nav('chat', b.dataset.open)))
}

async function viewChat(id) {
  const r = await api(`/api/chats/${id}`)
  State.chat = { id, ...r }
  const st = r.settings
  const form = FORM.map(
    (grp) => `<div class="card"><h3>${esc(grp.g)}</h3><div class="grid cols-2">${grp.f.map((f) => fieldHtml(f, st)).join('')}</div></div>`,
  ).join('')
  paint(
    layout(
      `<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><h3 style="margin:0">${esc(st.title || id)}</h3><div class="hint"><code>${id}</code> · ${typeLabel(st.type)} </div></div>
        <div class="row"><button class="btn small" data-nav2="schedule">⏰ زمان‌بند این چت</button><button class="btn primary" id="save-chat">💾 ذخیره</button></div>
      </div></div>
      <div class="grid cols-4">
        <div class="stat"><b>${num(r.stats?.msgs)}</b><span>پیام (۳۰ روز)</span></div>
        <div class="stat"><b>${num(r.stats?.deleted)}</b><span>حذف خودکار</span></div>
        <div class="stat"><b>${num(r.stats?.replies)}</b><span>پاسخ</span></div>
        <div class="stat"><b>${num(r.stats?.warns)}</b><span>اخطار</span></div>
      </div>
      ${form}
      <div class="grid cols-2">
        <div class="card"><h3>پاسخ‌های کلیدواژه‌ای</h3>
          <div class="list">${r.keywords.map((k) => `<div class="item"><div class="txt"><b>${esc(k.pattern)} <span class="hint">(${k.mode})</span></b><small>${esc(k.reply)}</small></div><span class="hint">${num(k.hits)}</span><button class="btn small danger" data-kwdel="${k.id}">×</button></div>`).join('') || '<div class="empty">قانونی نیست</div>'}</div>
          <div class="row" style="margin-top:10px">
            <input class="grow" id="kw-p" placeholder="الگو (مثلاً قیمت)"/>
            <select id="kw-m">${['contains', 'exact', 'starts', 'regex'].map((m) => `<option>${m}</option>`).join('')}</select>
            <input class="grow" id="kw-r" placeholder="پاسخ"/>
            <button class="btn small primary" id="kw-add">افزودن</button>
          </div>
        </div>
        <div class="card"><h3>نوت‌ها <span class="hint">با #نام خوانده می‌شوند</span></h3>
          <div class="list">${r.notes.map((n) => `<div class="item"><div class="txt"><b>#${esc(n.name)}</b><small>${esc(n.text)}</small></div><span class="hint">${num(n.hits)}</span><button class="btn small danger" data-ntdel="${esc(n.name)}">×</button></div>`).join('') || '<div class="empty">نوتی نیست</div>'}</div>
          <div class="row" style="margin-top:10px"><input id="nt-n" placeholder="نام"/><input class="grow" id="nt-t" placeholder="متن"/><button class="btn small primary" id="nt-add">ذخیره</button></div>
        </div>
      </div>
      <div class="card"><h3>آزمون فیلترها <span class="hint">— پیام نمونه را با تنظیمات فعلی می‌سنجد</span></h3>
        <div class="row"><input class="grow" id="tst-txt" placeholder="یک پیام نمونه بنویسید…"/><button class="btn small" id="tst-run">اجرای آزمون</button><span id="tst-out" class="hint"></span></div>
      </div>
      <div class="card"><h3>۲۰ اقدام اخیر این چت</h3>
        ${r.modlog.length ? `<table><tbody>${r.modlog.map((m) => `<tr><td class="hint">${clock(Math.floor(m.ts / 1000))}</td><td><b>${esc(m.action)}</b></td><td>${esc(m.targetName || m.targetId || '')}</td><td class="hint">${esc(m.reason)}</td><td class="hint">${esc(m.moderator)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">اقدامی ثبت نشده</div>'}
      </div>`,
      `تنظیمات چت`,
      `<button class="btn small" data-back="chats">← همهٔ چت‌ها</button>`,
    ),
  )
  $$('[data-back]').forEach((b) => (b.onclick = () => nav(b.dataset.back)))
  $$('[data-nav2]').forEach((b) => (b.onclick = () => nav('schedule')))
  wireChips(app)

  $('#save-chat').onclick = async () => {
    const body = await collectForm(app, st)
    const res = await api(`/api/chats/${id}/settings`, { method: 'PUT', body })
    State.chat.settings = res.settings
    toast('ذخیره شد ✅', 'ok')
  }
  $('#kw-add').onclick = async () => {
    const pattern = $('#kw-p').value.trim()
    const reply = $('#kw-r').value.trim()
    if (!pattern || !reply) return toast('الگو و پاسخ لازم است', 'err')
    await api(`/api/chats/${id}/keywords`, { method: 'POST', body: { pattern, reply, mode: $('#kw-m').value } })
    viewChat(id)
  }
  $$('[data-kwdel]').forEach((b) => (b.onclick = async () => {
    await api(`/api/chats/${id}/keywords/${b.dataset.kwdel}`, { method: 'DELETE', body: {} })
    viewChat(id)
  }))
  $('#nt-add').onclick = async () => {
    const name = $('#nt-n').value.trim().replace(/^#/, '')
    const text = $('#nt-t').value.trim()
    if (!name || !text) return toast('نام و متن لازم است', 'err')
    await api(`/api/chats/${id}/notes`, { method: 'POST', body: { name, text } })
    viewChat(id)
  }
  $$('[data-ntdel]').forEach((b) => (b.onclick = async () => {
    await api(`/api/chats/${id}/notes/${encodeURIComponent(b.dataset.ntdel)}`, { method: 'DELETE', body: {} })
    viewChat(id)
  }))
  $('#tst-run').onclick = async () => {
    const out = await api(`/api/chats/${id}/test`, { method: 'POST', body: { text: $('#tst-txt').value } })
    $('#tst-out').innerHTML = out.wouldDelete
      ? `🗑 حذف می‌شود — <b>${esc((out.reasons || []).join(' | ') || out.action)}</b>`
      : '✅ چیزی نقض نکرد'
  }
}

async function viewSchedule() {
  const [s, c] = await Promise.all([api('/api/schedule'), api('/api/chats')])
  paint(
    layout(
      `<div class="card"><h3>افزودن</h3><div class="row">
        <select id="sc-chat">${c.chats.map((x) => `<option value="${x.id}">${esc(x.title || x.id)}</option>`).join('')}</select>
        <input id="sc-when" class="grow" placeholder="زمان: +20m — فردا ۸:۰۰ — every 30m"/>
        <input id="sc-text" class="grow" placeholder="متن پیام"/>
        <button class="btn primary" id="sc-add">زمان‌بندی</button>
      </div><div class="hint">پیش‌بینی: <span id="sc-prev">—</span></div></div>
      <div class="card"><h3>صف</h3><div class="list">
        ${s.jobs
          .map(
            (j) => `<div class="item"><div class="txt"><b>${esc(j.text)}</b><small>چت <code>${j.chatId}</code> · ${clock(j.at)}${j.everyMin ? ` · هر ${fa(j.everyMin)} دقیقه` : ' · یک‌بار'}${j.sentCount ? ` · ${num(j.sentCount)} ارسال` : ''} · ${esc(j.note || '')}</small></div>
            <div class="row"><label class="switch"><input type="checkbox" data-en="${j.id}" ${j.enabled ? 'checked' : ''}/> فعال</label><button class="btn small" data-run="${j.id}">▶ ارسال حالا</button><button class="btn small danger" data-jobdel="${j.id}">×</button></div></div>`,
          )
          .join('') || '<div class="empty">چیزی زمان‌بندی نشده</div>'}
      </div></div>`,
      'زمان‌بند و یادآور',
      `<span class="pill">${num(s.jobs.length)} مورد</span>`,
    ),
  )
  $('#sc-add').onclick = async () => {
    const body = { chatId: Number($('#sc-chat').value), when: $('#sc-when').value, text: $('#sc-text').value }
    if (!body.text) return toast('متن لازم است', 'err')
    await api('/api/schedule', { method: 'POST', body })
    toast('زمان‌بندی شد ✅', 'ok')
    viewSchedule()
  }
  $$('[data-run]').forEach((b) => (b.onclick = async () => {
    await api(`/api/schedule/${b.dataset.run}/run`, { method: 'POST', body: {} })
    toast('ارسال شد', 'ok')
    viewSchedule()
  }))
  $$('[data-jobdel]').forEach((b) => (b.onclick = async () => {
    await api(`/api/schedule/${b.dataset.jobdel}`, { method: 'DELETE', body: {} })
    viewSchedule()
  }))
}

async function viewLog() {
  const r = await api('/api/modlog?limit=100')
  paint(
    layout(
      `<div class="card"><h3>لاگ زنده <span class="hint">— رویدادهای ربات، همان لحظه</span></h3><div class="log" id="live">${(State.overview?.events || []).map((e) => `<div><span class="t">${new Date(e.ts).toLocaleTimeString('fa-IR')}</span> <span class="${esc(e.level)}">${esc(e.msg)}</span></div>`).join('') || '<div class="empty">در انتظار رویداد…</div>'}</div></div>
       <div class="card"><h3>اقدامات مدیریتی</h3>
        ${r.rows.length ? `<table><thead><tr><th>زمان</th><th>اقدام</th><th>هدف</th><th>دلیل</th><th>توسط</th></tr></thead><tbody>${r.rows
          .map((m) => `<tr><td class="hint" dir="ltr">${clock(Math.floor(m.ts / 1000))}</td><td><b>${esc(m.action)}</b></td><td>${esc(m.targetName || m.targetId || '—')}</td><td class="hint">${esc(m.reason)}</td><td class="hint">${esc(m.moderator)}</td></tr>`)
          .join('')}</tbody></table>` : '<div class="empty">اقدامی ثبت نشده — یعنی فیلترها چیزی را رد نکردند 🙂</div>'}
       </div>
       <div class="card"><h3>خروجی</h3><div class="row"><a class="btn small" href="/api/stats.csv?days=30" download>⬇ آمار (CSV)</a><a class="btn small" href="/api/export" download>⬇ پشتیبان JSON</a></div></div>`,
      'لاگ و اقدامات',
      `<span class="pill">${num(r.rows.length)} اقدام</span>`,
    ),
  )
}

async function viewSettings() {
  const r = await api('/api/global')
  const g = r.global
  paint(
    layout(
      `<div class="card"><h3>سراسری</h3><div class="grid cols-3">
        <div><label>منطقهٔ زمانی (دقیقه آفست)</label><input type="number" id="g-tz" value="${g.tzOffsetMin}"/><div class="hint">تهران = ۲۱۰</div></div>
        <div><label>سقف اطلاعیه در هر اجرا</label><input type="number" id="g-cap" value="${g.broadcastMaxPerTick}"/></div>
        <div><label>فاصلهٔ بین دو ارسال (ms)</label><input type="number" id="g-gap" value="${g.broadcastGapMs}"/></div>
        <div><label>ادمین‌های پنل (شناسه عددی، با کاما)</label><input id="g-admins" class="dir-ltr" value="${(g.admins || []).join(', ')}"/></div>
        <div><label>پاورقی راهنمای /start</label><input id="g-foot" value="${esc(g.helpFooter)}"/></div>
        <div class="row" style="align-items:flex-end"><button class="btn primary" id="g-save">ذخیره</button></div>
      </div></div>
      <div class="card"><h3>اطلاعیه به چت‌های عضو <span class="hint">— فقط چت‌هایی که خودشان /sub زده‌اند</span></h3>
        <textarea id="bc-text" rows="3" placeholder="متن اطلاعیه…"></textarea>
        <div class="row" style="margin-top:8px"><button class="btn" id="bc-dry">پیش‌نمایش مخاطب</button><button class="btn primary" id="bc-send">ارسال</button><span class="hint" id="bc-out"></span></div>
      </div>
      <div class="card"><h3>پیش‌فرض چت‌های تازه <span class="hint">— چت‌های موجود دست‌نخورده می‌مانند</span></h3>
        <div class="grid cols-2">
          <label class="switch"><input type="checkbox" id="d-mod" ${g.defaults.moderation ? 'checked' : ''}/> مدیریت فعال</label>
          <label class="switch"><input type="checkbox" id="d-wel" ${g.defaults.welcome ? 'checked' : ''}/> خوش‌آمدگویی</label>
          <label class="switch"><input type="checkbox" id="d-ar" ${g.defaults.autoreply ? 'checked' : ''}/> پاسخ کلیدواژه‌ای</label>
          <label class="switch"><input type="checkbox" id="d-lnk" ${g.defaults.links.on ? 'checked' : ''}/> فیلتر لینک</label>
        </div>
        <div class="row" style="margin-top:10px"><button class="btn" id="d-save">ذخیرهٔ پیش‌فرض</button></div>
      </div>`,
      'تنظیمات',
    ),
  )
  $('#g-save').onclick = async () => {
    const body = {
      tzOffsetMin: Number($('#g-tz').value),
      broadcastMaxPerTick: Number($('#g-cap').value),
      broadcastGapMs: Number($('#g-gap').value),
      admins: $('#g-admins').value.split(/[\s,]+/).map(Number).filter((n) => n > 0),
      helpFooter: $('#g-foot').value,
    }
    await api('/api/global', { method: 'PUT', body })
    toast('ذخیره شد ✅', 'ok')
  }
  $('#d-save').onclick = async () => {
    const def = await api('/api/global').then((r) => r.global.defaults)
    def.moderation = $('#d-mod').checked
    def.welcome = $('#d-wel').checked
    def.autoreply = $('#d-ar').checked
    def.links.on = $('#d-lnk').checked
    await api('/api/global', { method: 'PUT', body: { defaults: def } })
    toast('پیش‌فرض ذخیره شد ✅', 'ok')
  }
  $('#bc-dry').onclick = async () => {
    const r = await api('/api/broadcast', { method: 'POST', body: { text: $('#bc-text').value || 'نمونه', dryRun: true } })
    $('#bc-out').textContent = `${fa(r.preview)} چت آمادهٔ دریافت است`
  }
  $('#bc-send').onclick = async () => {
    const text = $('#bc-text').value.trim()
    if (!text) return toast('متن خالی است', 'err')
    if (!confirm(`به ${num(State.info?.subscribers || 0)} چت ارسال شود؟`)) return
    const r = await api('/api/broadcast', { method: 'POST', body: { text } })
    $('#bc-out').textContent = `${fa(r.sent)} ارسال شد${r.left ? `، ${fa(r.left)} در نوبت بعدی` : ''}`
  }
}

async function viewSecurity() {
  const i = State.info
  paint(
    layout(
      `<div class="grid cols-2">
        <div class="card"><h3>توکن ربات</h3>
          <p class="hint">ربات: ${i?.me ? `<b>@${esc(i.me.username)}</b> (id <code>${i.me.id}</code>)` : '—'}</p>
          <label>توکن تازه (برای تعویض)</label><input id="se-token" class="dir-ltr" placeholder="123456:AA…"/>
          <div class="row" style="margin-top:8px"><button class="btn small" id="se-save-token">ذخیرهٔ توکن</button></div>
          ${i?.me && !i.me.can_read_all_group_messages ? '<div class="card warnbox" style="margin-top:10px;padding:8px 12px">⚠️ Privacy Mode ربات روشن است. برای دیدن پیام‌های گروه، در @BotFather مسیر Bot Settings → Group Privacy → Turn off را بزن.</div>' : ''}
        </div>
        <div class="card"><h3>وب‌هوک</h3>
          <p class="dir-ltr hint" style="font-family:var(--mono);font-size:11px;word-break:break-all">${dash(i?.webhook?.url)}</p>
          <div class="row"><span class="pill ${i?.webhook?.is_running ? 'on' : 'off'}">${i?.webhook?.is_running ? '● فعال' : '○ ست نشده'}</span><span class="hint">مانده: ${num(i?.webhook?.pending_update_count ?? 0)}</span></div>
          ${i?.webhook?.last_error_message ? `<div class="hint" style="color:var(--err)">${esc(i.webhook.last_error_message)}</div>` : ''}
          <div class="row" style="margin-top:10px"><button class="btn small" id="se-hook">ست مجدد وب‌هوک</button><button class="btn small danger" id="se-hook-drop">حذف وب‌هوک</button></div>
        </div>
      </div>
      <div class="grid cols-2">
        <div class="card"><h3>رمز پنل</h3>
          <label>رمز فعلی</label><input id="se-cur" type="password" class="dir-ltr"/>
          <label>رمز تازه</label><input id="se-new" type="password" class="dir-ltr"/>
          <div class="row" style="margin-top:10px"><button class="btn small primary" id="se-pw">تغییر رمز</button></div>
          <p class="hint">۵ بار رمز اشتباه = قفل ۱۵ دقیقه‌ای (روی دیسک ذخیره می‌شود، با ری‌استارت پاک نمی‌شود).</p>
        </div>
        <div class="card"><h3>داده</h3>
          <div class="row"><a class="btn small" href="/api/export" download>⬇ خروجی JSON</a><button class="btn small danger" id="se-wipe">پاک‌کردن دادهٔ چت‌ها</button></div>
          <p class="hint">پاک‌کردن، تنظیمات چت‌ها، نوت‌ها، آمار و لاگ را می‌برد ولی نصب و توکن دست‌نخورده می‌ماند.</p>
        </div>
      </div>`,
      'ربات و امنیت',
    ),
  )
  $('#se-save-token').onclick = async () => {
    const token = $('#se-token').value.trim()
    if (!token) return toast('توکن را وارد کنید', 'err')
    await api('/api/security/token', { method: 'PUT', body: { token } })
    toast('توکن ذخیره شد ✅', 'ok')
    boot(true)
  }
  $('#se-hook').onclick = async () => {
    await api(`/api/security/webhook?url=${encodeURIComponent(location.origin)}`, { method: 'POST', body: {} })
    toast('وب‌هوک ست شد ✅', 'ok')
    boot(true)
  }
  $('#se-pw').onclick = async () => {
    await api('/api/security/password', { method: 'POST', body: { current: $('#se-cur').value, next: $('#se-new').value } })
    toast('رمز تغییر کرد ✅', 'ok')
  }
  $('#se-wipe').onclick = async () => {
    if (!confirm('همهٔ دادهٔ چت‌ها پاک شود؟ این کار قابل بازگشت نیست.')) return
    await api('/api/danger/wipe', { method: 'POST', body: { confirm: 'WIPE' } })
    toast('پاک شد', 'ok')
    boot(true)
  }

  $('#se-hook-drop').onclick = async () => {
    if (!confirm('وب‌هوک حذف شود؟ ربات دیگر هیچ پیامی دریافت نمی‌کند تا دوباره ستش کنی.')) return
    await api('/api/security/webhook/drop', { method: 'POST', body: {} })
    toast('وب‌هوک حذف شد', 'ok')
    boot(true)
  }
}

/* ---------------- روتر ---------------- */

const ROUTES = {
  dash: () => viewDash(14),
  chats: () => viewChats(),
  schedule: () => viewSchedule(),
  log: () => viewLog(),
  settings: () => viewSettings(),
  security: () => viewSecurity(),
}

async function route() {
  const [tab, arg] = (location.hash.replace(/^#\//, '') || 'dash').split('/')
  State.tab = tab
  if (tab === 'chat' && arg) return viewChat(Number(arg))
  await (ROUTES[tab] || ROUTES.dash)()
}

async function boot(force) {
  if (State.demo && !window.DEMO) {
    State.demo = false
    localStorage.removeItem('selfhub_demo')
  }
  if (force) State.info = null
  if (!State.info) {
    try {
      State.info = State.demo ? await window.DEMO.api('/api/state', {}) : await api('/api/state')
    } catch {
      app.className = ''
      app.innerHTML = `<div class="gate"><div class="card"><h3>❌ ارتباط برقرار نشد</h3><p class="hint">آدرس پنل را باز کرده‌اید؟ (<code>wrangler dev</code> یا دیپلوی Cloudflare)</p><button class="btn" onclick="location.reload()">تلاش دوباره</button></div></div>`
      return
    }
  }
  if (State.demo) return route()
  if (!State.info.installed) return renderSetup()
  if (!State.info.authed) return renderLogin()
  await route()
}

window.addEventListener('hashchange', () => State.info?.authed || State.demo ? route() : null)
if (new URLSearchParams(location.search).get('fresh') === '1') {
  // نصب دوباره فقط با پاک‌کردن دستی داده‌ها ممکن است؛ اینجا فقط رفرش می‌کنیم
  location.href = '/'
}
boot()
