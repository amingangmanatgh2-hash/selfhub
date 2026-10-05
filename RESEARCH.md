<div dir="rtl">

# 📚 RESEARCH.md — گزارش تحقیق SelfHub

این گزارش خلاصه‌ی کاری است که برای ساخت SelfHub انجام شد: اسکرپ و تحلیل **۳ سورس اصلی** که سفارش داده شده بود، به‌همراه مطالعه‌ی **بیش از ۵۰ سایت، ریپازیتوری و کتابخانه‌ی دیگر** در اکوسیستم سلف‌بات/یوزربات تلگرام.

- 🟢 = مطالعه عمیق (کلون/اسکرپ و خواندن کد یا صفحه کامل)
- 🟡 = مرور کاتالوگ امکانات و مستندات

---

## بخش ۱ — سه سورس اصلی

### ۱. `MhdiTaheri/TelegramSelf` 🟢 — سورس پایه

- **کلون و تحلیل کامل شد** (پایتون + Telethon، لایسنس GPL-3.0، ~۲۲۰۰ خط).
- ساختار: `main.py` (ثبت ~۷۰ دستور رویدادی)، `helper.py` (**ربات هلپر** با اینلاین کوئری و دکمه‌های شیشه‌ای)، `lib/command.py` (پیاده‌سازی دستورات)، `lib/library.py`، `lib/updater.py`.
- **مشکل اصلی که در SelfHub حل شد:** پنل و راهنما فقط از طریق `helper.py` (یک ربات جداگانه از BotFather با inline) کار می‌کند؛ یعنی علاوه بر سلف، باید یک ربات هم همیشه روشن باشد و در هر چت `/help` را اینلاین می‌کند. در SelfHub تمام کنترل به پنل وب منتقل شد.
- **قابلیت‌هایی که از این سورس برداشت و بازنویسی شد:** زمان در نام (`timename`)، زمان در بیو (`bio`)، فونت‌های نام، ذخیره‌ی خودکار رسانه‌ی یک‌بار‌مصرف، `/info` کاربر با ریپلای، پاک‌سازی پیام‌ها (`/rem`, `DelPhotos`, `DelGifs`, …)، خواندن انبوه (`ReadAllPvs`, `ReadallGps`, `ReadAllChannels`, `ReadAllBots`) → تبدیل شد به «خودخوان» با کلیدهای جداگانه، `/tag` → «تگ‌آل»، جوین انبوه (`joinall`) → «جوینر»، اسپم پیام (`/flood`) → «پیام انبوه» با سقف امن، و دستورات چتی با پیشوند.

### ۲. `sarzaminfile.ir/product/advanced-telegram-self-source` 🟢 — کاتالوگ امکانات

- صفحه کامل (۵ چانک) اسکرپ شد. محصول **پولی** (۸ میلیون تومان!) و بنا بر نظرات فروشگاه، دیگر فعال نیست — فایل سورس قابل دریافت نیست؛ بنابراین **کاتالوگ کامل امکانات** (بیش از ۱۵۰ آیتم در ۶ بخش) استخراج و مبنای طراحی قابلیت‌ها قرار گرفت.
- مفاهیم کلیدی که از آن برداشت شد: «منشی آفلاین» و «منشی هوشمند (پاسخ فقط بار اول)»، حالت پوکر، تایپ نمایشی، خواندن خودکار به تفکیک نوع چت، realm (چت ذخیره‌شده)، بکاپ پیام چت، ترجمه خودکار، استیکر/متن خودکار در گروه، اکو، امضا، خروج خودکار، پاک‌سازی پیام‌های یک کاربر، فیلتر/الزام کلمه در گروه، تگ‌آل (اعضا/ادمین/ممبر/ربات)، پاکسازی اکانت‌های دیلیت‌شده و ربات‌های گروه، اخبار سلف/انقضا، ذخیره موزیک/ویدیو در حافظه، ماشین‌حساب، دریافت اطلاعات کاربر/گروه، لیست تایپینگ و…
- از این لیست، قابلیت‌های زیر عیناً یا مشابه در SelfHub پیاده شد: منشی ۴حالته، خواندن تفکیکی، تگ‌آل، پاک‌سازی با فیلتر نوع رسانه، فیلتر کلمات گروهی، خوش‌آمد، ذخیره رسانه، زمان‌بند، پروفایل زمان‌دار، و مدیریت گروه (اخراج/بن/خروج).
- دو محصول دیگر همان فروشگاه هم بررسی شد: `telegram-advanced-self-source` و `self-source-telegram` (در نظرات به‌عنوان جایگزین معرفی شده‌اند) 🟡 و `zonik-self` 🟡 (سلف پایتونی با تاکید بر ضداسپم و مصرف کم).

### ۳. `datisnetwork.com/self-telegram-robot-source.html` 🟢

- صفحه کامل اسکرپ شد: سورس **PHP با MadelineProto** برای «پاسخگویی خودکار + آنتی شیلد».
- لینک دانلود فایل (`dl.datisnetwork.com/.../Self-Bot-Datisnetwork.rar`) **مرده است** (تست شد با http/https) — فایل در دسترس نیست؛ بنابراین از متن صفحه استفاده شد.
- قابلیت‌های اعلامی: نصب آسان، میدلاین، پاسخگویی سریع خودکار، وضعیت آنلاین/آفلاین ربات، خاموش/روشن کردن، لیست پاسخ‌های سریع + حذف، اطلاعات کاربر با ریپلای، جستجوی پیام در چت، کلید/خاموش «خوانده شدن پیام‌ها»، اسپم پیام رگباری با تعداد دلخواه، چک یوزرنیم آزاد، ذخیره پیام کاربران، اطلاعات گروه، **لیست دشمنان (آنتی‌شیلد)** و پاکسازی پیام‌های دشمن، **مشاهده نشست‌های فعال**، حالت اکو.
- برداشت به SelfHub: پاسخ سریع، کلید خوانده‌شدن (→ حالت شبح + خودخوان)، اکو (→ در دستورات چتی)، **مدیریت نشست‌ها** (پیاده‌سازی واقعی با `account.getAuthorizations/resetAuthorization`)، و مفهوم «دشمن» ساده‌سازی شد به «لیست نادیده‌گرفتن منشی».

---

## بخش ۲ — ۵۰+ منبع دیگر مطالعه‌شده

### کتابخانه‌ها و فریمورک‌های MTProto (زیرساخت انتخابی)

| # | منبع | وضعیت | برداشت در SelfHub |
|---|---|---|---|
| 4 | [mtcute/mtcute](https://github.com/mtcute/mtcute) | 🟢 | **ستون فقرات پروژه**: کلاینت MTProto سازگار با Cloudflare Workers، ترنسپورت WebSocket، قابلیت سفارشی‌سازی storage/crypto/platform، پشتیبانی رسمی Workers (issue #54 حل شده)، متدهای highlevel (sendText، forwardMessages، incrementStoriesViews و…) |
| 5 | [Lonami/Telethon](https://github.com/Lonami/Telethon) | 🟢 | الگوی طراحی callback لاگین (`start(phone, code, password)`) که در جریان لاگین پنلی SelfHub بازتولید شد؛ الگوی string session |
| 6 | [pyrogram/pyrogram](https://github.com/pyrogram/pyrogram) | 🟡 | سبک API روان متدها، مفهوم `iter_chat_members` |
| 7 | [KurimuzonAkuma/pyrogram](https://github.com/KurimuzonAkuma/pyrogram) | 🟡 | فورک محبوب نزد پروژه‌های فارسی — بررسی شد برای درک اکوسیستم سلف‌های ایرانی |
| 8 | [danog/MadelineProto](https://github.com/danog/MadelineProto) | 🟡 | الگوی «همه‌چیز در یک پروتکل»؛ سورس داتیس با این بود |
| 9 | [tdlib/td](https://github.com/tdlib/td) | 🟡 | مرور برای مقایسه سبکی (اجرای TDLib روی Workers عملاً نشدنی است) |
| 10 | [gram-js/gramjs](https://github.com/gram-js/gramjs) | 🟡 | گزینه جایگزین mtcute؛ به‌خاطر وابستگی سنگین به Node رد شد |
| 11 | [aiogram/aiogram](https://github.com/aiogram/aiogram) | 🟡 | الگوی روتر/دیسپچر |
| 12 | [python-telegram-bot](https://github.com/python-telegram-bot/python-telegram-bot) | 🟡 | (مرجع آموزشی فارسی dolatshah.com هم همین را معرفی می‌کرد) |
| 13 | [grammyjs/grammY](https://github.com/grammyjs/grammY) | 🟡 | الگوی اجرای ربات روی Workers (Bot API) — برای حالت ربات اختیاری |
| 14 | [everyday-coder/opentele](https://github.com/everyday-coder/opentele) | 🟡 | تبدیل نشست‌ها — صرفاً مطالعه؛ SelfHub نشست را خودش تولید و ذخیره می‌کند |

### یوزربات‌های معروف (منبع الهام قابلیت‌ها)

| # | منبع | وضعیت | برداشت |
|---|---|---|---|
| 15 | [TeamUltroid/Ultroid](https://github.com/TeamUltroid/Ultroid) | 🟡 | معماری پلاگین‌محور، آمار، نصب یک‌کلیک هروکو، هشدارهای امنیتی پلاگین‌ها |
| 16 | [TgCatUB/catuserbot](https://github.com/TgCatUB/catuserbot) | 🟡 | کاتالوگ دستورات گسترده + سیستم راهنما |
| 17 | [hikariatama/hikka](https://github.com/hikariatama/hikka) | 🟡 | فرم‌های اینلاین، لاگ اینلاین، `NoNick` (سلف روی اکانت دوم)، ماژول‌های قابل نصب |
| 18 | [Friendly-Telegram (FTG)](https://github.com/Friendly-Telegram/Friendly-Telegram) | 🟡 | اولین پنل وب (Flutter) برای یوزربات — تایید رویکرد «پنل به‌جای هلپر» |
| 19 | [itay4ra/UserLixo](https://github.com/itay4ra/UserLixo) | 🟡 | چندقابلیتی بودن با منابع کم |
| 20 | [AsenaUserBot/AsenaUserBot](https://github.com/AsenaUserBot/AsenaUserBot) | 🟡 | سیستم زبان چندگانه و پلاگین دائمی |
| 21 | [SedenBot/SedenUserbot](https://github.com/SedenBot/SedenUserbot) | 🟡 | دستورات با Pyrogram |
| 22 | [Dragon-Userbot/Dragon-Userbot](https://github.com/Dragon-Userbot/Dragon-Userbot) | 🟡 | «ساده‌ترین نصب» — الهام ویزارد نصب SelfHub |
| 23 | [athphane/userbot](https://github.com/athphane/userbot) | 🟡 | ساختار پوشه‌های تمیز پلاگین + مونگو (در SelfHub به DO storage تبدیل شد) |
| 24 | [Sequoia/TelePyroBot](https://github.com/Sequoia/TelePyroBot) | 🟡 | الگوی کلاس‌بندی هندلرها |
| 25 | [SpEcHiDe/... tg-userbot](https://github.com/SpEcHiDe) | 🟡 | (فهرست awesomeopensource) |
| 26 | [alan-alexander/tg-focus](https://github.com/alan-alexander/tg-focus) | 🟡 | ایده «ردیاب کلیدواژه» (watcher) |
| 27 | [MarshalX/tgvc-userbot](https://github.com/MarshalX/tgvc-userbot) | 🟡 | یوزربات ویس‌چت — خارج از دامنه SelfHub، مطالعه ساختار |
| 28 | [anonymousx97/LionX-Userbot](https://github.com/anonymousx97/LionX-Userbot) | 🟡 | AFK و ابزارهای روزمره |
| 29 | [.../Wikibot userbot] (فهرست awesomeopensource) | 🟡 | دستورات دانشنامه‌ای |
| 30 | [ItachiUchiha-ops/ItachiUserbot] (فهرست awesomeopensource) | 🟡 | — |
| 31 | [punchnox/Caligo](https://github.com/punchnox) | 🟡 | سلف‌بات مینیمال |
| 32 | [technoayanbo/... TechnoAyanBot] (فهرست awesomeopensource) | 🟡 | «۲۰۰+ پلاگین» — کاتالوگ قابلیت |
| 33 | [RaphielGang/Paperplane-Remix (paperplane userbot)](https://github.com/RaphielGang) | 🟡 | یکی از قدیمی‌ترین‌ها؛ ساختار ماژول گروهی |
| 34 | [vyfor (telegram-scraper نویسنده‌ها)](https://github.com/vyfor) | 🟡 | اسکرپرهای پرسرعت — الگوی خروجی |
| 35 | [hadi2794/selfbot](https://github.com/hadi2794/selfbot) | 🟢 | **سلف‌بات فارسی مدرن** (Telethon + PostgreSQL + داکر، «۱۰۰+ دستور در ۲۹ دسته»، deploy روی Railway/Replit، generate_session.py) — نزدیک‌ترین پروژه به SelfHub؛ تایید نیاز به پنل و جریان ساخت نشست |
| 36 | [aahnik/tgcf](https://github.com/aahnik/tgcf) | 🟢 | **فوروارد هوشمند**: حالت past/live، فیلتر لیست سیاه/سفید، فرمت/جانشینی regex، کپشن، ورودی وب — مستقیم در قابلیت «فوروارد هوشمند» SelfHub پیاده شد (from→to + فیلتر + کپی/فوروارد) |
| 37 | [awesomeopensource — Top 50 Python Telegram Userbot](https://awesomeopensource.com/projects/python/telegram-userbot) | 🟡 | فهرست ۵۰ پروژه برای پیمایش اکوسیستم |
| 38 | [awesomeopensource — Top 23 Telegram Userbot](https://awesomeopensource.com/projects/telegram-userbot) | 🟡 | فهرست تکمیلی |

### ابزارهای اسکرپ/افزودن/انبوه

| # | منبع | وضعیت | برداشت |
|---|---|---|---|
| 39 | [th3unkn0n/TeleGram-Scraper](https://github.com/th3unkn0n/TeleGram-Scraper) | 🟢 | الگوی مرجع «اسکرپ اعضا → CSV → ارسال انبوه» که در ابزارهای SelfHub عیناً به‌صورت یکپارچه (اسکرپر → دکمه «به پیام انبوه بفرست») بازتولید شد |
| 40 | [jharanasolanki/Telegram-Scraper (fork)](https://github.com/jharanasolanki/Telegram-Scraper) | 🟡 | `add2group.py` و `smsbot.py` — سناریوی کامل انبوه |
| 41 | [ha7283/TeleGram-Scraper-1 (fork network)](https://github.com/ha7283/TeleGram-Scraper-1) | 🟡 | اسکرپ بدون محدودیت (با اکانت‌های چندگانه) — ایده مولتی‌اکانت |
| 42 | [Telegram-adder (فهرست awesomeopensource)](https://awesomeopensource.com/projects/telegram-userbot) | 🟡 | افزودن عضو — **عمداً در SelfHub پیاده نشد** (پرمخاطب‌افزایی بن قطعی دارد و ضد قوانین) |

### سلف‌سازها و سلف‌های ایرانی دیگر

| # | منبع | وضعیت | برداشت |
|---|---|---|---|
| 43 | [sarzaminfile — telegram-advanced-self-source](https://sarzaminfile.ir/product/telegram-advanced-self-source/) | 🟡 | سلف آماده (جایگزین محصول اصلی طبق نظرات) |
| 44 | [sarzaminfile — self-source-telegram](https://sarzaminfile.ir/product/self-source-telegram/) | 🟡 | همان الگوی فروشی |
| 45 | [sarzaminfile — zonik-self](https://sarzaminfile.ir/product/zonik-self/) | 🟡 | سلف پایتونی با ضداسپم و منابع کم |
| 46 | [dolatshah.com — آموزش ربات پایتون](https://dolatshah.com/telegram-bot-source-with-python/) | 🟡 | سطح ورودی اطلاعات فارسی‌زبانان |

### زیرساخت Cloudflare (پشتیبانی اجرای SelfHub)

| # | منبع | برداشت |
|---|---|---|
| 47 | [Cloudflare Workers — TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) | بررسی جایگزین TCP؛ WebSocket ترجیح داده شد |
| 48 | [Cloudflare Workers — WebSocket API (کلاینت خروجی)](https://developers.cloudflare.com/workers/examples/websockets/) | تأیید پشتیبانی `new WebSocket(url)` برای اتصال به تلگرام + محدودیت dev لوکال |
| 49 | [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/) | معماری DO به‌ازای-هر-اکانت + alarm به‌عنوان زمان‌بند |
| 50 | [Deploy to Cloudflare button](https://developers.cloudflare.com/workers/platform/deploy-buttons/) | لینک دپلوی یک‌کلیکی |
| 51 | [MTProto رسمی تلگرام](https://core.telegram.org/mtproto) + کلاینت‌های وب (WebA/WebK) | اندپوینت‌های `wss://<dc>.web.telegram.org/apiws` و لایه امنیتی |
| 52 | [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) | برآورد هزینه اجرای ۲۴/۷ (DO duration) |

---

## بخش ۳ — جمع‌بندی: چه چیزهایی از کجا به SelfHub رسید

| قابلیت SelfHub | ریشه |
|---|---|
| پنل وب + رمز ادمین (حذف ربات هلپر) | نیاز اعلامی کاربر + الگوی FTG/tgcf (پنل وب به جای ربات) |
| منشی ۴حالته | sarzaminfile (منشی آفلاین/هوشمند) + داتیس (پاسخ خودکار) |
| زمان در نام/بیو، چرخش بیو | MhdiTaheri/TelegramSelf (timename/bio) |
| خودخوان تفکیکی | TelegramSelf (ReadAll*) + sarzaminfile |
| فوروارد هوشمند | tgcf (قوانین from→to + فیلتر + کپی) |
| اسکرپر + پیام انبوه یکپارچه | th3unkn0n/TeleGram-Scraper (scraper→csv→bulk) |
| تگ‌آل / پاک‌سازی / مدیریت گروه | TelegramSelf (/tag، /rem) + sarzaminfile (بخش گروه) |
| دستورات چتی | تمام یوزربات‌ها (Ultroid/Hikka/…) — با پیشوند قابل تغییر |
| مدیریت نشست‌ها + هشدار ورود | داتیس (مشاهده نشست‌ها) + تجربه امنیتی |
| ضداسپم/فیلتر کلمات | sarzaminfile (فیلتر/الزام کلمه) |
| چند-اکانتی + حالت ربات | نیاز کاربر (کنترل «سلف‌ها») + مولتی‌اکانت اسکرپرها |
| اجرای بدون سرور روی Cloudflare | الزام کاربر (لینک دپلوی کلادفلر) + mtcute (پشتیبانی رسمی Workers) |
| مکث تصادفی/سقف روزانه در انبوه | بهترین‌ практики ضد بن در ابزارهای انبوه |
| بکاپ رمزنگاری‌شده | تجربه سلف‌سازها (شارژ/تمدید) به‌صورت ساده‌شده و شخصی |

</div>
