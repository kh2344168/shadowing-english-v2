# Day 2 — Student core flow (2026-09-28)

## نطاق التنفيذ

- V2 فقط. V1 مرجع بصري للواجهة ولا تُنقل بياناته أوBackend أوAuth منه.
- المسار: Login → Dashboard → Curriculum → Lesson Overview → Shadowing → Save Basic Progress → Refresh.
- Data model: LessonDefinition/Version/Segment، CurriculumTemplate، نسخة منشورة مستقلة لمجموعة، مؤشر النسخة الحالية للمجموعة، slot مجدول، وتقدم الطالب بمفتاح `(studentId, publishedCurriculumVersionId, slotId, stageKey)`.
- `GET /api/student/learning/curriculum?page=1&pageSize=20`: بيانات طالب واحد من عضويته الفعالة ونسخة مجموعته الحالية المتاحة، 50 عنصرًا بحد أقصى و`hasMore`. بدون مجموعة/نسخة → `200` مع حالة فارغة. بطاقات بلا صوت.
- `GET /api/student/learning/slots/{slotId}`: بيانات نسخة الدرس وحالة تقدم Shadowing للـslot المتاح؛ لا يُنزّل المقاطع.
- `GET /api/student/learning/slots/{slotId}/segments/{position}`: نص مقطع واحد ورابط صوته فقط. `GET .../audio`: تحقق الدور والعضوية عند كل طلب، Range/ETag بعد المصادقة، `Cache-Control: private, no-cache`.
- `PUT /api/student/learning/slots/{slotId}/progress` مع `{ "completedSegments": 1 }`: جلسة Student، وCSRF، وعضوية ومجموعة وموعد إتاحة؛ خطوة واحدة متقدمة فقط، معاملة Serializable وقيد فريد؛ إعادة نفس الطلب لا تزيد العدد. `409` عند تخطي جملة، و`404` عند slot غير مصرح/مجدول/نسخة غير مخصصة.
- تسجيل الطالب عبر MediaRecorder محلي في الصفحة فقط؛ لا تخزين سحابي ولا رفع ملف، وتوقف الميكروفون عند مغادرة الصفحة. زر «التالي» يدوي؛ لا انتظار مفروض لإكمال صوت المعلم.
- واجهات الطالب تسجل بداية/نتيجة/مدة العمليات ومعرّف slot أوصفحة وHTTP status آمن دون نص الجملة أوالبريد أوالصوت. إذا حُفظ التقدم ثم فشل تحميل الجملة التالية، توضّح الواجهة أن الحفظ نجح وتسمح بتحديث الدرس؛ لا تنقل تسجيلًا قديمًا إلى جملة جديدة إذا تأخر حدث إيقاف MediaRecorder. أخطاء تعارض SQL المعروفة عند حفظ التقدم ترجع `409 progress_changed` بدل `500` في المصدر؛ يلزم التحقق الحي.
- Development fixture صريحة تعمل فقط باستخدام `--provision-day2-fixture`، وتربط حسابي Admin/Student موجودين. تنشئ درسًا تجريبيًا بجملتين منطوقتين، مع ثلاث حالات خفية لاختبار العزل: موعد مستقبلي، مجموعة أخرى، ونسخة منشورة غير مخصصة. لا بيانات وهمية في الواجهة أوإنشاء عند بدء الخادم/GET/login. الملفات الصوتية التجريبية تُنسخ لمخرجات Development فقط ولا تدخل publish؛ `Media:LocalRoot` مطلوب للصوت خارج Development، والتخزين السحابي ضمن Day 4.
- ترحيل `20260928154813_AddGroupsFoundation` السابق ثم `20260928213000_AddStudentCore`. اتجاه Up يضيف جداول وقيودًا وفهارس فقط؛ لا يحذف بيانات. اتجاه Down يحذف جداول Day 2 ويجب ألا يستخدم على قاعدة حقيقية.

## بوابة اختبار SQL/.NET على جهازك — قاعدة اختبار V2 فقط

1. ابدأ من نسخة V2 هذه، وهي التي تحوي `20260928213000_AddStudentCore`. اضبط `ConnectionStrings__DefaultConnection` لقاعدة اختبار **V2**. لا تستخدم قاعدة V1. تحتاج .NET SDK 10 وأداة `dotnet ef` المتوافقة مع EF 10 إذا لم تكن مثبّتة.
2. قبل أي تحديث لقاعدة البيانات:

```powershell
npm ci
npm run build:frontend
npm run test:frontend
npm run lint
npm run format:check
node --test tests/day2-shell-contract.test.cjs tests/day2-v1-layout-parity.test.cjs tests/security/admin-accounts.static.test.mjs tests/groups-foundation.static.test.mjs tests/student-core.static.test.mjs
dotnet build .\backend\ShadowingEnglish.sln
dotnet ef migrations list --project .\backend\ShadowingEnglish.Infrastructure --startup-project .\backend\ShadowingEnglish.Api
dotnet ef migrations has-pending-model-changes --project .\backend\ShadowingEnglish.Infrastructure --startup-project .\backend\ShadowingEnglish.Api
dotnet ef migrations script --idempotent --project .\backend\ShadowingEnglish.Infrastructure --startup-project .\backend\ShadowingEnglish.Api --output "$env:TEMP\shadowing-v2-day2-review.sql"
```

3. راجع SQL الناتج، وفروق EF snapshot، وتأكد من اتصال V2 قبل التطبيق. الترحيلان كُتبا يدويًا في بيئة لم يتوفر بها SDK؛ إذا كشف EF فرقًا **أصلحه وأعد البناء قبل التنفيذ**. بعدها فقط نفذ `dotnet ef database update --project .\backend\ShadowingEnglish.Infrastructure --startup-project .\backend\ShadowingEnglish.Api` على قاعدة اختبار V2.
4. أنشئ Admin وStudent محليين بالأمر الموجود `--provision-local-accounts` على **قاعدة فارغة فقط**؛ إذا لديهما حسابات بالفعل استخدم الموجودة. شغّل fixture الصريحة: `dotnet run --project .\backend\ShadowingEnglish.Api -- --provision-day2-fixture`. أدخل بريد Admin وبريد Student الموجودين عند المطالبة؛ لا يغير كلمات السر، ويرفض نقل الطالب من مجموعة أخرى. كرر الأمر للتحقق من أنه لا ينشئ نسخة ثانية.
5. شغّل API منفصلًا على `127.0.0.1:5018` متصلًا بقاعدة الاختبار المعزولة فقط، واتركه يعمل. في نافذة ثانية، اضبط `DAY2_BASE_URL=http://127.0.0.1:5018` ومتغيرات `DAY2_ADMIN_EMAIL` و`DAY2_ADMIN_PASSWORD` و`DAY2_STUDENT_EMAIL` و`DAY2_STUDENT_PASSWORD` لحسابات التطوير، ثم شغّل `node tests/day2-api-smoke.mjs`. السكربت يتحقق من 401/403، المجدول والنسخة غير المخصصة ومجموعة أخرى 404، صوت Range=206، CSRF=400، التسلسل=409، تكرار الحفظ، والتقدم بعد تحديث الدرس. اختياريًا اضبط حساب Student ثانٍ بدون عضوية في المجموعة المعنية عبر `DAY2_OTHER_STUDENT_EMAIL` و`DAY2_OTHER_STUDENT_PASSWORD` لاختبار منع وصوله إلى slot الطالب الأول.
6. من مجلد `frontend` شغّل `npm run start -- --host 127.0.0.1 --port 4201 --proxy-config src/proxy.day2-test.conf.json` وافتح `http://127.0.0.1:4201/login`. سجل دخول Student، ثم المسار والمنهج والدرس والجملتين. اختبر الميكروفون محليًا، عدم وجود POST لملف التسجيل في Network، زر التالي، تحديث الصفحة واستعادة التقدم، وأزرار الرجوع وإعادة المحاولة؛ كرر على عرض هاتف. الصوت يبدأ بطلب المقطع المطلوب حين تضغط تشغيله. لأتمتة الرحلة أغلق الواجهة اليدوية على `4201` أولًا ثم، من جذر المشروع وبعد ضبط متغيرَي Student وتشغيل API الاختبار، نفذ `npx playwright test --config frontend/playwright.day2-test.config.ts`؛ الفحص اليدوي للميكروفون وحجم الشبكة يظل مطلوبًا.
7. قبل وبعد GETs فقط، تحقق من ثبات عدد صفوف `StudyGroups` و`StudentGroupMemberships` و`PublishedCurriculumVersions` و`StudentStageProgress` في قاعدة الاختبار. راجع سجلات `/api/student/learning` للنجاح/الرفض/المدة دون بريد أوكلمة سر أوصوت. اختبر Admin 403 وStudent ثاني 404، ثم راقب عدد طلبات الصفحة والحجم؛ بناء Angular المحلي سجّل initial 341.72 kB raw / 93.15 kB estimated transfer، وصوتا التجربة 71,438 و68,398 بايت.

## حالة بوابات الجودة في بيئة إنشاء هذه النسخة

- PASS بتاريخ 29 سبتمبر: Angular build، Angular unit **45/45**، Node/static **21/21**، lint وformat العامان، `git diff --check`، وفحص ترحيل Up بلا DROP. Initial bundle: **330.56 kB raw / 90.55 kB estimated transfer** (ليس قياس الشبكة الفعلي). اختبار E2E الجديد مُدرج لخمس بيئات Playwright، وهذا تحقق من تسجيل الاختبار فقط.
- NOT RUN: `dotnet build` (الأمر `dotnet` غير مثبت هنا)، EF model diff، مراجعة SQL الناتج من EF، التطبيق الفعلي على SQL Server، API integration smoke، E2E في متصفح فعلي وميكروفون وهاتف، staging/CI. لا يجوز تحويل أي منها إلى PASS دون تشغيل فعلي.
- لذلك حالة Day 2 هي **🟡 SOURCE IMPLEMENTED / INTEGRATION BLOCKED** حسب `APPROVED_RULES.md`، وليست DONE حتى نجاح الاختبارات أعلاه وتوثيق نتائجها.

## استكمال فحص جهاز خالد بتاريخ 29 سبتمبر

التقرير المحلي محفوظ في [DAY2_LOCAL_TEST_REPORT_2026-09-29.md](DAY2_LOCAL_TEST_REPORT_2026-09-29.md). على جهاز Windows نجح بناء `.NET` بمخرجات معزولة، وأظهر EF الترحيلات الثلاثة دون فرق في model snapshot. طُبقت الترحيلات على قاعدة جديدة وفارغة `ShadowingEnglishV2_Day2Test_20260929` فقط، وثبت سلوك قيد عضوية واحدة فعالة وترتيب تواريخ العضوية داخل معاملة SQL تراجعت عن التغييرات. API منفصل على `127.0.0.1:5018` رجع `/health=200` وطلبات anonymous المحمية `401`. هذه النتائج من جهاز خالد وليست تشغيلًا جديدًا في بيئة إعداد الحزمة.

حسابا Admin وStudent لم يكتمل إنشاؤهما وقت التقرير؛ لذلك بقيت fixture وAPI المصادق وGroups API وE2E والميكروفون **NOT RUN**. `npm ci` تعطل على ملف native مقفول في Windows، ثم نجحت استعادة الاعتماديات محليًا وتبعتها اختبارات الواجهة؛ clean install لا يزال FAIL في التقرير. لا تُحول أي فحص معلق إلى PASS استنادًا إلى وجود إعداداته فقط.

لإكمال E2E على **نفس** قاعدة الاختبار، تأكد من ضبط `ConnectionStrings__DefaultConnection` للعملية التي تشغّل API والـfixture إلى قاعدة الاختبار الجديدة، واستخدم حسابات Development التجريبية فقط. اختبار API يحتاج `DAY2_BASE_URL=http://127.0.0.1:5018` في بيئة عملية الاختبار. إعداد Playwright المعزول `frontend/playwright.day2-test.config.ts` يشغّل Frontend على `4201` عبر `frontend/src/proxy.day2-test.conf.json` إلى `5018`، ويضبط `baseURL` إلى `4201` أيضًا؛ تشغيل `npm run test:e2e` الافتراضي يستخدم منافذ `4200/5017` ولا يصلح لهذا الاختبار المعزول. من جذر المشروع، بعد ضبط متغيرات الحسابات التجريبية محليًا وتشغيل API، نفّذ:

```powershell
$env:DAY2_BASE_URL = 'http://127.0.0.1:5018'
node tests/day2-api-smoke.mjs
npx playwright test --config frontend/playwright.day2-test.config.ts
```

خمس بيئات المتصفح تستخدم طالب fixture واحدًا وprogress مشتركة، لذا يضبط إعداد Playwright عاملًا واحدًا لتجنب سباق الكتابة. إذا ظهر فشل، احتفظ بأثره واصلح السبب في V2 ثم أعد الفحص. التحقق اليدوي للميكروفون وعدم رفع الملف، وفحص GET دون كتابة، وعمليات Groups المصادق عليها تبقى مطلوبة قبل إغلاق Day 2. لا تسجل كلمات السر أو connection string في التقرير.
