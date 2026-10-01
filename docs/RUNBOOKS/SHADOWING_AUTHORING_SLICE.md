# V2 — إنشاء أول درس Shadowing ثم نشره

## لماذا هذه الشريحة

طلب خالد تقديم المسار القابل للاستخدام: Admin ينشئ درسًا بجمل مسموعة، ينشره لمجموعة، وStudent المسند لها يدرسه ويحفظ تقدمه. تظل Vocabulary وListen & Type وQuiz وConversation والعمل الإداري الأوسع لمراحل لاحقة. هذا **تغيير ترتيب التنفيذ** بطلب صاحب المشروع، وليس إضافة قاعدة إلى `APPROVED_RULES.md`.

## ما أُضيف في المصدر

- `/admin/lesson-builder`: عنوان ووصف وجملة إلى 20 جملة؛ WAV مستقل لكل جملة (حتى 2 MB). «احفظ الدرس» ينشئ LessonDefinition وLessonVersion وLessonSegments الموجودة في نموذج V2، دون إسناده لطالب أو إنشاء منشور خفي.
- `/admin/lessons`: قائمة صفحات للدروس المحفوظة ورابط منشئ الدرس.
- Admin API: `GET /api/admin/shadowing/lessons` و`GET .../groups`، `POST .../lessons` بـmultipart، و`POST .../publish` صريح. كتابة Admin تتطلب الدور وCSRF وحد معدل؛ إنشاء الدرس ونشره يستخدمان `requestId` لإعادة الطلب دون مضاعفة النتيجة. التشخيص يكتب المعرفات والعدد والحجم والمدة والنتيجة، لا النصوص ولا الصوت ولا كلمات السر.
- النشر يبني PublishedCurriculumVersion وPublishedLessonSlot جديدين ويحدّث مؤشر GroupCurriculumAssignment بعد مقارنة النسخة المتوقعة. يبقي النسخ القديمة كما هي. يمكن إضافة درس آخر لمجموعة **لم يبدأ أي طالب تقدمًا في نسختها الحالية**؛ يعاد بناء snapshot جديد مع الجداول القديمة. إن بدأ تقدم، يرجع `409 active_progress_prevents_republish` لأن تحويل تقدم الطالب إلى نسخة جديدة يحتاج قرارًا وتنفيذًا مستقلين؛ لا تصفير صامت.
- Development يستعمل `backend/ShadowingEnglish.Api/.local/media` افتراضيًا أوالمسار المطلق `Media:LocalRoot`، مع دعم `DevelopmentMedia` للـfixture. Production يستعمل Azure Blob Storage الخاصة عند ضبطها، دون fallback إلى قرص الاستضافة؛ الوضع غير المضبوط يرجع `503`. الصوت النهائي فقط ينتقل للاستضافة. تفاصيل الإعداد والخصوصية والـRange في [دليل التخزين](AZURE_SHADOWING_MEDIA_AR.md).
- لا تعديل Schema ولا Migration جديدة؛ البيانات التجارية تُكتب فقط عند ضغط حفظ أو نشر. لا تعديل أو حذف للدرس بعد الحفظ في هذه الشريحة؛ أي نسخة منشورة لا تتغير بأثر رجعي.

## ما تحقق هنا

**تحديث 30 سبتمبر:** Angular 54/54 وPython 18/18 وNode 21/21 وPlaywright 8/8 وAPI/media 16/16 PASS، وبناء Angular و.NET Release نجحا. اختبار الـAPI الجديد يستخدم Identity وCSRF الفعلية مع SQLite وAzurite مؤقتين، ويغطي Save → Publish → Student audio/progress وGET بلا كتابة، وإعادة الطلب وفشل التخزين وفقدان الرد بعد commit. [التقرير الحالي](MEDIA_STORAGE_TEST_REPORT_2026-09-30.md) يوضح حدود SQL Server وWindows وAzure المنشورة. الفقرات المؤرخة أدناه نتائج تاريخية، ولا تصف حالة التخزين الحالية.

**تحديث 29 سبتمبر — الأداة المحلية:** أضيف [مسار تجهيز الصوت المحلي](LOCAL_LESSON_PROCESSOR_AR.md). شُغّل .NET SDK معزول، وكشف وأصلح خطأ `CS4007` في مقارنة hash أثناء إعادة طلب الحفظ؛ الحل الآن يبني بصفر أخطاء/تحذيرات. Angular 53/53 وPython 18/18 وstatic 21/21 وPlaywright الخاص بالأداة 8/8 PASS، لكن API في Playwright mock وSQL الحقيقي غير مشغلة. التفاصيل والحدود في [تقرير الإضافة](LOCAL_PROCESSOR_TEST_REPORT_2026-09-29.md). الفقرات التالية تسجل حالة التسليم السابق.

- Angular production build PASS؛ initial bundle `330.58 kB raw / 90.50 kB estimated transfer`، ومنشئ الدرس lazy chunk `23.50 kB raw / 5.50 kB estimated`. هذه تقديرات بناء، وليست قياس سرعة متصفح.
- Angular unit **45/45**، lint وformat PASS. اختبار الواجهة يغطي أن فتح الصفحة لا يكتب، وأن الحفظ multipart مستقل عن النشر، وأن طلب النشر يرسل المجموعة والنسخة المتوقعة.
- لم يُبنَ Backend ولم يُشغّل `.NET` أوSQL أوAPI أوE2E هنا: SDK/SQL والحسابات التجريبية على جهاز خالد. **حالة الشريحة SOURCE ADDED / BACKEND BUILD PENDING**، ولا تغيّر نتيجة تقرير Day 2 القديم.

## فحص جهاز Windows على قاعدة V2 التجريبية فقط

1. استخدم `ShadowingEnglishV2_Day2Test_20260929` أو قاعدة اختبار V2 واضحة. اضبط `ConnectionStrings__DefaultConnection` للـAPI على **هذه القاعدة فقط**؛ لا تطبّق migrations على القاعدة المعتادة أوV1. أوقف العملية التي تقفل DLL أوابنِ بمخرجات معزولة.
2. شغّل `dotnet build .\backend\ShadowingEnglish.sln` و`dotnet ef migrations has-pending-model-changes --project .\backend\ShadowingEnglish.Infrastructure --startup-project .\backend\ShadowingEnglish.Api`. المتوقع لا تغيّر نموذج EF، لكن لا تسجّل PASS قبل تشغيلهما.
3. شغّل API Development على `127.0.0.1:5018` بالاتصال التجريبي. من `frontend` شغّل `npm run start -- --host 127.0.0.1 --port 4201 --proxy-config src/proxy.day2-test.conf.json`، ثم سجّل دخول Admin. إذا استُخدم `Media:LocalRoot` فتأكد أنه مسار مطلق إلى مجلد اختبار V2، وأن له صلاحية الكتابة والقراءة؛ لا ترفع الصوت إلى `bin/obj`.
4. من «المجموعات» أنشئ مجموعة اختبار، وأسند إليها Student اختبارًا. من «منشئ الدرس» أدخل عنوانًا وجملتين، وارفع ملف WAV حقيقيًا لكل جملة، ثم **احفظ**. تحقق أنه في المكتبة ولا يظهر للطالب قبل النشر. اختَر المجموعة وموضع الأسبوع/اليوم/الترتيب واضغط **نشر**. سجّل دخول Student وتحقق من Dashboard → Curriculum → Overview → Shadowing: الجمل، الصوت، Next، حفظ التقدم، والتحديث. افحص `Range=206` للصوت وعدم وجود رفع لملف تسجيل الطالب.
5. كرر طلب الحفظ والنشر **بنفس** `requestId` عبر اختبار API للتأكد من نتيجة بلا تكرار؛ غيّر محتوى نفس طلب الحفظ وتوقع `409`. اختبر anonymous `401` وStudent `403` وPOST بلا CSRF `400` وملف WAV غير صالح `400`، ونشرًا بنسخة متوقعة قديمة `409`. بعد حفظ تقدم الطالب، محاولة إعادة نشر نفس المجموعة يجب أن ترجع `409` دون تغيير المؤشر أوالتقدم. قارن صفوف DB قبل/بعد GET للتأكد من عدم الكتابة.
6. سجّل عدد الطلبات والبايتات، وزمن API والصوت، وتجربة الهاتف والميكروفون الحقيقي. هذه القياسات غير متاحة من build وحده. لا تعلن DONE حتى تنجح الشريحة من Admin إلى Student على قاعدة الاختبار، ثم تُراجع حدود الإنتاج وCI.

**مهم:** fixture يوم 2 مرتبطة بنسخة منشورة محددة، وقد تعتبرها غير متسقة إن غيرت منشور مجموعتها ثم أعدت تشغيلها. اختبر الإنشاء في مجموعة منفصلة ولا تعِد تشغيل fixture على المجموعة التي نشرت إليها يدويًا.
