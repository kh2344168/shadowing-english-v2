# مراجعة أمان V2 — البند #28

التاريخ: 2026-10-23. الفرع: `student/lesson-flow-2026-10-11`.

## ما تم فحصه

- فحص حزم NuGet للمشروعين `ShadowingEnglish.Api` و`ShadowingEnglish.Infrastructure` مع التبعيات غير المباشرة، وفحص حزم واجهة الإنتاج باستخدام `npm audit --omit=dev`.
- مراجعة مجموعات مسارات Admin وStudent، وفحص وجود حماية CSRF في مسارات الكتابة ذات المصادقة بملفات الارتباط.
- اختبار عملي في قاعدة SQLite مؤقتة: الزائر بلا تسجيل دخول يتلقى 401، والدور الخطأ يتلقى 403، وطلبا كتابة Admin وStudent بلا رمز CSRF يتلقيان 400 ولا يغيران قاعدة البيانات.
- اختبارات الوصول للصوت المنشور لطالب من مجموعة أخرى، وعدم السماح للمتصفح بتخزينه، موجودة في مجموعة `ShadowingEnglish.MediaChecks` الرئيسية.

## الإصلاح

أظهر استرجاع مشروع Infrastructure منفردًا حزمة `System.Security.Cryptography.Pkcs` بالإصدار 9.0.4 مع تنبيهين أمنيّين، أحدهما مرتفع. مشروع API كان يثبت 10.0.13 بالفعل؛ ثُبّت 10.0.13 أيضًا في Infrastructure حتى لا ينتج البناء المستقل تبعية أقدم.

## نتيجة الفحص

- `dotnet run --project tests/ShadowingEnglish.MediaChecks/ShadowingEnglish.MediaChecks.csproj -c Release -- --security-check`: اجتاز فحص الدورين وCSRF.
- `dotnet list backend/ShadowingEnglish.Infrastructure/ShadowingEnglish.Infrastructure.csproj package --vulnerable --include-transitive --no-restore`: لم يُظهر حزمة معروفة الضعف بعد الإصلاح.
- `npm audit --audit-level=high --omit=dev`: صفر تنبيهات.

هذه مراجعة كود واختبارات محددة، وليست اختبار اختراق أو إثباتًا أن جميع المسارات أو إعدادات Azure آمنة. فحص إعدادات الاستضافة الفعلية (#20) واختبار ضغط 300/3000 طالب ما زالا منفصلين.
