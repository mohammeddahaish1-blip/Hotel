# البنية التحتية لنُزُل — دليل التشغيل

هذا المجلد فيه كل ما تحتاجه لتشغيل النظام تجارياً، وأخذ نسخ احتياطية، ونقله لأي مكان.
الخطة الكاملة والمقارنات في Notion: «6. البنية التحتية للمرحلة التجارية».

## مكونات النظام

| الجزء | أين يعمل الآن | ما يحتويه |
| --- | --- | --- |
| التطبيق (Next.js) | Vercel | الواجهة والعمليات (Server Actions) |
| قاعدة البيانات + الدخول + الملفات | Supabase (`isijnklsskwbdbmmertk`، منطقة طوكيو) | كل البيانات، حسابات الموظفين، صور الهويات والإيصالات |
| مهام ليلية | داخل قاعدة البيانات (pg_cron) | ترحيل الإيجارات 01:05، حذف صور الهويات المنتهية 01:15 بتوقيت مسقط |
| دالة Edge | Supabase | `purge-guest-documents` (حذف صور الهويات) |
| الكود | GitHub | المصدر الوحيد للحقيقة: الكود + `supabase/migrations` |

التطبيق لا يحتاج إلا متغيرين: `NEXT_PUBLIC_SUPABASE_URL` و`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

## الملفات

| الملف | وظيفته |
| --- | --- |
| `Dockerfile` (في جذر المشروع) | يبني التطبيق كحاوية لأي سيرفر |
| `infra/docker-compose.yml` + `Caddyfile` | تشغيل التطبيق على سيرفرك مع شهادة HTTPS تلقائية |
| `infra/.env.example` | المتغيرات المطلوبة على السيرفر |
| `infra/scripts/db-export.sh` | تصدير كل البيانات (مع تشفير اختياري) |
| `infra/scripts/db-import.sh` | تحميل التصدير في قاعدة جديدة فارغة والتحقق من الأعداد |
| `infra/scripts/storage-copy.mjs` | نسخ كل الملفات (الهويات، الإيصالات، الصور) بين مشروعين |
| `infra/sql/reschedule-jobs.sql` | إعادة ضبط المهام الليلية على العنوان الجديد بعد النقل |
| `infra/scripts/test-sql.sh` | تشغيل كل اختبارات قاعدة البيانات |
| `infra/migrations-skip.txt` | ملفات migration لم تُطبَّق في الإنتاج بعد (حالياً: الرواتب 0022) |
| `.github/workflows/ci.yml` | فحص تلقائي مع كل رفع: الأنواع، ESLint، البناء، اختبارات SQL |
| `.github/workflows/backup.yml` | نسخة احتياطية ليلية مشفّرة تُحفظ 30 يوماً |
| `src/app/api/health` | رابط فحص الحالة `/api/health` لأدوات المراقبة |

## الأدوات المطلوبة على جهازك (للنقل والنسخ فقط)

- عميل PostgreSQL إصدار **17** (`pg_dump`، `psql`) لأن Supabase يعمل على 17.
- Node.js 24 و`npm ci` داخل المشروع (لسكربت نسخ الملفات).
- `gpg` إذا أردت تشفير النسخ.
- Supabase CLI لنشر دالة Edge: `npx supabase@latest ...`.

رابط الاتصال بقاعدة البيانات من Supabase > Connect. استخدم **Session pooler** إذا كان جهازك أو الخدمة لا تدعم IPv6 (مثل GitHub Actions).

## 1) النسخ الاحتياطي

### يدوياً
```bash
SOURCE_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
BACKUP_PASSPHRASE="<كلمة سر طويلة>" \
infra/scripts/db-export.sh backups/2026-10-27
```
الناتج: `app.sql.gpg` (بيانات الفنادق)، `auth.sql.gpg` (حسابات الدخول)، `counts.txt` (عدد الصفوف لكل جدول).

### تلقائياً كل ليلة (GitHub)
1. GitHub > Settings > Secrets and variables > Actions > New repository secret:
   - `SUPABASE_DB_URL` = رابط Session pooler.
   - `BACKUP_PASSPHRASE` = كلمة سر طويلة. **احفظها في مدير كلمات مرور**، بدونها لا يمكن فتح النسخ.
2. تعمل الساعة 02:37 بتوقيت مسقط على الفرع الافتراضي، ويمكن تشغيلها يدوياً من تبويب Actions.
3. النسخ تُحفظ 30 يوماً في Actions > Nightly backup > Artifacts.

### اختبار الاسترجاع (مرة كل شهر)
نسخة لم تُختبر = لا توجد نسخة. أنشئ مشروع Supabase تجريبي فارغ واسترجع فيه (الخطوة 2 أدناه)، وتأكد أن السكربت يطبع «All row counts match».

## 2) نقل البيانات إلى مكان آخر

يصلح لكل الحالات: مشروع Supabase جديد في منطقة أقرب، أو Supabase على سيرفرك (self-hosted).

**قبل البدء:** أعلن للفنادق نافذة صيانة ليلية (30–60 دقيقة). أثناءها لا تُدخل بيانات.

```bash
# 1. تصدير من القديم
SOURCE_DB_URL="<old>" BACKUP_PASSPHRASE="..." infra/scripts/db-export.sh backups/move

# 2. تحميل في الجديد (يجب أن يكون فارغاً؛ ينشئ الجداول من migrations ثم يحمّل البيانات ويقارن الأعداد)
TARGET_DB_URL="<new>" BACKUP_PASSPHRASE="..." infra/scripts/db-import.sh backups/move

# 3. نسخ الملفات (مفاتيح service_role من الإعدادات > API؛ لا تحفظها في أي ملف)
SOURCE_URL=https://<old>.supabase.co SOURCE_SERVICE_KEY=... \
TARGET_URL=https://<new> TARGET_SERVICE_KEY=... node infra/scripts/storage-copy.mjs

# 4. المهام الليلية على العنوان الجديد
psql "<new>" -v project_url=https://<new> -v anon_key=<anon JWT> -f infra/sql/reschedule-jobs.sql

# 5. دالة حذف الهويات
npx supabase@latest functions deploy purge-guest-documents --project-ref <new-ref>
```

6. **إعدادات الدخول في المشروع الجديد** (Authentication):
   - Site URL ورابط إعادة التوجيه: `https://<نطاقك>/auth/callback`.
   - SMTP خاص (Resend أو Amazon SES أو Zoho) وقوالب الرسائل العربية.
   - كلمات المرور تنتقل كما هي، لكن **كل الموظفين يسجلون الدخول من جديد** مرة واحدة.
7. **غيّر المتغيرين** في Vercel (أو `infra/.env`) ثم أعد النشر.
8. **فحص سريع:** دخول المالك، فتح حجز فيه دفعة، فتح صورة هوية، إضافة مصروف بإيصال، `/api/health` يرجع 200.
9. أبقِ المشروع القديم متوقفاً عن الاستخدام أسبوعين كاحتياط، ثم احذفه.

> `db-import.sh` يرفض العمل إذا وجد في القاعدة الجديدة أي فندق أو مستخدم، فلا يمكن أن يمسح بيانات بالخطأ.
> إذا طبّقت migration 0022 (الرواتب) في الإنتاج، احذف سطرها من `infra/migrations-skip.txt`.

## 3) تشغيل التطبيق على سيرفرك (بدل Vercel)

على سيرفر Linux فيه Docker (مثلاً VPS بـ 2 معالج و4GB):
```bash
git clone <repo> nuzul && cd nuzul
cp infra/.env.example infra/.env && nano infra/.env        # DOMAIN + مفاتيح Supabase
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
```
- وجّه سجل DNS من نوع A للنطاق إلى عنوان السيرفر قبل التشغيل، فيصدر Caddy شهادة HTTPS تلقائياً.
- التحديث: `git pull && docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build`.
- الحالة: `docker compose -f infra/docker-compose.yml ps` (يجب أن يظهر التطبيق `healthy`).

## 4) Supabase على سيرفرك (self-hosted) — للمرحلة المتقدمة

يُستخدم الدليل الرسمي: https://supabase.com/docs/guides/self-hosting/docker
- الحد الأدنى الرسمي 4GB رام و2 معالج و50GB، والموصى به 8GB و4 معالجات و80GB.
- غيّر **كل** كلمات السر والمفاتيح الافتراضية في `.env` قبل التشغيل، وضعه خلف HTTPS.
- أنت المسؤول عن التحديثات الأمنية والنسخ والمراقبة. لا تنتقل له قبل وجود شخص تقني يتابعه.
- بعد تشغيله، انقل البيانات بالخطوة 2 كما هي.

## 5) المراقبة

- راقب `https://<نطاقك>/api/health` كل دقيقة (UptimeRobot أو Better Stack، مجاناً): 200 = سليم، 503 = Supabase لا يرد.
- أخطاء التطبيق: Vercel > Logs، أو `docker compose logs app` على السيرفر.
- تنبيهات الأمان والأداء: Supabase > Advisors مرة كل أسبوع.
