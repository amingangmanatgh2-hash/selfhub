<div dir="rtl">

# 🚀 DEPLOY.md — دپلوی SelfHub روی Cloudflare

SelfHub یک پروژه‌ی **Cloudflare Workers + Durable Objects** است؛ بدون سرور، بدون دیتابیس خارجی، بدون Docker.

---

## روش ۱ — دکمه‌ی «Deploy to Cloudflare» (ساده‌ترین)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/amingangmanatgh2-hash/Gaming-hub-)

1. روی دکمه‌ی بالا کلیک کنید.
2. اگر حساب Cloudflare ندارید، رایگان بسازید (ایمیل + رمز).
3. اجازه‌ی دسترسی به ریپازیتوری را تأیید کنید.
4. صبر کنید تا نصب و دپلوی تمام شود (حدود ۱ دقیقه).
5. روی آدرس `https://selfhub.<اسم-حساب>.workers.dev` بروید — **منوی ستاپ** باز می‌شود.

> **نکته:** دکمه از شاخه‌ی پیش‌فرض (`main`) ریپازیتوری دپلوی می‌کند. اگر تغییرات روی Pull Request است، اول آن را merge کنید یا از روش ۲ استفاده کنید.

---

## روش ۲ — دپلوی دستی با Wrangler (کنترل کامل)

```bash
# ۱) گرفتن سورس
git clone https://github.com/amingangmanatgh2-hash/Gaming-hub-.git
cd Gaming-hub-

# ۲) نصب وابستگی‌ها
npm install

# ۳) ورود به Cloudflare (مرورگر باز می‌شود)
npx wrangler login

# ۴) دپلوی 🚀
npx wrangler deploy
```

خروجی، آدرس پنل شماست:

```
Published selfhub (x.xx sec)
  https://selfhub.your-account.workers.dev
```

### دامنه اختصاصی (اختیاری)

در داشبورد Cloudflare → Workers & Pages → `selfhub` → Settings → Domains & Routes → **Add Custom Domain**.

---

## بعد از دپلوی — راه‌اندازی اولیه

۱. سایت را باز کنید؛ **ویزارد نصب** نمایش داده می‌شود:

| فیلد | از کجا؟ | الزامی؟ |
|---|---|---|
| **API ID** | [my.telegram.org](https://my.telegram.org) → API development tools | ✅ |
| **API Hash** | همان‌جا، ۳۲ نویسه هگز | ✅ |
| **Bot Token** | [@BotFather](https://t.me/BotFather) — فقط برای افزودن یک اکانت رباتی به پنل | ❌ اختیاری |
| **رمز عبور ادمین** | حداقل ۸ نویسه — این رمز را هر بار برای ورود به پنل می‌زنید | ✅ |

۲. بعد از ذخیره، وارد پنل می‌شوید: **اکانت‌ها ← افزودن اکانت** → شماره → کد تلگرام → (در صورت نیاز) رمز ۲FA.

۳. از بخش **امکانات** قابلیت‌ها را روشن کنید؛ از **ابزارها** اسکرپر/انبوه/تگ‌آل/… را اجرا کنید.

💡 ترجیح می‌دهید اول ببینید؟ در ویزارد نصب دکمه‌ی **«اول با حالت نمایشی ببین»** را بزنید — بدون اکانت واقعی، کل پنل قابل گشت‌وگذار است.

---

## نکته‌ها و عیب‌یابی

- **اتصال سلف برقرار نمی‌شود؟** ابتدا `https://<آدرس-پنل>/api/wstest` را باز کنید — اگر خطای `Network connection lost` دیدید یعنی اتصال خروجی WebSocket بسته است (در برخی شبکه‌های سازمانی/کشوری رخ می‌دهد).
- **`wrangler dev` لوکال:** پنل و حالت نمایشی کامل کار می‌کنند، اما اتصال واقعی به تلگرام در dev لوکال پشتیبانی نمی‌شود (محدودیت شناخته‌شده‌ی workerd). برای تست واقعی: `npx wrangler dev --remote` یا دپلوی.
- **پلن حساب:** اجرای ۲۴/۷ سلف‌ها = Durable Object همیشه‌فعال؛ برای استفاده‌ی جدی، پلن **Workers Paid (۵ دلار/ماه)** را فعال کنید (مصرف یک سلف معمولاً در اعتبار ماهانه‌ی همان پلن جا می‌شود).
- **به‌روزرسانی:**
  ```bash
  git pull
  npx wrangler deploy
  ```
- **حذف کامل:** در داشبورد Cloudflare، Worker را Delete کنید؛ یا `npx wrangler delete`.
- **امنیت:** رمز ادمین را قبی نگه دارید؛ نشست‌ها AES-GCM رمزنگاری شده‌اند و ورود ۵ بار اشتباه = قفل ۵ دقیقه. از بخش تنظیمات همیشه بکاپ رمزنگاری‌شده بگیرید.

</div>
