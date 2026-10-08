/* SelfHub — ابزارهای مشترک: کریپتو، زمان، هوک‌های HTTP
 * همه‌چیز روی WebCrypto؛ بدون وابستگی خارجی.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

/* ---------------- base64 ---------------- */

export function b64encode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function b64decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesFromB64(s: string): Uint8Array {
  return b64decode(s)
}

/* ---------------- تصادف و شناسه ---------------- */

export function randBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

export function randHex(n: number): string {
  return [...randBytes(n)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** عدد صحیح تصادفی در بازه‌ی [min,max] */
export function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

export function id(prefix = ''): string {
  return prefix + Date.now().toString(36) + randHex(4)
}

/* ---------------- HMAC / SHA ---------------- */

async function hmacKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secret as unknown as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

export async function hmacHex(secret: Uint8Array, msg: string): Promise<string> {
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg) as unknown as ArrayBuffer)
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** مقایسه‌ی امضا به‌شکل constant-time (با crypto.subtle.verify) */
export async function hmacVerifyHex(secret: Uint8Array, msg: string, sigHex: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(sigHex)) return false
  const key = await hmacKey(secret)
  const expected = await hmacHex(secret, msg)
  if (expected.length !== sigHex.length) return false
  const sig = new Uint8Array(sigHex.length / 2)
  for (let i = 0; i < sig.length; i++) sig[i] = Number.parseInt(sigHex.slice(i * 2, i * 2 + 2), 16)
  const ok = await crypto.subtle.verify('HMAC', key, sig as unknown as ArrayBuffer, enc.encode(msg) as unknown as ArrayBuffer)
  return ok === true
}

export async function sha256Hex(data: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(data) as unknown as ArrayBuffer)
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/* ---------------- رمز عبور ---------------- */

export interface PwHash {
  salt: string
  hash: string
  iter: number
}

export async function pbkdf2Hash(password: string, iterations = 210_000): Promise<PwHash> {
  const salt = randBytes(16)
  const key = await crypto.subtle.importKey('raw', enc.encode(password) as unknown as ArrayBuffer, 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as unknown as ArrayBuffer, iterations, hash: 'SHA-256' }, key, 256)
  return { salt: b64encode(salt), hash: b64encode(bits), iter: iterations }
}

export async function pbkdf2Verify(password: string, saltB64: string, hashB64: string, iterations: number): Promise<boolean> {
  const salt = b64decode(saltB64)
  const key = await crypto.subtle.importKey('raw', enc.encode(password) as unknown as ArrayBuffer, 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as unknown as ArrayBuffer, iterations, hash: 'SHA-256' }, key, 256)
  return timingSafeB64Equal(b64encode(bits), hashB64)
}

/** مقایسه‌ی دو رشته با زمان ثابت */
export function timingSafeB64Equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function passwordStrength(pw: string): { ok: boolean; score: number; message?: string } {
  if (pw.length < 10) return { ok: false, score: 0, message: 'رمز عبور پنل باید حداقل ۱۰ نویسه باشد' }
  let score = 1
  if (pw.length >= 14) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^a-zA-Z0-9]/.test(pw)) score++
  const weak = ['password', '123456', '12345678', 'admin123', 'selfhub'].some(w => pw.toLowerCase().includes(w))
  if (weak) return { ok: false, score: 1, message: 'این رمز خیلی رایج و قابل حدس است' }
  return { ok: true, score: Math.min(score, 5) }
}

/* ---------------- AES-GCM (رمزنگاری توکن و بکاپ) ---------------- */

export async function aesKeyFromBytes(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as unknown as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function deriveAesKey(password: string, salt: Uint8Array, iterations = 250_000): Promise<CryptoKey> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password) as unknown as ArrayBuffer, 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as ArrayBuffer, iterations, hash: 'SHA-256' },
    key,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function aesEncrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = randBytes(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer }, key, enc.encode(plaintext) as unknown as ArrayBuffer)
  const buf = new Uint8Array(12 + ct.byteLength)
  buf.set(iv, 0)
  buf.set(new Uint8Array(ct), 12)
  return b64encode(buf)
}

export async function aesDecrypt(key: CryptoKey, payloadB64: string): Promise<string> {
  const buf = b64decode(payloadB64)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf.slice(0, 12) as unknown as ArrayBuffer },
    key,
    buf.slice(12) as unknown as ArrayBuffer,
  )
  return dec.decode(pt)
}

/* ---------------- HTTP ---------------- */

export function json(data: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  })
}

export function err(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status)
}

export async function readJson<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    return {} as T
  }
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k) out[k] = v.join('=')
  }
  return out
}

/* ---------------- زمان ---------------- */

export function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

export function dayKey(tsMs: number, tzOffsetMin = 0): string {
  const d = new Date(tsMs + tzOffsetMin * 60_000)
  return d.toISOString().slice(0, 10)
}

export function hourKey(tsMs: number, tzOffsetMin = 0): number {
  return Math.floor((tsMs + tzOffsetMin * 60_000) / 3_600_000)
}

export function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, Math.max(0, Math.min(ms, 60_000))))
}

export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/** عدد از query string یا body با پیش‌فرض — ورودی پنل هیچ‌وقت قابل‌اعتماد نیست */
export function intOr(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

export function toInt(v: unknown, fallback: number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : fallback
  const s = String(v ?? '').trim()
  if (!/^-?\d+$/.test(s)) return fallback
  return Number.parseInt(s, 10)
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** برچسب انسانی برای مدت (میلی‌ثانیه) */
export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} ثانیه`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} دقیقه`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ساعت و ${m % 60} دقیقه`
  return `${Math.floor(h / 24)} روز و ${h % 24} ساعت`
}
