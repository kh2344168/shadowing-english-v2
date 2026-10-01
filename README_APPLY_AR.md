# Shadowing V2 — AI Local Processor Auto-Start

الهدف: تثبيت أداة WhisperX/Local Processor مرة واحدة فقط، ثم تشغيلها في الخلفية تلقائيًا مع Windows للمستخدم الحالي بدون نافذة CMD.

## الملفات
انسخ محتوى هذا الـPatch فوق جذر مشروع V2 مع الحفاظ على المسارات.

## السلوك الجديد
- `Install.cmd` يثبت/يحدّث الأداة ويربطها بالحساب كما كان.
- يسجل تشغيلًا تلقائيًا per-user تحت `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` بدون Windows Service وبدون فتح Firewall.
- `StartHidden.ps1` يشغل الـLocal Processor في الخلفية ويعيد تشغيله لو خرج بشكل غير متوقع.
- التثبيت يتحقق أن المنفذ `127.0.0.1:43127` بدأ قبل إعلان النجاح.
- `Start.cmd` يبقى فقط للتشخيص اليدوي، وليس للاستخدام اليومي.
- `shadowing-link.json` لا يُعاد اختياره كل مرة؛ يظل داخل مجلد الأداة. يحتاجه المستخدم فقط لاستعادة الربط بعد مسح بيانات الموقع/تغيير بروفايل المتصفح.

## بعد تطبيق الـPatch
1. أعد تشغيل Frontend إذا كان `ng serve` لا يلتقط تحديث `frontend/public`.
2. من صفحة `تثبيت أدوات AI` نزّل الحزمة الجديدة.
3. أغلق أي نافذة Local Processor مفتوحة حاليًا.
4. فك الحزمة الجديدة وشغّل `Install.cmd` مرة أخيرة. الاعتماديات والنموذج الموجودان سيعاد استخدامهما ولن يحتاج تنزيل النموذج من الصفر.
5. بعد نجاح التثبيت أغلق نافذة التثبيت. يجب أن يظل الموقع قادرًا على رؤية الأداة، وبعد إعادة تشغيل Windows تبدأ تلقائيًا في الخلفية.

## تحقق اختياري
في PowerShell:

```powershell
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'ShadowingV2LocalProcessor'
Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 43127 -State Listen
```

## الاختبارات التي نجحت أثناء تجهيز الـPatch
- Local Processor Python suite: 18/18 PASS.
- Day2 static suites: 21/21 PASS.
- package manifest regenerated and under the existing 256 KB limit.
