/* SelfHub — منطق پنل (Vanilla JS، بدون وابستگی) */
'use strict'

/* ---------------- ابزارها ---------------- */
const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]
const app = $('#app')

async function api(path, opts = {}) {
  const method = opts.method || (opts.body ? 'POST' : 'GET')
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-selfhub': '1' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  })
  if (res.status === 401) { location.reload(); throw new Error('unauthorized') }
  return res.json()
}

function toast(msg, kind = '') {
  let box = $('#toasts')
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box) }
  const t = document.createElement('div')
  t.className = 'toast ' + kind
  t.textContent = msg
  box.appendChild(t)
  setTimeout(() => t.remove(), 4200)
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function faTime(ts) {
  try { return new Date(ts).toLocaleString('fa-IR') } catch { return String(ts) }
}

function val(v, fallback = '—') { return v === undefined || v === null || v === '' ? fallback : esc(v) }

/* ---------------- بوت ---------------- */
async function boot() {
  let st
  try { st = await api('/api/state') } catch { app.innerHTML = '<div class="gate"><div class="logo-big">⚠️</div><h1>اتصال برقرار نشد</h1><button class="btn" onclick="location.reload()">تلاش مجدد</button></div>'; return }
  if (!st.installed) return renderSetup()
  if (!st.authed) return renderLogin()
  renderPanel()
}

/* ---------------- ستاپ اولیه ---------------- */
function renderSetup() {
  app.innerHTML = `
  <div class="gate">
    <div class="logo-big">🤖</div>
    <h1>خوش آمدید به SelfHub</h1>
    <p class="sub">سلف‌بات تلگرام بدون ربات هلپر — راه‌اندازی فقط چند ثانیه طول می‌کشد</p>
    <div class="card">
      <h3>🚀 راه‌اندازی اولیه</h3>
      <p class="desc">شماره‌تان را بدهید؛ SelfHub کد ورود را از تلگرام می‌گیرد، وارد <b>my.telegram.org</b> می‌شود و API ID و API Hash را خودش دریافت می‌کند. هیچ ربات هلپری لازم نیست.</p>
      <div class="auto-api card-inset">
        <label>شماره تلگرام با کد کشور</label>
        <input id="su-phone" inputmode="tel" placeholder="+989123456789" dir="ltr" />
        <button class="btn ghost" id="su-send-code" type="button">📲 ارسال کد تلگرام</button>
        <div id="su-code-box" style="display:none;margin-top:10px">
          <label>کد ورود تلگرام</label>
          <input id="su-tg-code" inputmode="numeric" placeholder="کد را از تلگرام وارد کنید" dir="ltr" />
          <button class="btn" id="su-fetch-api" type="button" style="margin-top:8px">🔐 ورود و دریافت خودکار API</button>
        </div>
        <p class="hint" id="su-api-status">یا API ID و Hash را دستی در پایین وارد کنید.</p>
      </div>
      <label>API ID (عدد)</label>
      <input id="su-api-id" inputmode="numeric" placeholder="مثلاً 255721" dir="ltr" />
      <label>API Hash</label>
      <input id="su-api-hash" placeholder="32 نویسه هگز" dir="ltr" />
      <label>Bot Token — اختیاری، می‌توانید خالی بگذارید</label>
      <input id="su-bot-token" placeholder="123456:ABC-DEF..." dir="ltr" />
      <p class="hint">💡 نیازی به ربات هلپر نیست؛ همه‌چیز از همین پنل با رمز عبور کنترل می‌شود.</p>
      <label>رمز عبور ادمین (حداقل ۸ نویسه)</label>
      <input id="su-pw" type="password" placeholder="یک رمز قوی انتخاب کنید" dir="ltr" />
      <div class="pw-bars" id="su-bars"><i></i><i></i><i></i><i></i></div>
      <label>تکرار رمز عبور</label>
      <input id="su-pw2" type="password" dir="ltr" />
      <div class="row" style="margin-top:18px">
        <button class="btn" id="su-go" style="flex:1">راه‌اندازی SelfHub 🚀</button>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn ghost sm" id="su-demo" style="flex:1">اول با حالت نمایشی ببین 👀</button>
      </div>
    </div>
  </div>`

  $('#su-send-code').onclick = async () => {
    const phone = $('#su-phone').value.trim()
    if (!phone) return toast('شماره را با کد کشور وارد کنید', 'err')
    const r = await api('/api/mytg/start', { body: { phone } })
    if (!r.ok) return toast(r.error, 'err')
    $('#su-code-box').style.display = 'block'
    $('#su-api-status').textContent = 'کد ارسال شد؛ کد داخل تلگرام را وارد کنید.'
    toast('کد ورود به تلگرام ارسال شد 📲', 'ok')
  }
  $('#su-fetch-api').onclick = async () => {
    const code = $('#su-tg-code').value.trim()
    if (!code) return toast('کد تلگرام را وارد کنید', 'err')
    const r = await api('/api/mytg/verify', { body: { code } })
    if (!r.ok) return toast(r.error, 'err')
    $('#su-api-id').value = r.apiId
    $('#su-api-hash').value = r.apiHash
    $('#su-api-status').textContent = '✅ API ID و API Hash با موفقیت دریافت شد؛ حالا رمز ادمین را بسازید.'
    toast('API با موفقیت دریافت شد 🎉', 'ok')
  }

  const pw = $('#su-pw')
  pw.addEventListener('input', () => {
    const v = pw.value
    let score = 0
    if (v.length >= 10) score++
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++
    if (/\d/.test(v)) score++
    if (/[^a-zA-Z0-9]/.test(v)) score++
    $$('#su-bars i').forEach((b, i) => {
      b.className = i < score ? (score >= 3 ? 'on hi' : score === 2 ? 'on mid' : 'on') : ''
    })
  })

  $('#su-go').onclick = async () => {
    const body = {
      apiId: Number($('#su-api-id').value.trim()),
      apiHash: $('#su-api-hash').value.trim(),
      botToken: $('#su-bot-token').value.trim(),
      adminPassword: pw.value,
    }
    if (body.adminPassword !== $('#su-pw2').value) return toast('تکرار رمز مطابقت ندارد', 'err')
    const r = await api('/api/setup', { body })
    if (!r.ok) return toast(r.error, 'err')
    toast('نصب کامل شد! خوش آمدید 🎉', 'ok')
    renderPanel()
  }

  $('#su-demo').onclick = async () => {
    const body = {
      apiId: Number($('#su-api-id').value.trim()) || 2040,
      apiHash: $('#su-api-hash').value.trim() || 'b18441a1ff607e10a989a63302fb3b8a',
      botToken: '',
      adminPassword: pw.value,
    }
    if (body.adminPassword !== $('#su-pw2').value) return toast('تکرار رمز مطابقت ندارد', 'err')
    if (body.adminPassword.length < 8) return toast('رمز باید حداقل ۸ نویسه باشد', 'err')
    let r = await api('/api/setup', { body })
    if (!r.ok) return toast(r.error, 'err')
    await api('/api/accounts', { body: { label: 'اکانت نمایشی', type: 'demo' } })
    toast('حالت نمایشی فعال شد! بدون اکانت واقعی، پنل را بگردید 👀', 'ok')
    renderPanel()
  }
}

/* ---------------- ورود با رمز ---------------- */
function renderLogin() {
  app.innerHTML = `
  <div class="gate">
    <div class="logo-big">🔒</div>
    <h1>ورود به SelfHub</h1>
    <p class="sub">برای ورود به پنل مدیریت، رمز عبور ادمین را وارد کنید</p>
    <div class="card">
      <label>رمز عبور ادمین</label>
      <input id="lg-pw" type="password" dir="ltr" autofocus />
      <div class="row" style="margin-top:16px">
        <button class="btn" id="lg-go" style="flex:1">ورود به پنل 🔓</button>
      </div>
      <p class="hint">🛡 بعد از ۵ تلاش ناموفق، ورود ۵ دقیقه قفل می‌شود.</p>
    </div>
  </div>`
  const go = async () => {
    const r = await api('/api/login', { body: { password: $('#lg-pw').value } })
    if (!r.ok) return toast(r.error, 'err')
    renderPanel()
  }
  $('#lg-go').onclick = go
  $('#lg-pw').addEventListener('keydown', e => { if (e.key === 'Enter') go() })
}

/* ---------------- پنل اصلی ---------------- */
let accounts = []
let selectedAccount = null
let pollTimer = null
let sseSource = null
let currentView = 'dashboard'

async function renderPanel() {
  app.innerHTML = `
  <div class="layout">
    <aside>
      <div class="brand"><span class="dot">🤖</span> SelfHub</div>
      <button class="nav-btn" data-v="dashboard">📊 داشبورد</button>
      <button class="nav-btn" data-v="accounts">👥 اکانت‌ها</button>
      <button class="nav-btn" data-v="features">⚡ امکانات</button>
      <button class="nav-btn" data-v="tools">🛠 ابزارها</button>
      <button class="nav-btn" data-v="logs">📜 لاگ زنده</button>
      <button class="nav-btn" data-v="settings">⚙️ تنظیمات</button>
      <div class="spacer"></div>
      <div class="foot">SelfHub v1.0<br/>سلف‌بات بدون ربات هلپر<br/>دپلوی روی Cloudflare Workers</div>
    </aside>
    <main id="view"></main>
  </div>`
  $$('.nav-btn').forEach(b => (b.onclick = () => { currentView = b.dataset.v; showView() }))
  showView()
  clearInterval(pollTimer)
  pollTimer = setInterval(async () => {
    if (currentView === 'dashboard' || currentView === 'accounts') await refreshAccounts(true)
  }, 10000)
}

function showView() {
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.v === currentView))
  const view = $('#view')
  if (sseSource) { sseSource.close(); sseSource = null }
  ;({ dashboard: viewDashboard, accounts: viewAccounts, features: viewFeatures, tools: viewTools, logs: viewLogs, settings: viewSettings }[currentView] || viewDashboard)(view)
}

async function refreshAccounts(silent = false) {
  const r = await api('/api/accounts')
  if (r.ok) {
    accounts = r.accounts
    if (!silent) return
    if (currentView === 'dashboard') renderDash($('#view'))
    if (currentView === 'accounts') renderAccountsList($('#view'))
  }
}

const accStatus = a => {
  const map = {
    connected: ['on', 'متصل ✓'],
    connecting: ['warn', 'در حال اتصال…'],
    awaiting_code: ['warn', 'منتظر کد'],
    awaiting_password: ['warn', 'منتظر رمز ۲FA'],
    stopped: ['err', 'متوقف'],
    error: ['err', 'خطا'],
    idle: ['', 'غیرفعال'],
  }
  return map[a.status] ?? ['', a.status ?? '؟']
}

/* ---------------- داشبورد ---------------- */
async function viewDashboard(view) {
  view.innerHTML = `<div class="topbar"><h2>📊 داشبورد</h2><div class="actions"><button class="btn ghost sm" onclick="location.reload()">↻</button></div></div><div class="spin" style="margin:60px auto"></div>`
  await loadNotifs()
  await refreshAccounts(true)
  renderDash(view)
}

function renderDash(view) {
  const connected = accounts.filter(a => a.status === 'connected').length
  const tot = (f) => accounts.reduce((s, a) => s + ((a.stats?.[f]) ?? 0), 0)
  const notifs = window.__notifs ?? []
  view.innerHTML = `
  <div class="topbar"><h2>📊 داشبورد</h2><div class="actions"><button class="btn ghost sm" id="dash-refresh">↻ به‌روزرسانی</button></div></div>
  <div class="grid c3">
    <div class="card stat"><span class="num">${accounts.length}</span><span class="lbl">اکانت سلف</span></div>
    <div class="card stat"><span class="num">${connected}</span><span class="lbl">در حال اتصال</span></div>
    <div class="card stat"><span class="num">${tot('sent').toLocaleString('fa-IR')}</span><span class="lbl">پیام ارسالی</span></div>
    <div class="card stat"><span class="num">${tot('replies').toLocaleString('fa-IR')}</span><span class="lbl">پاسخ خودکار</span></div>
    <div class="card stat"><span class="num">${tot('dms').toLocaleString('fa-IR')}</span><span class="lbl">پیام انبوه</span></div>
    <div class="card stat"><span class="num">${tot('floodWaits').toLocaleString('fa-IR')}</span><span class="lbl">محدودیت FloodWait</span></div>
  </div>
  <div class="grid c2" style="margin-top:16px">
    <div class="card">
      <h3>👥 وضعیت سلف‌ها</h3>
      <table><tbody>
        ${accounts.map(a => {
          const [cls, lbl] = accStatus(a)
          return `<tr><td><b>${esc(a.label)}</b><br/><span class="hint">${a.type === 'demo' ? 'نمایشی' : a.type === 'bot' ? 'ربات' : 'اکانت کاربری'} — ${val(a.me?.displayName)}</span></td><td style="text-align:left"><span class="chip ${cls}"><i class="dot-i"></i>${lbl}</span></td></tr>`
        }).join('') || '<tr><td class="hint">هنوز اکانتی اضافه نشده — از بخش «اکانت‌ها» شروع کنید</td></tr>'}
      </tbody></table>
    </div>
    <div class="card">
      <h3>🔔 آخرین اعلان‌ها</h3>
      ${notifs.slice(0, 6).map(n => `<div class="notif"><b>${esc(n.title)}</b><span>${esc(n.body)}</span><br/><span class="when">${faTime(n.ts)}</span></div>`).join('') || '<p class="hint">اعلانی نیست.</p>'}
    </div>
  </div>`
  $('#dash-refresh').onclick = async () => { await refreshAccounts(true); renderDash(view); toast('به‌روز شد', 'ok') }
}

/* ---------------- اکانت‌ها ---------------- */
async function viewAccounts(view) {
  view.innerHTML = `<div class="topbar"><h2>👥 اکانت‌ها</h2><div class="actions"><button class="btn" id="acc-add">＋ افزودن اکانت</button></div></div><div class="spin" style="margin:60px auto"></div>`
  await refreshAccounts(true)
  renderAccountsList(view)
  $('#acc-add').onclick = () => addAccountModal()
}

function renderAccountsList(view) {
  const head = `<div class="topbar"><h2>👥 اکانت‌ها</h2><div class="actions"><button class="btn" id="acc-add">＋ افزودن اکانت</button></div></div>`
  view.innerHTML = head + `
  <div class="card" style="padding:6px 4px">
    <table><thead><tr><th>اکانت</th><th>نوع</th><th>وضعیت</th><th>آخرین خطا</th><th style="text-align:left">عملیات</th></tr></thead><tbody>
    ${accounts.map(a => {
      const [cls, lbl] = accStatus(a)
      return `<tr>
        <td><b>${esc(a.label)}</b><br/><span class="hint">${val(a.me?.username, '')} ${a.me ? '· ' + esc(a.me.displayName) : ''}</span></td>
        <td>${a.type === 'demo' ? '👀 نمایشی' : a.type === 'bot' ? '🤖 ربات' : '👤 کاربر'}</td>
        <td><span class="chip ${cls}"><i class="dot-i"></i>${lbl}</span></td>
        <td class="hint" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(a.lastError ?? '')}">${val(a.lastError, '—')}</td>
        <td style="text-align:left;white-space:nowrap">
          <button class="btn ghost sm" data-act="features" data-id="${a.id}">⚡ امکانات</button>
          ${a.status === 'connected' ? `<button class="btn ghost sm" data-act="stop" data-id="${a.id}">⏸ توقف</button>` : `<button class="btn ghost sm" data-act="start" data-id="${a.id}">▶️ اتصال</button>`}
          ${a.status === 'idle' || a.status === 'error' || a.status === 'stopped' ? `<button class="btn ghost sm" data-act="relogin" data-id="${a.id}">🔑 ورود مجدد</button>` : ''}
          <button class="btn danger sm" data-act="del" data-id="${a.id}">🗑</button>
        </td>
      </tr>`
    }).join('') || '<tr><td colspan="5" class="hint" style="padding:30px;text-align:center">هنوز اکانتی نیست — «افزودن اکانت» را بزنید</td></tr>'}
    </tbody></table>
  </div>
  <p class="hint" style="margin-top:12px">💡 هر اکانت کاربری با شماره تلفن + کد تأیید تلگرام اضافه می‌شود. رمز دو مرحله‌ای هم پشتیبانی می‌شود. هیچ ربات هلپری لازم نیست.</p>`
  $('#acc-add').onclick = () => addAccountModal()
  $$('button[data-act]').forEach(b => b.onclick = () => accountAction(b.dataset.act, b.dataset.id))
}

async function accountAction(act, id) {
  const a = accounts.find(x => x.id === id)
  if (act === 'features') { selectedAccount = id; currentView = 'features'; showView(); return }
  if (act === 'stop' || act === 'start') {
    const r = await api(`/api/a/${id}/${act}`, { body: {} })
    toast(r.ok ? (act === 'stop' ? 'متوقف شد' : 'در حال اتصال…') : r.error, r.ok ? 'ok' : 'err')
  }
  if (act === 'relogin') {
    if (a?.phone) return loginCodeFlow(a, a.phone)
    return addAccountModal('user', a?.label)
  }
  if (act === 'del') {
    if (!confirm(`اکانت «${a?.label}» و نشستش حذف شود؟`)) return
    const r = await api(`/api/accounts?id=${id}`, { method: 'DELETE' })
    toast(r.ok ? 'حذف شد' : r.error, r.ok ? 'ok' : 'err')
  }
  await refreshAccounts(true)
  renderAccountsList($('#view'))
}

function modal(html) {
  const back = document.createElement('div')
  back.className = 'modal-back'
  back.innerHTML = `<div class="card modal">${html}</div>`
  back.addEventListener('click', e => { if (e.target === back) back.remove() })
  document.body.appendChild(back)
  return back
}

function addAccountModal(type, label, phone) {
  const back = modal(`
    <h3>🔑 افزودن اکانت سلف</h3>
    <p class="desc">اکانت تلگرام شخصی را با شماره و کد تأیید متصل کنید. کد از خود تلگرام برایتان می‌آید (به اکانت فعلی‌تان در گوشی).</p>
    <label>برچسب اکانت</label>
    <input id="na-label" placeholder="مثلاً: سلف اصلی" value="${esc(label ?? '')}" />
    <label>شماره تلفن</label>
    <input id="na-phone" placeholder="+989123456789" dir="ltr" value="${esc(phone ?? '')}" />
    <div class="row" style="margin-top:16px">
      <button class="btn" id="na-go" style="flex:1">ادامه →</button>
      <button class="btn ghost" id="na-demo">اکانت نمایشی</button>
    </div>
    <p class="hint">⚠️ استفاده از سلف‌بات خلاف قوانین تلگرام است و ریسک محدودیت اکانت دارد — با مسئولیت خودتان.</p>
  `)
  $('#na-go', back).onclick = async () => {
    const body = { label: $('#na-label', back).value.trim() || 'سلف', type: 'user', phone: $('#na-phone', back).value.trim() }
    if (!body.phone) return toast('شماره را وارد کنید', 'err')
    const r = await api('/api/accounts', { body })
    if (!r.ok) return toast(r.error, 'err')
    back.remove()
    await loginCodeFlow(r.account, body.phone)
  }
  $('#na-demo', back).onclick = async () => {
    const r = await api('/api/accounts', { body: { label: $('#na-label', back).value.trim() || 'اکانت نمایشی', type: 'demo' } })
    if (!r.ok) return toast(r.error, 'err')
    back.remove()
    await refreshAccounts(true)
    renderAccountsList($('#view'))
    toast('اکانت نمایشی اضافه شد 👀', 'ok')
  }
}

async function loginCodeFlow(account, phone) {
  const back = modal(`
    <h3>📩 کد تأیید تلگرام</h3>
    <p class="desc" id="lc-status">در حال اتصال به تلگرام و ارسال کد…</p>
    <div id="lc-form" style="display:none">
      <label>کد تأیید</label>
      <input id="lc-code" placeholder="مثلاً 54321" dir="ltr" />
      <div class="row" style="margin-top:14px"><button class="btn" id="lc-go" style="flex:1">تأیید ✅</button></div>
    </div>
    <div id="lc-pw" style="display:none">
      <label>رمز دو مرحله‌ای (2FA)</label>
      <input id="lc-pass" type="password" dir="ltr" />
      <div class="row" style="margin-top:14px"><button class="btn" id="lc-pw-go" style="flex:1">تأیید ✅</button></div>
    </div>
    <div class="spin" id="lc-spin" style="margin:26px auto"></div>
  `)
  const poll = setInterval(async () => {
    const r = await api(`/api/a/${account.id}/state`)
    if (!r.ok) return
    const s = r.status
    if (s === 'awaiting_code') {
      $('#lc-status', back).textContent = 'کد از تلگرام برایتان ارسال شد — وارد کنید:'
      $('#lc-spin', back).style.display = 'none'
      $('#lc-form', back).style.display = 'block'
    }
    if (s === 'awaiting_password') {
      $('#lc-status', back).textContent = 'این اکانت رمز دو مرحله‌ای دارد:'
      $('#lc-spin', back).style.display = 'none'
      $('#lc-form', back).style.display = 'none'
      $('#lc-pw', back).style.display = 'block'
    }
    if (s === 'connected') {
      clearInterval(poll)
      back.remove()
      await refreshAccounts(true)
      renderAccountsList($('#view'))
      toast('سلف متصل شد! 🎉', 'ok')
    }
    if (s === 'error') {
      clearInterval(poll)
      $('#lc-status', back).innerHTML = `<span style="color:var(--err)">خطا: ${esc(r.lastError)}</span>`
      $('#lc-spin', back).style.display = 'none'
    }
  }, 1500)
  $('#lc-go', back).onclick = async () => {
    const r = await api(`/api/a/${account.id}/code`, { body: { code: $('#lc-code', back).value.trim() } })
    if (!r.ok) { toast(r.error, 'err'); clearInterval(poll); back.remove() }
  }
  $('#lc-pw-go', back).onclick = async () => {
    const r = await api(`/api/a/${account.id}/password`, { body: { password: $('#lc-pass', back).value } })
    if (!r.ok) { toast(r.error, 'err'); clearInterval(poll); back.remove() }
  }
  back.addEventListener('click', e => { if (e.target === back) clearInterval(poll) })
}

/* ---------------- امکانات ---------------- */
const FEATURE_LIST = [
  { key: 'secretary', icon: '💬', title: 'منشی هوشمند خودکار', desc: 'پاسخ خودکار به پیام‌ها: همیشه، فقط بار اول، هنگام آفلاین بودن، یا با کلیدواژه' },
  { key: 'afk', icon: '💤', title: 'حالت غیبت (AFK)', desc: 'پاسخ خودکار به منشن/پیام‌ها وقتی نیستید + اطلاع در پنل' },
  { key: 'forward', icon: '🔁', title: 'فوروارد هوشمند', desc: 'انتقال خودکار پیام بین چت‌ها با فیلتر کلیدواژه و حالت کپی (ایده از tgcf)' },
  { key: 'schedule', icon: '⏰', title: 'زمان‌بند ارسال', desc: 'ارسال پیام در زمان مشخص یا تکرارشونده (هر X دقیقه)' },
  { key: 'autoread', icon: '📖', title: 'خودخوان پیام‌ها', desc: 'علامت‌خوردن خودکار پیام‌وی/گروه/کانال/منشن‌ها به‌عنوان خوانده‌شده' },
  { key: 'ghost', icon: '👻', title: 'حالت شبح', desc: 'آفلاین دیده شدن، بدون تیک خواندن، بدون نشانگر تایپ' },
  { key: 'stories', icon: '👁', title: 'ویو خودکار استوری', desc: 'دیدن خودکار استوری‌های مخاطبین مشخص' },
  { key: 'react', icon: '❤️', title: 'ری‌اکشن خودکار', desc: 'واکنش تصادفی با احتمال دلخواه به پیام‌های چت‌های مشخص' },
  { key: 'antispam', icon: '🛡', title: 'ضداسپم و فیلتر کلمات', desc: 'حذف خودکار پیام حاوی کلمه ممنوع در گروه‌های شما + اختیار اخراج/مسدود' },
  { key: 'welcome', icon: '👋', title: 'خوش‌آمدگویی گروه', desc: 'پیام خوش‌آمد برای اعضای جدید گروه با قالب {name}' },
  { key: 'watcher', icon: '🔎', title: 'ردیاب کلیدواژه', desc: 'اعلان فوری در پنل وقتی کلیدواژه‌ای در چت‌های تحت نظر بیاید' },
  { key: 'keeper', icon: '💾', title: 'ذخیره‌خودکار رسانه', desc: 'فوروارد خودکار عکس/ویدیو/ویس چت‌های خاص به Saved Messages یا چت دلخواه' },
  { key: 'profile', icon: '🎭', title: 'اتوماسیون پروفایل', desc: 'نام و بیوی زمان‌دار (مثل سورس پایه: ساعت در نام/بیو) + چرخش بیو' },
  { key: 'commands', icon: '⌨️', title: 'دستورات چتی', desc: 'دستورات مستقیم در چت مثل .ping و .tagall — بدون هیچ رباتی' },
]

async function viewFeatures(view) {
  view.innerHTML = `<div class="topbar"><h2>⚡ امکانات</h2><div class="actions" id="feat-sel-wrap"></div></div><div class="spin" style="margin:60px auto"></div>`
  await refreshAccounts(true)
  renderAccountSelect($('#feat-sel-wrap'))
  await renderFeatureCards(view)
}

function renderAccountSelect(wrap) {
  if (!accounts.length) { wrap.innerHTML = '<span class="hint">اول از بخش اکانت‌ها یک سلف اضافه کنید</span>'; return }
  if (!selectedAccount || !accounts.find(a => a.id === selectedAccount)) selectedAccount = accounts[0].id
  wrap.innerHTML = `<select id="acc-sel" style="width:auto;min-width:200px">${accounts.map(a => `<option value="${a.id}" ${a.id === selectedAccount ? 'selected' : ''}>${esc(a.label)} — ${accStatus(a)[1]}</option>`).join('')}</select>`
  $('#acc-sel').onchange = e => { selectedAccount = e.target.value; renderFeatureCards($('#view')) }
}

async function renderFeatureCards(view) {
  if (!selectedAccount) { view.innerHTML = `<div class="topbar"><h2>⚡ امکانات</h2></div><div class="card"><p class="hint" style="padding:20px;text-align:center">اکانتی برای نمایش نیست.</p></div>`; return }
  const r = await api(`/api/a/${selectedAccount}/config`)
  const head = `<div class="topbar"><h2>⚡ امکانات</h2><div class="actions" id="feat-sel-wrap2"></div></div>`
  if (!r.ok) { view.innerHTML = head + `<div class="card"><p class="hint">${esc(r.error)}</p></div>`; return }
  const cfg = r.config
  const wrap = document.createElement('div')
  wrap.innerHTML = head + `<div class="grid c2" id="feat-grid"></div>`
  const grid = $('#feat-grid', wrap)
  for (const f of FEATURE_LIST) {
    grid.appendChild(featureCard(f, cfg))
  }
  view.innerHTML = ''
  view.appendChild(wrap)
  renderAccountSelect($('#feat-sel-wrap2', wrap))
  $('#acc-sel', wrap).onchange = e => { selectedAccount = e.target.value; renderFeatureCards(view) }
}


const linesToList = t => String(t ?? '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)
const listToLines = l => (l ?? []).join('\n')

function featureBody(key, c, body) {
  const F = (html) => { body.innerHTML += html }
  switch (key) {
    case 'secretary':
      F(`<label>حالت</label><select data-f="mode">
          <option value="all" ${c.mode === 'all' ? 'selected' : ''}>پاسخ به همه پیام‌ها</option>
          <option value="first" ${c.mode === 'first' ? 'selected' : ''}>فقط پیام اول هر نفر</option>
          <option value="offline" ${c.mode === 'offline' ? 'selected' : ''}>وقتی آفلاینم</option>
          <option value="keywords" ${c.mode === 'keywords' ? 'selected' : ''}>فقط کلیدواژه‌ها</option>
        </select>
        <div class="kv"><div><label>متن پاسخ عمومی</label><textarea data-f="text">${esc(c.text)}</textarea></div>
        <div><label>متن پاسخِ «بار اول»</label><textarea data-f="firstText">${esc(c.firstText)}</textarea></div></div>
        <div class="kv"><div><label>آستانه آفلاین (دقیقه)</label><input type="number" data-f="offlineAfterMin" value="${c.offlineAfterMin}" dir="ltr"/></div>
        <div><label>دامنه</label><select data-f="scope">
          <option value="pm" ${c.scope === 'pm' ? 'selected' : ''}>فقط پیام‌وی</option>
          <option value="groups" ${c.scope === 'groups' ? 'selected' : ''}>فقط گروه‌ها</option>
          <option value="both" ${c.scope === 'both' ? 'selected' : ''}>هر دو</option>
        </select></div></div>
        <label>پاسخ‌های کلیدواژه‌ای (هر خط: کلمه => پاسخ)</label>
        <textarea data-list="keywords">${c.keywords.map(k => `${k.k} => ${k.reply}`).join('\n')}</textarea>
        <label>نادیده گرفتن (آیدی/یوزرنیم، هر خط یک مورد)</label>
        <textarea data-list="ignore" style="min-height:60px">${esc(listToLines(c.ignore))}</textarea>
        <label class="row" style="gap:8px"><input type="checkbox" data-f="typing" style="width:auto" ${c.typing ? 'checked' : ''}/> شبیه‌سازی تایپ قبل از پاسخ</label>`)
      break
    case 'afk':
      F(`<label>متن پاسخ غیبت</label><textarea data-f="reason">${esc(c.reason)}</textarea>
        <p class="hint">از چت هم می‌توانید با <b dir="ltr">.afk</b> و <b dir="ltr">.afk off</b> کنترل کنید.</p>`)
      break
    case 'forward':
      F(`<label>قوانین (هر خط: از => به | فیلتر | forward یا copy | تاخیرثانیه)</label>
        <textarea data-list="rules">${c.rules.map(r => `${r.from} => ${r.to} | ${r.filter || ''} | ${r.mode} | ${r.delaySec}`).join('\n')}</textarea>
        <p class="hint">مثال: <b dir="ltr">@source_ch => @target_ch | خبر|فوری | copy | 3</b> — برای «همه چت‌ها» از * استفاده کنید.</p>`)
      break
    case 'schedule':
      F(`<label>کارها (هر خط: چت | متن | تاریخ-زمان یا فوری | تکرار دقیقه)</label>
        <textarea data-list="jobs">${c.jobs.map(j => `${j.chat} | ${j.text.replaceAll('\n', ' ')} | ${j.at ? new Date(j.at).toISOString().slice(0, 16) : 'فوری'} | ${j.everyMin || 0}`).join('\n')}</textarea>
        <p class="hint">مثال: <b dir="ltr">@mychannel | صبح بخیر ☀️ | 2026-10-05T08:00 | 1440</b> — تکرار 0 یعنی فقط یک‌بار.</p>`)
      break
    case 'autoread':
      F(`<label class="row" style="gap:8px"><input type="checkbox" data-f="pm" style="width:auto" ${c.pm ? 'checked' : ''}/> پیام‌وی‌ها</label>
        <label class="row" style="gap:8px"><input type="checkbox" data-f="groups" style="width:auto" ${c.groups ? 'checked' : ''}/> گروه‌ها</label>
        <label class="row" style="gap:8px"><input type="checkbox" data-f="channels" style="width:auto" ${c.channels ? 'checked' : ''}/> کانال‌ها</label>
        <label class="row" style="gap:8px"><input type="checkbox" data-f="mentions" style="width:auto" ${c.mentions ? 'checked' : ''}/> منشن‌ها</label>`)
      break
    case 'ghost':
      F(`<label class="row" style="gap:8px"><input type="checkbox" data-f="offline" style="width:auto" ${c.offline ? 'checked' : ''}/> همیشه آفلاین دیده شوم</label>
        <label class="row" style="gap:8px"><input type="checkbox" data-f="noRead" style="width:auto" ${c.noRead ? 'checked' : ''}/> بدون تیک خوانده‌شدن</label>
        <label class="row" style="gap:8px"><input type="checkbox" data-f="noTyping" style="width:auto" ${c.noTyping ? 'checked' : ''}/> بدون نشانگر تایپ</label>
        <p class="hint">با فعال‌سازی «بدون تیک»، خودخوان هم غیرفعال می‌شود.</p>`)
      break
    case 'stories':
      F(`<label>مخاطبین (یوزرنیم یا آیدی، هر خط یک مورد)</label><textarea data-list="peers">${esc(listToLines(c.peers))}</textarea>
        <label>فاصله بین هر مخاطب (ثانیه)</label><input type="number" data-f="delaySec" value="${c.delaySec}" dir="ltr"/>`)
      break
    case 'react':
      F(`<label>ایموجی‌ها (با کاما جدا کنید)</label><input data-list="emojis" value="${esc((c.emojis ?? []).join(', '))}"/>
        <div class="kv"><div><label>احتمال (٪)</label><input type="number" data-f="chance" value="${c.chance}" dir="ltr"/></div>
        <div><label>چت‌ها (هر خط؛ * = همه)</label><textarea data-list="chats" style="min-height:60px">${esc(listToLines(c.chats))}</textarea></div></div>`)
      break
    case 'antispam':
      F(`<label>گروه‌ها (هر خط؛ * = همه گروه‌هایی که ادمینم)</label><textarea data-list="chats" style="min-height:60px">${esc(listToLines(c.chats))}</textarea>
        <label>کلمات ممنوع (هر خط یک کلمه)</label><textarea data-list="words">${esc(listToLines(c.words))}</textarea>
        <label>اقدام</label><select data-f="action">
          <option value="delete" ${c.action === 'delete' ? 'selected' : ''}>فقط حذف پیام</option>
          <option value="delete_kick" ${c.action === 'delete_kick' ? 'selected' : ''}>حذف + اخراج</option>
          <option value="delete_ban" ${c.action === 'delete_ban' ? 'selected' : ''}>حذف + مسدودسازی</option>
        </select>`)
      break
    case 'welcome':
      F(`<label>گروه‌ها (هر خط یک گروه)</label><textarea data-list="chats" style="min-height:60px">${esc(listToLines(c.chats))}</textarea>
        <label>متن خوش‌آمد ({name}، {username}، {chat})</label><textarea data-f="text">${esc(c.text)}</textarea>`)
      break
    case 'watcher':
      F(`<label>کلیدواژه‌ها (هر خط یک مورد)</label><textarea data-list="keywords">${esc(listToLines(c.keywords))}</textarea>
        <label>چت‌ها (خالی = همه)</label><textarea data-list="chats2" data-alias="chats" style="min-height:60px">${esc(listToLines(c.chats))}</textarea>
        <label>ارسال هشدار به چت (اختیاری)</label><input data-f="notifyChat" value="${esc(c.notifyChat ?? '')}" dir="ltr"/>`)
      break
    case 'keeper':
      F(`<label>چت‌ها (هر خط؛ * = همه)</label><textarea data-list="chats" style="min-height:60px">${esc(listToLines(c.chats))}</textarea>
        <label>نوع رسانه‌ها</label><input data-list="types" value="${esc((c.types ?? []).join(', '))}"/>
        <label>مقصد (me = Saved Messages یا یوزرنیم/آیدی)</label><input data-f="toChat" value="${esc(c.toChat)}" dir="ltr"/>`)
      break
    case 'profile':
      F(`<div class="kv"><div><label>نام زمان‌دار</label><label class="switch" style="margin-top:8px"><input type="checkbox" data-f="nameOn" ${c.nameOn ? 'checked' : ''}/><span class="sl"></span></label></div>
        <div><label>بیو چرخشی</label><label class="switch" style="margin-top:8px"><input type="checkbox" data-f="bioOn" ${c.bioOn ? 'checked' : ''}/><span class="sl"></span></label></div></div>
        <label>قالب نام ({name}، {time}، {date})</label><input data-f="nameTpl" value="${esc(c.nameTpl)}" dir="auto"/>
        <label>بیوها (هر خط یک بیو؛ {time} و {date} پشتیبانی می‌شود)</label><textarea data-list="bioList">${esc(listToLines(c.bioList))}</textarea>
        <label>تغییر بیو هر چند دقیقه</label><input type="number" data-f="bioEveryMin" value="${c.bioEveryMin}" dir="ltr"/>`)
      break
    case 'commands':
      F(`<div class="kv"><div><label>پیشوند دستور</label><input data-f="prefix" value="${esc(c.prefix)}" dir="ltr"/></div></div>
        <p class="hint">دستورات: <b dir="ltr">.ping .help .stats .id .info .afk .read .purge .tagall .join .ghost</b> — این دستورات را خودتان در هر چت می‌نویسید و سلف اجرا می‌کند.</p>`)
      break
  }

  const readBack = () => {
    $$('[data-f]', body).forEach(el => {
      const k = el.dataset.f
      if (el.type === 'checkbox') c[k] = el.checked
      else if (el.type === 'number') c[k] = Number(el.value) || 0
      else c[k] = el.value
    })
    $$('[data-list]', body).forEach(el => {
      const k = el.dataset.alias || el.dataset.list
      const raw = el.value
      if (k === 'keywords' && el.dataset.list === 'keywords') {
        c.keywords = linesToList(raw).map(line => {
          const [kk, ...rest] = line.split('=>')
          return { k: (kk ?? '').trim(), reply: rest.join('=>').trim() }
        }).filter(x => x.k && x.reply)
      } else if (el.dataset.list === 'rules') {
        c.rules = linesToList(raw).map(line => {
          const [fromTo, filter = '', mode = 'forward', delay = '0'] = line.split('|').map(s => s.trim())
          const [from, to] = fromTo.split('=>').map(s => s.trim())
          return { id: Math.random().toString(36).slice(2), from: from ?? '', to: to ?? '', filter, mode: mode === 'copy' ? 'copy' : 'forward', delaySec: Number(delay) || 0 }
        }).filter(r => r.from && r.to)
      } else if (el.dataset.list === 'jobs') {
        c.jobs = linesToList(raw).map(line => {
          const parts = line.split('|').map(s => s.trim())
          const chat = parts[0] ?? ''
          const text = parts[1] ?? ''
          const when = parts[2] ?? 'فوری'
          const every = Number(parts[3] ?? 0) || 0
          let at = when === 'فوری' ? Date.now() : (when.includes('T') ? new Date(when).getTime() : Date.now())
          if (isNaN(at)) at = Date.now()
          return { id: Math.random().toString(36).slice(2), chat, text, at, everyMin: every, next: at }
        }).filter(j => j.chat && j.text)
      } else {
        c[k] = linesToList(raw)
      }
    })
  }
  cardReadBack.set(body, readBack)
}

const cardReadBack = new Map()

function featureCard(f, cfg) {
  const c = cfg[f.key]
  const card = document.createElement('div')
  card.className = 'card'
  const isOn = !!c.on
  card.innerHTML = `
    <div class="feat-head">
      <h3>${f.icon} ${f.title}</h3>
      <label class="switch"><input type="checkbox" data-toggle ${isOn ? 'checked' : ''}/><span class="sl"></span></label>
    </div>
    <p class="desc">${f.desc}</p>
    <div class="feat-grid" data-body></div>
    <div class="row end" style="margin-top:12px"><button class="btn sm" data-save>ذخیره</button></div>`
  const body = $('[data-body]', card)
  body.style.opacity = isOn ? 1 : 0.45
  $('[data-toggle]', card).onchange = e => { c.on = e.target.checked; body.style.opacity = e.target.checked ? 1 : 0.45 }
  featureBody(f.key, c, body)
  $('[data-save]', card).onclick = async () => {
    const rb = cardReadBack.get(body)
    if (rb) rb()
    const rr = await api(`/api/a/${selectedAccount}/config`, { method: 'PUT', body: cfg })
    toast(rr.ok ? 'تنظیمات ذخیره شد ✓' : rr.error, rr.ok ? 'ok' : 'err')
  }
  return card
}

/* ---------------- ابزارها ---------------- */
const TOOLS = [
  { id: 'send', icon: '✉️', title: 'ارسال پیام', desc: 'ارسال سریع یک پیام با سلف' },
  { id: 'scrape', icon: '⛏', title: 'اسکرپر اعضا', desc: 'دریافت اعضای گروه/سوپرگروه (تا ۲۰۰ نفر — سقف تلگرام) و خروجی CSV' },
  { id: 'massdm', icon: '📨', title: 'پیام انبوه انسانی‌گونه', desc: 'ارسال به لیست اهداف با تاخیر تصادفی و سقف روزانه ضد بن' },
  { id: 'joiner', icon: '➕', title: 'جوینر گروه‌ها', desc: 'عضویت خودکار در لیست لینک‌ها با فاصله امن' },
  { id: 'tagall', icon: '📣', title: 'تگ‌آل', desc: 'منشن کردن همه اعضای گروه' },
  { id: 'purge', icon: '🧹', title: 'پاک‌سازی پیام‌ها', desc: 'حذف انبوه پیام‌های خودتان یا همه (در گروه‌هایی که ادمینید)' },
  { id: 'forwardnow', icon: '↪️', title: 'فوروارد یکجا', desc: 'انتقال تعدادی پیام آخر یک چت به چت دیگر' },
  { id: 'sessions', icon: '🔐', title: 'مدیریت نشست‌ها', desc: 'دیدن دستگاه‌های متصل و خاتمه دادن به نشست‌های دیگر' },
  { id: 'test', icon: '🩺', title: 'تست سلامت', desc: 'پینگ و وضعیت اتصال' },
]

async function viewTools(view) {
  view.innerHTML = `<div class="topbar"><h2>🛠 ابزارها</h2><div class="actions" id="tool-sel-wrap"></div></div><div class="spin" style="margin:60px auto"></div>`
  await refreshAccounts(true)
  if (!accounts.length) { view.innerHTML = `<div class="topbar"><h2>🛠 ابزارها</h2></div><div class="card"><p class="hint">اول یک اکانت اضافه کنید.</p></div>`; return }
  renderAccountSelect($('#tool-sel-wrap'))
  const grid = document.createElement('div')
  grid.className = 'grid c2'
  for (const t of TOOLS) grid.appendChild(toolCard(t))
  view.innerHTML = ''
  view.appendChild(grid)
  renderAccountSelect($('#tool-sel-wrap'))
  $('#tool-sel-wrap #acc-sel').onchange = e => { selectedAccount = e.target.value }
}

function toolCard(t) {
  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = `<h3>${t.icon} ${t.title}</h3><p class="desc">${t.desc}</p><div class="feat-grid" data-body></div>`
  const body = $('[data-body]', card)
  toolBody(t.id, body, card)
  return card
}

const toolApi = async (action, extra) => {
  if (!selectedAccount) return toast('اکانت انتخاب کنید', 'err')
  return api(`/api/a/${selectedAccount}/tool`, { body: { action, ...extra } })
}

function toolBody(id, body, card) {
  const F = html => { body.innerHTML += html }
  switch (id) {
    case 'send':
      F(`<label>مقصد (یوزرنیم/آیدی)</label><input id="ts-chat" dir="ltr" placeholder="@username یا -1001234"/>
        <label>متن</label><textarea id="ts-text"></textarea>
        <div class="row end" style="margin-top:10px"><button class="btn sm" id="ts-go">ارسال ✉️</button></div>`)
      $('#ts-go', body).onclick = async () => {
        const r = await toolApi('send', { chat: $('#ts-chat', body).value.trim(), text: $('#ts-text', body).value })
        toast(r.ok ? 'ارسال شد ✓' : r.error, r.ok ? 'ok' : 'err')
      }
      break
    case 'scrape':
      F(`<label>گروه (یوزرنیم/آیدی — باید عضو باشید)</label><input id="sc-chat" dir="ltr" placeholder="@group"/>
        <div class="row end" style="margin-top:10px"><button class="btn sm" id="sc-go">اسکرپ ⛏</button></div>
        <div id="sc-out" style="margin-top:10px"></div>`)
      $('#sc-go', body).onclick = async () => {
        const out = $('#sc-out', body)
        out.innerHTML = '<div class="spin" style="margin:10px auto"></div>'
        const r = await toolApi('scrape', { chat: $('#sc-chat', body).value.trim(), limit: 200 })
        if (!r.ok) { out.innerHTML = `<p class="hint" style="color:var(--err)">${esc(r.error)}</p>`; return }
        const d = r.data
        out.innerHTML = `<p class="hint">${d.count} نفر پیدا شد.</p>
          <div class="row"><button class="btn ghost sm" id="sc-csv">⬇️ دانلود CSV</button>
          <button class="btn ghost sm" id="sc-dm">📨 فرستادن به پیام انبوه</button></div>`
        $('#sc-csv', out).onclick = () => {
          const blob = new Blob(['\ufeff' + d.csv], { type: 'text/csv;charset=utf-8' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = 'members.csv'
          a.click()
        }
        $('#sc-dm', out).onclick = () => {
          window.__dmTargets = d.members.filter(m => m.username).map(m => '@' + m.username)
          toast('لیست به ابزار پیام انبوه منتقل شد — پایین بروید', 'ok')
          const dmBox = $('#md-targets', document.body)
          if (dmBox) dmBox.value = window.__dmTargets.join('\n')
        }
      }
      break
    case 'massdm':
      F(`<label>اهداف (هر خط یک یوزرنیم/آیدی)</label><textarea id="md-targets" style="min-height:110px">${esc((window.__dmTargets ?? []).join('\n'))}</textarea>
        <label>متن پیام</label><textarea id="md-text"></textarea>
        <div class="kv-3">
          <div><label>کمینه تاخیر (ثانیه)</label><input type="number" id="md-min" value="20" dir="ltr"/></div>
          <div><label>بیشینه تاخیر (ثانیه)</label><input type="number" id="md-max" value="45" dir="ltr"/></div>
          <div><label>سقف روزانه</label><input type="number" id="md-cap" value="80" dir="ltr"/></div>
        </div>
        <div class="row end" style="margin-top:10px">
          <button class="btn danger sm" id="md-stop">توقف</button>
          <button class="btn sm" id="md-go">شروع ارسال 📨</button>
        </div>
        <div id="md-prog" style="margin-top:12px"></div>`)
      const renderProg = job => {
        if (!job) return
        const pct = Math.round((job.idx / Math.max(1, job.targets.length)) * 100)
        $('#md-prog', body).innerHTML = `<div class="pbar"><i style="width:${pct}%"></i></div>
          <p class="hint">ارسال‌شده: ${job.sent} | خطا: ${job.errors} | پیشرفت: ${job.idx}/${job.targets.length} ${job.active ? '⏳ در جریان' : '⏹ متوقف/تمام'}</p>`
      }
      $('#md-go', body).onclick = async () => {
        const r = await toolApi('massdm_start', {
          targets: $('#md-targets', body).value,
          text: $('#md-text', body).value,
          minDelaySec: Number($('#md-min', body).value) || 20,
          maxDelaySec: Number($('#md-max', body).value) || 45,
          dailyCap: Number($('#md-cap', body).value) || 80,
        })
        if (!r.ok) return toast(r.error, 'err')
        toast('شروع شد — در پس‌زمینه ادامه می‌یابد', 'ok')
        renderProg(r.job)
        const iv = setInterval(async () => {
          const s = await api(`/api/a/${selectedAccount}/state`)
          if (s.ok && s.massdm) { renderProg(s.massdm); if (!s.massdm.active) clearInterval(iv) } else clearInterval(iv)
        }, 5000)
      }
      $('#md-stop', body).onclick = async () => { const r = await toolApi('massdm_stop', {}); toast(r.ok ? 'متوقف شد' : r.error, 'ok') }
      break
    case 'joiner':
      F(`<label>لینک‌ها یا یوزرنیم‌ها (هر خط یک مورد)</label><textarea id="jn-links" style="min-height:100px" placeholder="https://t.me/joinchat/xxx&#10;@groupname"></textarea>
        <div class="kv"><div><label>کمینه فاصله (ثانیه)</label><input type="number" id="jn-min" value="10" dir="ltr"/></div>
        <div><label>بیشینه فاصله (ثانیه)</label><input type="number" id="jn-max" value="25" dir="ltr"/></div></div>
        <div class="row end" style="margin-top:10px">
          <button class="btn danger sm" id="jn-stop">توقف</button>
          <button class="btn sm" id="jn-go">شروع ➕</button>
        </div><div id="jn-prog" style="margin-top:12px"></div>`)
      $('#jn-go', body).onclick = async () => {
        const r = await toolApi('joiner_start', {
          links: $('#jn-links', body).value,
          minDelaySec: Number($('#jn-min', body).value) || 10,
          maxDelaySec: Number($('#jn-max', body).value) || 25,
        })
        if (!r.ok) return toast(r.error, 'err')
        toast('جوینر شروع شد', 'ok')
      }
      $('#jn-stop', body).onclick = async () => { await toolApi('joiner_stop', {}); toast('متوقف شد', 'ok') }
      break
    case 'tagall':
      F(`<label>گروه</label><input id="ta-chat" dir="ltr" placeholder="@group"/>
        <label>متن همراه (اختیاری)</label><input id="ta-text" placeholder="👋"/>
        <div class="row end" style="margin-top:10px"><button class="btn sm" id="ta-go">منشن همه 📣</button></div>`)
      $('#ta-go', body).onclick = async () => {
        const r = await toolApi('tagall', { chat: $('#ta-chat', body).value.trim(), text: $('#ta-text', body).value })
        toast(r.ok ? `${r.data.mentioned} نفر منشن شدند` : r.error, r.ok ? 'ok' : 'err')
      }
      break
    case 'purge':
      F(`<label>گروه</label><input id="pg-chat" dir="ltr" placeholder="@group"/>
        <div class="kv"><div><label>تعداد</label><input type="number" id="pg-count" value="100" dir="ltr"/></div>
        <div><label>دامنه</label><select id="pg-scope"><option value="mine">فقط پیام‌های من</option><option value="all">همه (ادمین)</option></select></div></div>
        <div class="row end" style="margin-top:10px"><button class="btn danger sm" id="pg-go">پاک‌سازی 🧹</button></div>`)
      $('#pg-go', body).onclick = async () => {
        if (!confirm('مطمئنی؟ حذف برگشت‌پذیر نیست!')) return
        const r = await toolApi('purge', { chat: $('#pg-chat', body).value.trim(), count: Number($('#pg-count', body).value) || 100, scope: $('#pg-scope', body).value })
        toast(r.ok ? `${r.data.deleted} پیام حذف شد` : r.error, r.ok ? 'ok' : 'err')
      }
      break
    case 'forwardnow':
      F(`<label>از چت</label><input id="fw-from" dir="ltr" placeholder="@from"/>
        <label>به چت</label><input id="fw-to" dir="ltr" placeholder="@to"/>
        <label>تعداد پیام آخر</label><input type="number" id="fw-n" value="10" dir="ltr"/>
        <div class="row end" style="margin-top:10px"><button class="btn sm" id="fw-go">فوروارد ↪️</button></div>`)
      $('#fw-go', body).onclick = async () => {
        const r = await toolApi('forward_now', { from: $('#fw-from', body).value.trim(), to: $('#fw-to', body).value.trim(), limit: Number($('#fw-n', body).value) || 10 })
        toast(r.ok ? `${r.data.forwarded} پیام فوروارد شد` : r.error, r.ok ? 'ok' : 'err')
      }
      break
    case 'sessions':
      F(`<div class="row end"><button class="btn sm ghost" id="ss-load">بارگذاری نشست‌ها 🔐</button>
        <button class="btn danger sm" id="ss-kill-all">خروج همه دستگاه‌های دیگر</button></div>
        <div id="ss-out" style="margin-top:10px"></div>`)
      $('#ss-load', body).onclick = async () => {
        const out = $('#ss-out', body)
        out.innerHTML = '<div class="spin" style="margin:10px auto"></div>'
        const r = await toolApi('sessions_list', {})
        if (!r.ok) { out.innerHTML = `<p class="hint" style="color:var(--err)">${esc(r.error)}</p>`; return }
        out.innerHTML = `<table><tbody>${r.data.sessions.map((s, i) => `
          <tr><td><b>${esc(s.device)}</b><br/><span class="hint">${esc(s.country)} · ${esc(s.ip)} · ${faTime(Date.parse(s.dateActive) || 0)}</span></td>
          <td style="text-align:left">${s.current ? '<span class="chip on">دستگاه فعلی</span>' : `<button class="btn danger sm" data-ss="${esc(s.hash)}">خاتمه</button>`}</td></tr>`).join('')}</tbody></table>`
        $$('[data-ss]', out).forEach(b => b.onclick = async () => {
          const rr = await toolApi('sessions_terminate', { hash: b.dataset.ss })
          toast(rr.ok ? 'نشست خاتمه یافت' : rr.error, rr.ok ? 'ok' : 'err')
          $('#ss-load', body).click()
        })
      }
      $('#ss-kill-all', body).onclick = async () => {
        if (!confirm('همه نشست‌های دیگر (حتی تلگرام گوشی!) خارج می‌شوند. ادامه؟')) return
        const r = await toolApi('sessions_terminate_others', {})
        toast(r.ok ? 'انجام شد' : r.error, r.ok ? 'ok' : 'err')
      }
      break
    case 'test':
      F(`<div class="row end" style="margin-top:6px"><button class="btn sm" id="tt-go">تست پینگ 🩺</button></div>
        <p class="hint" id="tt-out" style="margin-top:10px"></p>`)
      $('#tt-go', body).onclick = async () => {
        const r = await toolApi('test', {})
        $('#tt-out', body).textContent = r.ok ? `پاسخ: ${r.data.pongMs}ms — وضعیت: ${r.data.status}` : r.error
      }
      break
  }
}

/* ---------------- لاگ زنده ---------------- */
async function viewLogs(view) {
  view.innerHTML = `
  <div class="topbar"><h2>📜 لاگ زنده</h2><div class="actions">
    <select id="lg-filter" style="width:auto"><option value="">همه</option><option value="success">موفق</option><option value="warn">هشدار</option><option value="error">خطا</option><option value="info">اطلاع</option></select>
    <button class="btn ghost sm" id="lg-clear">پاک‌کردن نمایش</button>
  </div></div>
  <div class="logbox" id="logbox"></div>`
  const box = $('#logbox')
  let filter = ''
  $('#lg-filter').onchange = e => { filter = e.target.value; [...box.children].forEach(l => { l.style.display = !filter || l.dataset.level === filter ? '' : 'none' }) }
  $('#lg-clear').onclick = () => (box.innerHTML = '')
  sseSource = new EventSource('/api/logs/stream')
  sseSource.onmessage = ev => {
    try {
      const e = JSON.parse(ev.data)
      const div = document.createElement('div')
      div.className = 'logline ' + e.level
      div.dataset.level = e.level
      div.innerHTML = `<span class="t">${new Date(e.ts).toLocaleTimeString('fa-IR')}</span><span dir="auto">${e.label ? `<b>[${esc(e.label)}]</b> ` : ''}${esc(e.msg)}</span>`
      if (filter && e.level !== filter) div.style.display = 'none'
      box.appendChild(div)
      while (box.children.length > 400) box.firstChild.remove()
      box.scrollTop = box.scrollHeight
    } catch {}
  }
  // اعلان‌ها را هم تازه کن
  loadNotifs()
}

async function loadNotifs() {
  const r = await api('/api/notifications')
  if (r.ok) window.__notifs = r.notifications
}

/* ---------------- تنظیمات ---------------- */
async function viewSettings(view) {
  await loadNotifs()
  const s = await api('/api/settings')
  view.innerHTML = `
  <div class="topbar"><h2>⚙️ تنظیمات</h2><div class="actions"><button class="btn danger sm" id="st-logout">خروج از پنل</button></div></div>
  <div class="grid c2">
    <div class="card">
      <h3>🔑 اطلاعات اتصال</h3>
      <table><tbody>
        <tr><td>API ID</td><td dir="ltr" style="text-align:left">${val(s.apiId)}</td></tr>
        <tr><td>API Hash</td><td dir="ltr" style="text-align:left">${esc(String(s.apiHash ?? '').slice(0, 6))}••••••••</td></tr>
        <tr><td>Bot Token</td><td dir="ltr" style="text-align:left">${s.botToken ? esc(s.botToken.slice(0, 8)) + '••••' : '— (بدون ربات، درست مثل چیزی که می‌خواستی!)'}</td></tr>
        <tr><td>تاریخ نصب</td><td style="text-align:left">${faTime(s.createdAt ?? 0)}</td></tr>
      </tbody></table>
    </div>
    <div class="card">
      <h3>🛡 تغییر رمز عبور ادمین</h3>
      <label>رمز فعلی</label><input id="cp-cur" type="password" dir="ltr"/>
      <label>رمز جدید (حداقل ۸ نویسه)</label><input id="cp-new" type="password" dir="ltr"/>
      <div class="row end" style="margin-top:12px"><button class="btn sm" id="cp-go">تغییر رمز</button></div>
    </div>
    <div class="card">
      <h3>💾 بکاپ رمزنگاری‌شده</h3>
      <p class="desc">خروجی شامل نشست‌های رمزنگاری‌شده‌ی همه اکانت‌ها و تنظیمات است. رمز بکاپ را جایی امن نگه دارید — بدون آن بازیابی ممکن نیست.</p>
      <label>رمز بکاپ (حداقل ۸ نویسه)</label><input id="bk-pw" type="password" dir="ltr"/>
      <div class="row end" style="margin-top:12px"><button class="btn sm" id="bk-go">⬇️ ساخت فایل بکاپ</button></div>
    </div>
    <div class="card">
      <h3>♻️ بازیابی بکاپ</h3>
      <p class="desc">فایل بکاپ + رمزش را وارد کنید؛ اکانت‌ها و تنظیمات بازمی‌گردند.</p>
      <label>فایل بکاپ</label><input type="file" id="rs-file" accept=".json"/>
      <label>رمز بکاپ</label><input id="rs-pw" type="password" dir="ltr"/>
      <div class="row end" style="margin-top:12px"><button class="btn sm" id="rs-go">بازیابی</button></div>
    </div>
  </div>`
  $('#st-logout').onclick = async () => { await api('/api/logout', { body: {} }); location.reload() }
  $('#cp-go').onclick = async () => {
    const r = await api('/api/change-password', { body: { current: $('#cp-cur').value, next: $('#cp-new').value } })
    toast(r.ok ? 'رمز تغییر کرد ✓ از دفعه بعد با رمز جدید وارد شوید' : r.error, r.ok ? 'ok' : 'err')
  }
  $('#bk-go').onclick = async () => {
    const r = await api('/api/backup', { body: { password: $('#bk-pw').value } })
    if (!r.ok) return toast(r.error, 'err')
    const blob = new Blob([JSON.stringify({ selfhub_backup: r.backup, accounts: r.accounts }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `selfhub-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    toast('بکاپ ساخته شد ✓', 'ok')
  }
  $('#rs-go').onclick = async () => {
    const f = $('#rs-file').files[0]
    if (!f) return toast('فایل را انتخاب کنید', 'err')
    try {
      const parsed = JSON.parse(await f.text())
      const backup = parsed.selfhub_backup ?? parsed.backup
      const r = await api('/api/restore', { body: { backup, password: $('#rs-pw').value } })
      toast(r.ok ? `${r.restored} اکانت بازیابی شد ✓` : r.error, r.ok ? 'ok' : 'err')
    } catch { toast('فایل نامعتبر است', 'err') }
  }
}

boot()
