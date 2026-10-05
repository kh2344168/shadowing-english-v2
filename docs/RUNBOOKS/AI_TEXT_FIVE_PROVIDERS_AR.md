# ربط خمس خدمات AI نصية بمراحل الدرس

هذا التعديل مبني على `checkpoint/ai-work-2026-10-02` عند `72df6e631b3d2ff700111a86aebac02a10818ab3`. ضعه على نسخة المشروع نفسها وراجع أي تعديلات محلية على الملفات قبل استبدالها. الصوت وWhisperX يظلان في المعالج المحلي.

## ماذا سيحدث بعد إضافة المفاتيح؟

1. حفظ **درس جديد** من شاشة معالجة الصوت ينشئ مهمة `Pending` في قاعدة البيانات. خدمة خلفية تُرسل نص الجمل فقط إلى أول مزود مُعد، ثم تنتقل للمزود التالي إذا فشل أو تجاوز الحد أو أخرج بيانات لا تجتاز الفحص. تحفظ كلمات، ومعاني، وأمثلة، وقاعدة، وموقف محادثة، واختبار في مسودة `Draft`.
2. الأدمن يفتح **قائمة الدروس ← راجع كلمات وأنشطة الدرس**، يعدل المسودة إذا لزم، ثم يضغط **اعتماد المحتوى**. هذا لا ينشره للطلاب.
3. بعد إسناد المنهج للمجموعة، يضغط الأدمن **نشر** صراحة. عند النشر تُثبت نسخة المحتوى المعتمد داخل نسخة المنهج. لا تتغير الدروس المنشورة القديمة بسبب إعادة توليد المسودة.
4. الطالب يرى المراحل في المسودات الجديدة بعد Shadowing: الكلمات والعبارات ← إعادة Shadowing بعد فهم الكلمات ← الجمل المختارة في «اسمع واكتب» ← اختبار كلمات وقواعد وترتيب جملة ← محادثة مبنية على كلمات الدرس. النصوص والتمارين المحفوظة لا تستهلك AI كل مرة. **المحادثة النصية** وحدها ترسل الرسالة الأخيرة ومعها ما يصل إلى ردّين سابقين إلى مزود AI، وتحفظ التصحيح والتقدم في الباك إند. الدروس المنشورة قبل إضافة إعادة Shadowing تستمر بمسارها القديم.

**الدروس الموجودة قبل التعديل:** افتح صفحة مراجعة AI للدرس واضغط «إنشاء مسودة جديدة»، ثم راجع واعتمد. حتى بعد الاعتماد يلزم نشر نسخة جديدة ليظهر النشاط. إذا كان عند المجموعة تقدم في النسخة الحالية، يمنع المشروع إعادة النشر لحماية التقدم؛ جرّب أولًا على مجموعة اختبار جديدة، ولا تتجاوز هذه الحماية بتعديل قاعدة البيانات.

## استخراج مفاتيحك بنفسك

المفاتيح تُنشأ **داخل حساباتك أنت**. لا تحفظها في المشروع، ولا تلصقها في المحادثة أو الـZIP أو `appsettings.json`. في حساب كل خدمة، فعّل الخطة المجانية فقط وتحقق من لوحة الحدود والتسعير قبل التشغيل.

| الترتيب | الخدمة | مكان المفتاح | معلومة إضافية |
|---|---|---|---|
| 1 | Groq | https://console.groq.com/keys | خطة مجانية محدودة حسب النموذج. |
| 2 | Cloudflare Workers AI | https://dash.cloudflare.com/ | تحتاج API Token يملك صلاحية Workers AI، وAccount ID من لوحة الحساب. لا تحتاج Workers Paid للتجربة المجانية. |
| 3 | Google Gemini | https://aistudio.google.com/apikey | مفتاح Gemini API من مشروعك في AI Studio؛ راجع حدود النموذج والمنطقة. |
| 4 | Mistral | https://console.mistral.ai/ | استخدم رصيد الخطة المجانية، وافحص إعدادات `PAYG` حتى لا تتجاوز الرصيد بتكلفة. |
| 5 | OpenRouter | https://openrouter.ai/keys | النموذج `openrouter/free`، وحدّه المجاني منخفض وقد يختلف النموذج المستعمل. |

**الخطة المجانية ليست وعدًا بتشغيل 100 طالب بلا توقف**. افتراضيًا الباك إند يسمح لكل طالب بـ **10 رسائل محادثة AI في اليوم UTC**، وحدّ الجلسة 10 ردود، ومحدد معدل 3 طلبات في الدقيقة. إذا سبق وضبطت `AiText:StudentDailyLimit` إلى 5 في User Secrets، ستظل قيمتك 5 حتى تغيّرها؛ يمكن للطالب حينها استكمال المحادثة في يوم لاحق. كل طالب لا ينزّل النموذج؛ الطلاب يرسلون طلبات صغيرة للباك إند. تابع الاستهلاك الفعلي قبل توسيع الاستخدام.

## إعداد المفاتيح في VS Code على Windows

بعد فك ZIP عند جذر المشروع بحيث تتداخل مجلدات `backend` و`frontend` و`tests` و`docs` مع الموجودة لديك، افتح Terminal من جذر المشروع:

```powershell
cd .\backend\ShadowingEnglish.Api
dotnet user-secrets init
dotnet user-secrets set "AiText:Providers:Groq:ApiKey" "ضع_مفتاح_Groq_هنا"
dotnet user-secrets set "AiText:Providers:Cloudflare:ApiKey" "ضع_Cloudflare_API_Token_هنا"
dotnet user-secrets set "AiText:Providers:Cloudflare:AccountId" "ضع_Account_ID_هنا"
dotnet user-secrets set "AiText:Providers:Gemini:ApiKey" "ضع_مفتاح_Gemini_هنا"
dotnet user-secrets set "AiText:Providers:Mistral:ApiKey" "ضع_مفتاح_Mistral_هنا"
dotnet user-secrets set "AiText:Providers:OpenRouter:ApiKey" "ضع_مفتاح_OpenRouter_هنا"
dotnet user-secrets set "AiText:StudentDailyLimit" "10"
```

استبدل النص بين علامتي الاقتباس بالمفتاح على **جهازك فقط**؛ أو أضف مزودًا واحدًا الآن ثم البقية لاحقًا. لا تنسخ سطرًا فيه مفتاح حقيقي إلى Git أو تقرير اختبار. `user-secrets` للتطوير المحلي فقط؛ التشغيل على Azure يحتاج إعدادات تطبيق/خزنة أسرار في الخادم، بمفاتيح البيئة مثل `AiText__Providers__Groq__ApiKey`. **لا تضف المفاتيح للـAngular**. عند تغيير الإعدادات أعد تشغيل API، ثم راجع أسماء الخدمات المفعلة في صفحة مراجعة الدرس؛ الصفحة لا تعرض المفاتيح نفسها.

إن لم تكن بعض النماذج متاحة لحسابك، غيّر `AiText:Providers:اسم_الخدمة:Model` في User Secrets إلى نموذج نصي متاح في خطتك. لا تضع رابط API من الواجهة؛ عناوين الخدمات مثبتة في الخادم.

## قاعدة البيانات والتحقق

التعديل يضيف migration باسم `20261004190000_AddAiLessonContent` وثلاثة جداول جديدة وعمودًا اختياريًا في `PublishedLessonSlots`. **لا يطبق الترحيل عند بدء التطبيق**. على قاعدة **V2 اختبارية مستقلة ومحددة** أولًا، افحص النموذج والـSQL ثم طبق الترحيل باستخدام إعداد الاتصال الخاص بقاعدة الاختبار:

```powershell
cd ..\..
dotnet build .\backend\ShadowingEnglish.sln
dotnet ef migrations has-pending-model-changes --project .\backend\ShadowingEnglish.Infrastructure --startup-project .\backend\ShadowingEnglish.Api
dotnet ef migrations script --idempotent --project .\backend\ShadowingEnglish.Infrastructure --startup-project .\backend\ShadowingEnglish.Api --output "$env:TEMP\shadowing-ai-review.sql"
dotnet ef database update --project .\backend\ShadowingEnglish.Infrastructure --startup-project .\backend\ShadowingEnglish.Api
cd .\frontend
npm ci
npm run build
npm test
```

بعد اعتماد مسار الاختبار، نفذ خطة ترحيل/نسخة احتياطية لقاعدة V2 المقصودة قبل تحديثها. لا تشغّل الأمر على V1 أو قاعدة عادية لم تتحقق من اسمها. إعداد الاتصال في هذا المشروع هو `ConnectionStrings:DefaultConnection` للباك إند. إن لم يوجد `dotnet ef` لديك: `dotnet tool install --global dotnet-ef --version 10.0.10`.

## إضافة مزود جديد في المستقبل

افتح `backend/ShadowingEnglish.Api/Modules/AI/TextAiRouter.cs` وعدّل `Catalog`: أضف **اسمًا وعنوان HTTPS ثابتًا في الباك إند فقط** ونموذجًا متاحًا وراجع صيغة المصادقة والاستجابة في وثائق المزود. إذا كان متوافقًا مع OpenAI Chat Completions، سيستخدم الطلب والتحقق والانتقال للمزود التالي تلقائيًا. إن اختلفت الصيغة، أضف adapter في الباك إند واختبارًا له قبل إدخاله في السلسلة. بعد ذلك احفظ مفتاحه عبر `dotnet user-secrets set "AiText:Providers:NewName:ApiKey" "..."` أو إعدادات الخادم المكافئة، وأعد تشغيل API. لا تضف مفتاحًا في صفحة الأدمن أو الطالب.

## ما اختُبر وما بقي

- Angular production build، و`141/141` اختبارات Angular، وESLint: نجحت.
- بناء .NET 10: نجح. اختبار API على TestServer وSQLite مؤقتة غطى حدود الصلاحيات، ترتيب المراحل، عدم كشف إجابة الاختبار، إعادة المحاولة، ومحتوى المسودة المعتمد. فحص SQL Server migration metadata وتوليد SQL نجح دون اتصال بقاعدة حقيقية.
- اختبار انتقال المزود عند `429` استخدم ردًا اصطناعيًا آمنًا. **لم تُنشأ مفاتيح حقيقية ولم تُجر مكالمات حقيقية للخدمات الخمس، ولم يطبق الترحيل على SQL Server أو Azure أو جهازك.** بعد إضافة المفاتيح اختبر درسًا واحدًا ومجموعة اختبار وطالبًا قبل توسيع الاستخدام.
