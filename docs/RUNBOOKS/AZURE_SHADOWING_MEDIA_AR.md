# V2 — تشغيل تخزين صوت Shadowing

تحديث 2026-09-30. أُضيف تخزين الملفات النهائية في Azure Blob Storage خلف `IShadowingMediaStore`. المحرك والنموذج والصوت الأصلي يظلون على كمبيوتر الأدمن. لا تنفذ هذه الإضافة معالجة AI على الاستضافة، ولا تنشئ موارد Azure أوحسابات أوحاويات أوتطبق migrations تلقائيًا.

المسار: تجهيز محلي → مراجعة → «احفظ الدرس» يرفع WAV النهائية ويحفظ metadata في SQL → «انشر» مستقل → الطالب المسموح له يقرأ الصوت من API. لا يوجد حفظ أونشر عند فتح الصفحة. النسخة الحالية تحتاج نصًا إنجليزيًا مطابقًا للتسجيل؛ لا تولّد النص أوVocabulary/Quiz.

## اختيار التخزين

| البيئة والإعداد | السلوك |
|---|---|
| Development دون `Media:Provider` | ملفات محلية في `.local/media`، مع دعم ملفات fixture التطويرية الموجودة. |
| Development مع `DevelopmentLocal` | نفس التخزين المحلي؛ `Media:LocalRoot` اختياري ويجب أن يكون مسارًا مطلقًا. |
| أي بيئة مع `AzureBlob` وإعداد صحيح | حاوية خاصة موجودة؛ الملفات تحت `shadowing-v2/`. |
| Production دون إعداد، أوإعداد غير صالح | التخزين معطل؛ الحفظ يرجع `503 media_storage_not_configured` دون إنشاء درس. لا fallback إلى قرص الاستضافة. |
| حاوية عامة، أوخدمة تخزين غير متاحة | العملية ترجع خطأ واضحًا؛ مسودة المنشئ تبقى ويمكن إعادة نفس طلب الحفظ. |

تغيير الإعداد لا ينقل ملفات Development القديمة تلقائيًا. لا تبدّل تخزين بيئة لها دروس موجودة قبل نسخ الملفات والتحقق من مفاتيحها، وبإجراء مستقل. لا توجد أداة migration للوسائط في هذه الشريحة.

## Azure بهوية الاستضافة

في حساب Azure الذي يخصك، جهّز حاوية Blob **خاصة** واضبط Anonymous access إلى Disabled على الحساب. التطبيق لا ينشئ الحاوية ولا يصلح إعداد خصوصيتها عند التشغيل. النشر الفعلي وربط الحساب لم يُنفّذا في هذه البيئة؛ تخزين وتنزيل الملفات النهائية لهما تكلفة استضافة، حتى مع مجانية محرك AI المحلي.

اضبط إعدادات Backend فقط:

```text
Media__Provider=AzureBlob
Media__AzureBlob__ServiceUri=https://<storage-account>.blob.core.windows.net
Media__AzureBlob__Container=<private-container>
```

في Production تُستخدم Managed Identity. فعّل هوية الاستضافة ثم امنحها `Storage Blob Data Contributor` على نطاق الحاوية المطلوبة. في الهوية System-assigned لا يلزم إعداد إضافي؛ إن استخدمت User-assigned فأضف `Media__AzureBlob__ManagedIdentityClientId` بمعرف العميل الخاص بها. تحتاج الهوية قراءة وكتابة وحذف ملفات هذه الحاوية، لأن فشل حفظ درس قد يتطلب تنظيف الملفات الخاصة بالمحاولة.

في Development يستخدم مسار `ServiceUri` بيانات دخول Azure المحلية عبر `DefaultAzureCredential`. لا تُستخدم هذه الآلية كبديل لهوية استضافة Production. التنفيذ الحالي يدعم عناوين Azure العامة `*.blob.core.windows.net` عبر HTTPS، ولا يدعم custom domains أوSAS أوAzure sovereign clouds.

## بديل Connection String

يمكن بدل `ServiceUri` تعيين:

```text
Media__Provider=AzureBlob
Media__AzureBlob__Container=<private-container>
Media__AzureBlob__ConnectionString=<private-server-value>
```

احفظ القيمة في إعدادات الاستضافة الخاصة أوuser-secrets على جهاز التطوير. لا ترسلها في المحادثة، ولا تكتبها في Git أوAngular أوملف ربط الأداة. لا تضبط `ConnectionString` و`ServiceUri` معًا؛ الإعداد المتعارض يُرفض. Connection string الإنتاج يجب أن تنتهي إلى HTTPS على Azure العام دون SAS في URL؛ HTTP loopback مسموح لمحاكي Azurite في Development فقط.

للتطوير بالملفات المحلية لا تحتاج Azure أوAzurite أوهذا الإعداد. كما لا تحتاج أداة الكمبيوتر لأي مفتاح تخزين؛ رفع WAV النهائية يتم عبر جلسة Admin وCSRF إلى API الموقع.

## كيف يحافظ المسار على القواعد

- تُفحص بنية جميع ملفات WAV قبل أول رفع دائم؛ 1–20 مقطعًا وحتى 2 MB للمقطع و40 MB للصوت الكلي. الصوت لا يُخزن داخل SQL.
- اسم الملف يولده Backend ولا يقبل مسارًا أوURL من المستخدم. رفع Azure مشروط بعدم وجود الملف؛ لا overwrite لملف درس محفوظ أومنشور. SHA-256 في metadata، وإعادة الحفظ تقارن محتوى الملفات الحقيقي.
- الحفظ والنشر مستقلان، ولهما معرف طلب ثابت لإعادة المحاولة. لا يضاعف تكرار الطلب الدرس أوالمنشور. تعارض المحتوى يرجع `409`.
- عند فشل الرفع يُنظف فقط ما أنشأته المحاولة نفسها. عند انقطاع الرد بعد commit ناجح، تبقى الملفات التي تشير إليها SQL. إذا تعذر التحقق من نتيجة commit، يؤجل التنظيف بدل المخاطرة بحذف صوت درس محفوظ؛ يظهر `CleanupDeferred` للتشخيص. لا توجد مهمة حذف تجارية خفية.
- يُفحص وجود الصوت قبل فتح معاملة النشر، فلا تُحجز المجموعة أثناء طلبات التخزين الشبكية. نشر مجموعة لها تقدم قائم يظل مرفوضًا حتى تنفيذ نقل تقدم صريح في مرحلة مستقلة.
- صلاحية الطالب والمجموعة ونسخة المنهج تُفحص قبل أي اتصال بالملف. الحاوية خاصة؛ لا يكشف API مفتاح التخزين أوSAS أومسار Blob للطالب.
- الصوت يُقرأ عبر stream قابلة للـseek، بذاكرة قراءة 64 KB ودعم `Range/206` و`ETag/304` و`private, no-cache`. 304 يعيد التحقق من الصلاحية دون تنزيل جسم الصوت من التخزين. الفحص الصغير للجزء قد يقرأ حتى buffer واحدة من Azure؛ هذا ليس تنزيل الدرس كاملًا.
- محاولات SDK محدودة بإعادتين وnetwork timeout؛ لا توجد حلقة retry بلا نهاية. فحص خصوصية الحاوية يعاد كل 30 ثانية. لا يكتب startup أوGET إلى الحاوية أوSQL.
- تشخيص التخزين يسجل العملية والمفتاح المولد والعدد والحجم والمدة ونوع الخطأ، دون النصوص أوالصوت أوcredential أوexception body الخاص بـSDK.

هذه الشريحة لا تضيف CDN أوتنزيل offline أوتسجيلات طالب مرفوعة. القراءة تمر عبر API، ولذلك يجب قياس CPU/طلبات/نقل API والتخزين على الاستضافة قبل قرار جاهزية Production؛ نجاح البناء لا يثبت تحمل 300 طالب.

## إعادة الفحص دون قاعدة المستخدم أوحساب Azure

من جذر V2، بعد توفر .NET 10 وNode المتوافق وPython 3.12:

```powershell
npm install --prefix .local/media-tools --no-audit --no-fund azurite@3.35.0
py -3.12 tests/run_media_checks.py
```

هذا يثبت محاكي اختبار في مجلد معزول؛ لا يغير اعتماديات الموقع. الـrunner يشغّل Azurite مؤقتًا على `127.0.0.1:10027` ويوقفه ويحذف بياناته عند النهاية، ويتجاهل أي اتصال تخزين خارجي موروث. أغلق أي محاكي اختبار يستخدم المنفذ قبل التنفيذ. يستخدم API وIdentity وCSRF الفعلية في TestServer، مع SQLite مؤقتة وAzure SDK الحقيقي. إعداد SQLite للتاريخ داخل مشروع الاختبار فقط؛ لا يغير نموذج الإنتاج أوترحيلاته. بيانات وحسابات الاختبار تُنشأ صراحة في الذاكرة، ولا يحتاج كلمات مرور المستخدم.

بقية الفحوص من جذر V2:

```powershell
npm ci
npm run test:frontend
npm run lint
npm run format:check
node --test tests/day2-shell-contract.test.cjs tests/day2-v1-layout-parity.test.cjs tests/groups-foundation.static.test.mjs tests/student-core.static.test.mjs tests/security/admin-accounts.static.test.mjs
py -3.12 -m unittest discover -s tests -p local_processor_test.py -v
npm exec --workspace frontend playwright install chromium
npm run test:e2e:local-processor
dotnet build backend/ShadowingEnglish.sln -c Release
```

Playwright للأداة يستخدم API mock وprocessor fixture؛ اختبار الوسائط الجديد هو الذي يتحقق من API وIdentity الفعلية. لا تخلط نتيجتيهما مع SQL Server أوWindows أوAzure المنشورة. الفحوص المطلوبة لهذه البيئات موضحة في [تقرير 30 سبتمبر](MEDIA_STORAGE_TEST_REPORT_2026-09-30.md).

مراجع التنفيذ: [Azure Blob upload](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-upload)، [Download/OpenRead](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-download)، [Azurite](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite).
