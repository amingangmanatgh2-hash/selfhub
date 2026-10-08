<div dir="rtl">

# 🔀 مهاجرت از نسخهٔ ۱ (سلف‌بات/mtcute) به نسخهٔ ۲

اگر نسخهٔ ۱ را دیپلوی کرده‌ای، این صفحه برای توست.

## خلاصه

| | نسخهٔ ۱ | نسخهٔ ۲ |
|---|---|---|
| اتصال | MTProto با اکانت کاربری، سوکت خروجی دائمی | **Bot API** با وب‌هوک |
| کلاس DO | `SelfDO` (+ KV + R2) | `HubDO` (SQLite داخلی DO) |
| ذخیرهٔ داده | KV/R2/فایل نشست | SQLite یکپارچه، تراکنشی |
| ورود | `startLogin` / QR / کد `my.telegram.org` | توکن BotFather |
| حجم باندل | ≈ ۲.۴ MB (WASM) | ≈ ۱۳۸ KB |
| وابستگی runtime | `@mtcute/*`، `@cloudflare/…`، … | **هیچ** (فقط devDeps) |
| احراز هویت پنل | in-memory | PBKDF2 + کوکی HMAC + قفل روی دیسک |

**دادهٔ نسخهٔ ۱ منتقل نمی‌شود.** ساختار جداول و مفهوم «اکانت» عوض شده؛ آنچه در KV/R2 بود (لیست چت‌های سلف‌بات، نشست‌ها، تنظیمات ماژول‌ها) در v2 جای معادلِ مستقیم ندارد. کاری که باید بکنی: خروجی گرفتن دستی در صورت نیاز، سپس ست کردن مجدد تنظیمات از پنل (یا `PUT /api/chats/:id/settings`).

## ۱) قبل از دیپلوی

```bash
# اگر تنظیمات مهمی داری، از پنل v1 یا از KV backup بگیر
npx wrangler kv namespace list
npx wrangler kv key get --binding SELF_KV --namespace-id <ID> settings --preview=false > backup.json
```

## ۲) حذف کلاس قدیمیِ Durable Object

`HubDO` کلاس تازه است؛ اما `SelfDO` باید صریحاً حذف شود وگرنه منابعش (و SQLite نشسته‌اش) باقی می‌ماند. دو راه:

**الف) با migration (توصیه):** در `wrangler.jsonc` یک تگ تازه اضافه کن و **یک بار** دیپلوی کن:

```jsonc
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["HubDO"] },        // این از اول در ریپو هست
  { "tag": "v2-selfdo-removal", "delete_classes": [{ "name": "SelfDO" }] }
]
```

```bash
npx wrangler deploy          # migration اعمال می‌شود
```

> ⚠️ `delete_classes` **بازگشت‌ناپذیر** است: دادهٔ `SelfDO` پاک می‌شود. اول backup بگیر.

**ب) حذف R2/KV:** اگر `SELF_KV` یا بکت‌های R2 را لازم نداری، بایندینگ‌هایشان را از `wrangler.jsonc` بردار و namespace را با `npx wrangler kv namespace delete` پاک کن (با `wrangler r2 bucket delete` برای R2).

## ۳) پاک‌کردن تنظیمات قدیمیِ محیط

```bash
npx wrangler secret delete API_ID   2>/dev/null || true
npx wrangler secret delete API_HASH 2>/dev/null || true
npx wrangler secret delete SESSION   2>/dev/null || true
npx wrangler secret delete ADMIN_IDS 2>/dev/null || true
```

موارد لازم در v2: `BOT_TOKEN` (اختیاری — از پنل هم ست می‌شود)، `ADMIN_PASSWORD` (اختیاری)، `SECRET` (توصیه می‌شود؛ اگر نباشد یک بذر تصادفی در DO ساخته و ذخیره می‌شود).

## ۴) دیپلوی و نصب

```bash
git pull
npm install
npm run check            # typecheck + 77 تست + بیلد
npx wrangler deploy
```

سایت را باز کن → فرم «ساخت پنل» → توکن + رمز → ربات را در گروه‌هایت **ادمین** کن و `/setprivacy` را خاموش کن.

## ۵) کارهایی که دیگر لازم نیست

- نگه‌داشتن یک پروسهٔ زنده / سرور دائمی / keep-alive
- ساخت Session و تازه‌کردنش
- ماژول‌های `src/modules/*` (حذف شده‌اند؛ فایل‌های v1 در git history هستند: `git show 92203fc:src/self.do.ts`)
- `@cloudflare/workers-types` + `@mtcute/wasm` در `dependencies`

## ۶) اگر خواستی v1 را نگه داری

کافی است `src/self.do.ts` و `wrangler.jsonc` نسخهٔ قبل را برگردانی — ولی روی Workers کار نمی‌کند (دلیلش در `docs/ARCHITECTURE.md`) و ماژول‌های اسپمش را هم من برنمی‌گردانم. اگر واقعاً به اکانت کاربری نیاز داری، جای درست آن VPS است، نه Serverless.

## اسکوئرمای v2

```
config(key, value)                        ← نصب، هش+salt رمز، توکن رمزنگاری‌شده، بذر امضا، lockout ورود
chats(id, title, type, settings, members, created_at, updated_at, last_seen, active)
keywords(id, chat_id, pattern, reply, mode, enabled, hits, created_at)
notes(chat_id, name, text, created_by, created_at, hits)        ← کلید اصلی (chat_id,name)
warns(chat_id, user_id, points, reason, updated_at)             ← کلید اصلی (chat_id,user_id)
modlog(id, chat_id, action, target_id, target_name, moderator, reason, ts)
schedule(id, chat_id, text, at, every_min, enabled, note, created_by, last_sent, sent_count)
stats_day(chat_id, day, msgs, members, deleted, warns, mutes, bans, replies, commands)
stats_hour(chat_id, hour, msgs)
verify(chat_id, user_id, msg_id, exp)                            ← کپچا
events(id, ts, level, msg, chat_id)                              ← لاگ زندهٔ SSE
```

ایندکس‌ها: `idx_events_ts`، `idx_modlog_chat(chat_id,ts)`، `idx_schedule_at(at)`.

اسکیمای v2 با `CREATE TABLE IF NOT EXISTS` در `src/hub.do.ts` نوشته می‌شود. برای افزودن ستون در آینده، این الگو را استفاده کن (یک‌بار مصرف، بعد از اعمال حذفش نمی‌کنم چون بی‌ضرر است):

```ts
// داخل boot()، بعد از exec(SCHEMA):
try { this.ctx.storage.sql.exec(`ALTER TABLE chats ADD COLUMN foo TEXT`) } catch { /* ستون وجود دارد */ }
```
