/* SelfHub — ابزارهای مشترک (کریپتو، شناسه، زمان) */

const enc = new TextEncoder()
const dec = new TextDecoder()

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

export function randBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

export function id(prefix = ''): string {
  const b = randBytes(4)
  const hex = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return prefix + Date.now().toString(36) + hex.slice(0, 8)
}

/** HMAC-SHA256 → hex */
export async function hmacHex(secret: Uint8Array, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secret.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg) as unknown as ArrayBuffer)
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(data: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(data) as unknown as ArrayBuffer)
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** PBKDF2-SHA256 — هش رمز ادمین */
export async function pbkdf2Hash(password: string, iterations = 100_000): Promise<{ salt: string; hash: string; iter: number }> {
  const salt = randBytes(16)
  const key = await crypto.subtle.importKey('raw', enc.encode(password) as unknown as ArrayBuffer, 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations, hash: 'SHA-256' }, key, 256)
  return { salt: b64encode(salt), hash: b64encode(bits), iter: iterations }
}

export async function pbkdf2Verify(password: string, saltB64: string, hashB64: string, iterations: number): Promise<boolean> {
  const salt = b64decode(saltB64)
  const key = await crypto.subtle.importKey('raw', enc.encode(password) as unknown as ArrayBuffer, 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations, hash: 'SHA-256' }, key, 256)
  const got = b64encode(bits)
  // مقایسه زمان-ثابت
  if (got.length !== hashB64.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ hashB64.charCodeAt(i)
  return diff === 0
}

/** مشتق کلید AES از رمز (برای بکاپ) */
export async function deriveAesKey(password: string, salt: Uint8Array, iterations = 250_000): Promise<CryptoKey> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password) as unknown as ArrayBuffer, 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations, hash: 'SHA-256' },
    key,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** رمزنگاری AES-GCM → base64(iv + ciphertext) */
export async function aesEncrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = randBytes(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv.buffer as ArrayBuffer }, key, enc.encode(plaintext) as unknown as ArrayBuffer)
  const buf = new Uint8Array(12 + ct.byteLength)
  buf.set(iv, 0)
  buf.set(new Uint8Array(ct), 12)
  return b64encode(buf)
}

export async function aesDecrypt(key: CryptoKey, payloadB64: string): Promise<string> {
  const buf = b64decode(payloadB64)
  const iv = buf.slice(0, 12)
  const ct = buf.slice(12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv.buffer as ArrayBuffer }, key, ct.buffer as ArrayBuffer)
  return dec.decode(pt)
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function readJson<T = any>(req: Request): Promise<T> {
  try {
    return await req.json<T>()
  } catch {
    return {} as T
  }
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

export function fmtTime(ts: number): string {
  return new Date(ts).toISOString()
}

/** تأخیر تصادفی در بازه [min,max] میلی‌ثانیه — برای رفتار انسانی */
export function humanDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(minMs + Math.random() * Math.max(0, maxMs - minMs))
  return new Promise(r => setTimeout(r, ms))
}

/** بررسی قدرت رمز */
export function passwordStrength(pw: string): { ok: boolean; score: number; message?: string } {
  if (pw.length < 8) return { ok: false, score: 0, message: 'رمز باید حداقل ۸ نویسه باشد' }
  let score = 0
  if (pw.length >= 10) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^a-zA-Z0-9]/.test(pw)) score++
  return { ok: true, score: Math.min(score, 4) }
}

export function isValidApiHash(h: string): boolean {
  return /^[0-9a-f]{32}$/i.test(h)
}

export function isValidBotToken(t: string): boolean {
  return /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(t)
}

export function isValidPhone(p: string): boolean {
  return /^\+?\d{7,15}$/.test(p.replace(/[\s()-]/g, ''))
}
