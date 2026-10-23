# حد مجموع طلب تسجيل الطالب — #6

التاريخ: 23 أكتوبر 2026.

وجد الاختبار أن طلب `multipart` متدفقًا بلا `Content-Length` يمكنه إرسال
ملفين حجم كل واحد 5 MB. كل ملف تحت حد القسم 8 MB، لكن مجموع الطلب يتجاوز
الحد 8 MB + 128 KB. على TestServer، ردت الواجهة 400 بعد قراءة النموذج
بدل رفضه مبكرًا بـ413؛ بعض المضيفين لا يعرضون حد Kestrel للطلب.

أصبح مسار الحفظ يلف دفق الطلب بعداد يرفضه عند تجاوز الحد **الإجمالي**،
ويضع حد أقسام `multipart` قبل تحقق CSRF أو قراءة النموذج. حد Kestrel
ما زال طبقة إضافية عندما يتوفر. لا يقرأ العداد الملف كله في الذاكرة.

نجحت حالات الرفض لحجم معروف مسبقًا، وملف واحد متدفق زائد الحجم، وملفين
يتجاوز مجموعهما الحد رغم أن كل ملف منفردًا داخله. نجحت أيضًا حالات حفظ
تقرير Shadowing العادي وحد الثلاثة تقارير، وباقي فحوص AI النصية.

لا يغلق هذا كل #6: حد الوكيل/الاستضافة العامة يحتاج تجربة على بيئة النشر
النهائية. لم يحذف الاختبار ملفات أو بيانات طالب.

```powershell
& .\.local\tools\dotnet-10.0.402\dotnet.exe run --project tests/ShadowingEnglish.MediaChecks/ShadowingEnglish.MediaChecks.csproj -c Release -- --auth-rate-check
& .\.local\tools\dotnet-10.0.402\dotnet.exe run --project tests/ShadowingEnglish.MediaChecks/ShadowingEnglish.MediaChecks.csproj -c Release -- --ai-text-check
```
