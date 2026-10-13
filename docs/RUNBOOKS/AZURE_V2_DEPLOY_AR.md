# نشر Shadowing English V2 على Azure

هذا الدليل يخص App Service `shadowing-english-v2` وخطة F1 المجانية المذكورين في تقرير التسليم. تحقّق من الموارد داخل حساب Azure قبل تفعيل النشر. فرع `deploy/staging` فرع Git فقط؛ التطبيق في خطة F1 لا يملك staging slot، ولذلك أي نشر مفعّل من هذا الملف يصل إلى التطبيق الرئيسي.

## ما تم تجهيزه في الكود

- `.github/workflows/deploy-shadowing-v2.yml` يبني Angular و.NET 10، ويجمع Angular داخل `wwwroot` في حزمة API واحدة.
- `Program.cs` يقدّم الملفات الثابتة ويدعم إعادة فتح روابط Angular مباشرة، مع إبقاء مسارات `/api` غير المعروفة على 404.
- `frontend/angular.json` لا يحتاج اتصالًا بخوادم Google Fonts أثناء بناء الإنتاج. قد يظل متصفح الزائر يطلب الخطوط عند العرض.
- أي push إلى `deploy/staging` يشغّل البناء والاختبار فقط ما دام متغير GitHub `AZURE_DEPLOY_ENABLED` غير مضبوط على `true`.
- لا يشغّل الـworkflow قاعدة البيانات أو EF migrations أو إنشاء حسابات تلقائيًا.

## قبل أول نشر

1. لا تحفظ ملف Azure التلقائي المعروض في **Deployment Center → Add a workflow**؛ الملف المخصص موجود في المستودع المحلي.
2. انقل التغييرات المراد نشرها إلى فرع `deploy/staging` بمراجعة واعية. لدى نسخة العمل الحالية تغييرات أخرى غير محفوظة في commit؛ لا تستخدم `git add -A` أو `reset --hard` لهذا الغرض.
3. ارفع الملف المخصص وتغييرات `Program.cs` و`frontend/angular.json` معًا بعد المراجعة. نجاح GitHub Actions في خطوة build شرط سابق للنشر.
4. في Azure App Service، فعّل **هوية التطبيق** (Managed Identity). هذه الهوية هي التي ستقرأ Azure SQL وAzure Blob. هوية GitHub OIDC المستخدمة لتنفيذ النشر شيء مختلف.
5. اضبط إعداد التطبيق `ConnectionStrings__DefaultConnection` لقيمة Azure SQL الحقيقية بشكل خاص داخل Azure، بمصادقة Microsoft Entra Managed Identity. مثال شكل القيمة، وليس قيمة جاهزة للاستخدام:

   ```text
   Server=tcp:<sql-server>.database.windows.net,1433;Database=<v2-database>;Authentication=Active Directory Managed Identity;Encrypt=True;
   ```

   يجب منح هوية التطبيق مستخدمًا وصلاحيات مناسبة **داخل قاعدة V2 المقصودة**. لا تنسخ كلمة مرور أو connection string إلى Git أو Angular. لا تطبّق migrations على V1، ولا تنفذها تلقائيًا عند startup. راجع مخطط migrations على قاعدة V2 منفصلة قبل التطبيق.
6. إذا أردت رفع/قراءة صوت الدروس في Production، جهّز Azure Blob خاصًا وإعداداته وصلاحيات هويته كما في [دليل الصوت](AZURE_SHADOWING_MEDIA_AR.md). دون هذا الإعداد، حفظ صوت الدروس في Production يُرجع 503.
7. جهّز هوية **نشر GitHub** من Azure مع federated credential مقيد بمستودع `kh2344168/shadowing-english-v2` وفرع `deploy/staging`، وامنحها صلاحية نشر التطبيق المحدد فقط. أضف قيم `AZURE_CLIENT_ID` و`AZURE_TENANT_ID` و`AZURE_SUBSCRIPTION_ID` إلى GitHub Actions secrets. لا تضع القيم في الملف.
8. بعد نجاح البناء، واختبار اتصال قاعدة البيانات والوسائط وخطة الرجوع، اضبط GitHub Actions repository variable باسم `AZURE_DEPLOY_ENABLED` وقيمة `true`. حينها أي push لاحق إلى `deploy/staging` ينشر التطبيق الرئيسي تلقائيًا. قبل هذه الخطوة، جرّب `workflow_dispatch` للتأكد من البناء؛ تشغيله لا يتجاوز بوابة النشر.

## التحقق بعد النشر

- افتح `/health`، ثم `/login`، ثم رابطًا داخليًا مباشرًا مثل `/student/dashboard`.
- اختبر تسجيل الدخول، تحميل قائمة الدروس، وسماع صوت درس منشور بصلاحية طالب تجريبي.
- راقب App Service logs واستهلاك CPU والذاكرة وAzure SQL. نجاح البناء والفحص اليدوي لا يثبت تحمل 300 طالب؛ نفّذ اختبار حمل على بيئة مناسبة قبل الإطلاق العام.
- خطة F1 لا تدعم deployment slots، ولا ينبغي اعتبار فرع `deploy/staging` عزلًا عن الموقع الرئيسي بعد تفعيل النشر.

مراجع Azure: [GitHub Actions مع App Service](https://learn.microsoft.com/azure/app-service/deploy-github-actions)، [Azure SQL مع Managed Identity](https://learn.microsoft.com/azure/app-service/tutorial-connect-msi-sql-database)، [إرشادات النشر وdeployment slots](https://learn.microsoft.com/azure/app-service/deploy-best-practices).
