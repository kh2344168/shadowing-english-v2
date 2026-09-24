# Shadowing English V2 — Approved Rules

**Status:** Approved Rules Only
**Version:** 1.5
**Date:** 2026-09-23
**Purpose:** هذا الملف يحتوي فقط على القواعد التي تم الاتفاق عليها واعتمادها لبناء Shadowing English V2.
**Important:** لا يتم إضافة قاعدة جديدة إلى هذا الملف إلا بعد عرضها على صاحب المشروع والحصول على موافقة صريحة.

---

# 1. طريقة إدارة المشروع

يوجد ملفان أساسيان:

1. **APPROVED_RULES.md**

   - يحتوي على القواعد والقرارات الثابتة فقط.
   - لا يتم تحديثه إلا عند اعتماد قاعدة جديدة صراحة.
   - لا يُستخدم لتتبع التنفيذ.

2. **BUILD_PROGRESS.md**

   - يحتوي على ما تم تنفيذه وما لم يتم تنفيذه.
   - يتم تحديثه عند طلب صاحب المشروع.
   - لا يضيف أو يغير قواعد Architecture من تلقاء نفسه.

> لا يتم إنشاء قاعدة جديدة أو تغيير قاعدة موجودة بدون مناقشة صاحب المشروع والحصول على موافقته أولًا.

## 1.1 النقاش النقدي والمسؤولية عن الأخطاء — Rule معتمدة

في كل نقاش عن فكرة أو قرار أو تنفيذ داخل المشروع:

- لا أوافق على كلام صاحب المشروع لمجرد الموافقة؛ أفحص الافتراضات، وأوضح المخاطر والتعارضات مع القواعد والأهداف عند وجودها.
- عندما يكون لدي رأي تقني مختلف أو سبب يدعم قرارًا اتخذته، أشرح السبب والأدلة والـtrade-offs وأناقشه بوضوح، بدل التراجع التلقائي أو المجاملة.
- عندما يكون رأي صاحب المشروع صحيحًا أو يظهر خطأ مني، أعترف بالخطأ بوضوح، وأشرح أثره والتصحيح المطلوب، ولا أختلق دفاعًا عنه.
- النقد يكون للفكرة أو التنفيذ وليس للشخص، ويكون **مفيدًا ومحددًا**؛ لا أختلق اعتراضًا على كل جملة لمجرد إظهار النقد.
- أميز بين ما تم التحقق منه فعليًا، وما هو اقتراح أو توقع أو قرار مؤجل؛ لا أصف هيكل ملفات فارغًا بأنه تطبيق جاهز، ولا أدّعي نجاح Build أوTest قبل تشغيله.
- عند وجود بدائل، أوضح ما الذي نكسبه وما الذي نخسره، وأذكر رأيي المبرر، بينما يظل قرار تغيير القواعد أو اعتماد خيار Product جديد لصاحب المشروع.
- إذا اكتشفت أثناء التنفيذ أن المطلوب يتعارض مع Rule معتمدة أو يستلزم Rule جديدة، أنبّه صاحب المشروع وأطلب موافقته قبل التعديل.

**مثال مرجعي:** تسليم أسماء ملفات فقط عندما كان المطلوب مشروعًا قابلًا لتشغيل `npm install` كان سوء فهم وتسليمًا غير مطابق؛ التصرف الصحيح هو الاعتراف بذلك وتصحيح التسليم، لا الدفاع عنه باعتباره إنجازًا مكتملًا.

---

# 2. هدف V2

Shadowing English V2 هو إصدار Production جديد لمنصة تعلم الإنجليزية.
الأهداف الأساسية:

- سرعة عالية.
- استهلاك Data/Bandwidth منخفض.
- تكلفة Hosting قابلة للتحكم.
- Security قوية.
- Architecture واضحة وسهلة الفهم.
- Maintainability عالية.
- قابلة للعمل بواسطة فريق مستقبلًا.
- قابلة للتوسع لعشرات الآلاف من المستخدمين بدون إعادة بناء جذرية.
- استخدام المشروع كمسار تعلم عملي للـBackend وFull-stack.

V1 يظل **Read-only reference**، ولا يتم خلط كوده مع V2.

## 2.1 نطاق البداية التجارية

- الهدف الأول هو بناء نسخة قابلة للبيع والتشغيل لحوالي **300 Student** كبداية.
- لا يشترط اكتمال كل Features بنسبة 100% قبل أول بيع أوPilot مدفوع.
- يجب أن يكون المسار الذي يتم بيعه مكتملًا من البداية إلى النهاية، وآمنًا وسريعًا وقابلًا للدعم.
- الأدوار الأربعة موجودة في Architecture، لكن يمكن تعطيل Teacher وSupervisor مؤقتًا إذا كان العميل يحتاج Admin وStudent فقط.
- كل صفحة تُبنى وفق نفس قواعد Security وPerformance وDiagnostics وResponsive UI/UX، حتى لو كانت بقية الصفحات مؤجلة.
- الخصائص المتقدمة لا تمنع إطلاق Core flow القابل للاستخدام والدفع.
- يبدأ التوسع بعد بيانات استخدام حقيقية، وليس لمجرد توقع احتياجات مستقبلية.
- عدد Registered Students لا يساوي Concurrent Students؛ اختبارات الحمل تعتمد على الذروة الواقعية المتوقعة مع هامش أمان.
- نحافظ على Codebase واحدة، ولا ننشئ نسخة كود منفصلة لكل مدرس أوعميل.
- تخصيص النسخة الحالية يتم عبر Settings وFeature availability وConfiguration قدر الإمكان، وليس عبر Forks مختلفة.

---

## 2.2 أولوية التنفيذ الحالية

أولوية إعادة البناء خلال الدورة الحالية هي:

1. **Student** — الأولوية الأعلى.
2. **Admin** — الأولوية الثانية.
3. **Teacher** و **Supervisor** يظلان أدوارًا أساسية في Architecture، لكن استكمال Features الخاصة بهما لا يؤخر Student/Admin Core.

هذه أولوية تنفيذ وليست حذفًا لأي Role من المنتج.

---

# 3. الأدوار الأساسية

```
Admin
Teacher
Supervisor
Student
```

## Admin

مسؤول عن إدارة النظام والمحتوى حسب الـFeature:

- Lesson Library.
- Lesson Builder.
- AI Processing review.
- Curriculum.
- Groups.
- Students.
- Teachers.
- Supervisors.
- Publishing.
- Subscriptions.
- Settings.

## Teacher

الـTeacher عنصر أساسي ومستقل، ولا يتم دمجه مع Supervisor.
وظيفته العامة:

- التعامل التعليمي المباشر مع الطلاب.
- متابعة Progress.
- مراجعة Recordings.
- تقديم Feedback.
- التواصل مع الطلاب.
- متابعة الأداء التعليمي.

التفاصيل الدقيقة لصلاحيات Teacher مقابل Supervisor تُحدد قبل تنفيذ الـFeatures المتعلقة بهما.

## Supervisor

Role مستقل عن Teacher:

- الإشراف على الطلاب والمدرسين حسب الصلاحيات.
- Reports.
- Weekly Summary.
- Messages.
- متابعة الأداء.
- المتابعة الإدارية/التعليمية الأعلى.

## Student

- يدرس المحتوى المنشور والمسموح له.
- ينفذ مراحل الدرس.
- يحفظ Progress.
- يستخدم Recordings.
- يستخدم Vocabulary/Sentences Bank.
- يتعامل مع Messages والتقييمات حسب صلاحياته.

> إخفاء زر في Frontend لا يعتبر Authorization. كل Permission حقيقية تتحقق في Backend.

## 3.1 Role Availability — تفعيل وتعطيل الأدوار

الأدوار الأربعة جزء ثابت من Architecture:

```text
Admin
Teacher
Supervisor
Student
```

لكن تشغيل كل دور ليس إلزاميًا في كل Deployment أومرحلة إطلاق.

- Admin وStudent هما Core roles في النسخة الأولى القابلة للبيع.
- Teacher وSupervisor يمكن تفعيلهما أوتعطيلهما مؤقتًا من إعداد مركزي.
- تعطيل الدور لا يحذف تعريفه أوUsers أوHistory أوبياناته.
- إعادة التفعيل لا تحتاج Migration أوإعادة بناء صفحات الدور.
- عند تعطيل دور:
  - تختفي روابطه وصفحاته من Navigation.
  - تمنع Route guards تحميل Routes الخاصة به.
  - يمنع Backend الوصول إلى Endpoints الخاصة به ويرجع Error code واضحًا مثل `ROLE_DISABLED`.
  - لا يكفي إخفاء عناصر Frontend.
- Role availability لا تستبدل Permissions؛ يجب نجاح فحصين منفصلين:
  1. هل الدور متاح في النظام الحالي؟
  2. هل المستخدم يملك Permission للعملية؟
- في النسخة الحالية غير الـSaaS، Availability تكون على مستوى النظام/Deployment كله.
- إذا تم نشر نسخة مخصصة لعميل، تتغير الإعدادات دون إنشاء Fork جديد من الكود.
- الصفحات المعطلة يمكن أن تظل موجودة كـlazy chunks، لكن لا تُحمّل للمستخدم غير المسموح له.

مثال:

```text
Deployment A: Admin + Student
Deployment B: Admin + Teacher + Student
Deployment C: Admin + Teacher + Supervisor + Student
```

---

## 3.2 Protected Primary Admin — قرار معتمد 2026-09-23

- في كل Deployment مستقل يوجد **Primary Admin** محمي واحد، وهو حساب خالد في النسخة الحالية. التعريف الأمني يتم بمعرّف المستخدم الثابت (`UserId`) وليس بالاسم أوالبريد الإلكتروني الظاهرين.
- Primary Admin وAdmin العادي يستخدمان وظائف لوحة الإدارة اليومية نفسها؛ لا نبني لوحة SaaS أوRole خامس لمجرد هذا الاختلاف.
- Primary Admin يستطيع إضافة أي Admin عادي وإزالة صفة Admin عن أي Admin عادي أوتعطيل وصوله من عملية إدارية صريحة، وفق سياسة حفظ البيانات والتاريخ.
- Admin العادي يستطيع **إضافة Admin عادي آخر** من واجهة الإدارة، لكنه لا يستطيع إنشاء Primary Admin جديد، أوإزالة/تعطيل/حظر Primary Admin أوتعديل هويته المحمية أوإسقاط صلاحياته، سواء من الواجهة أوالـAPI.
- إزالة صفة Admin عن الأدمنز الآخرين عملية حصرية لـPrimary Admin في نطاق القرار الحالي؛ باقي الأدمنز لهم صلاحيات الإدارة التشغيلية المعتادة وإضافة أدمنز.
- واجهة إدارة الأدمنز تبقى بسيطة: Primary Admin يرى قائمة الأدمنز وإجراءات الإضافة والإزالة؛ Admin العادي يتاح له إجراء الإضافة فقط. لا ننشئ لوحة إدارة جديدة لكل منهما.
- الحماية **Backend-enforced** لجميع مسارات إدارة الحسابات والأدوار، ولا تعتمد على إخفاء الأزرار في Angular. أي عملية حساسة تحتاج Authorization وValidation وCSRF/الحماية المناسبة وDiagnostics/Audit بدون أسرار.
- إنشاء الحساب الرئيسي وتحديده يكونان بإجراء صريح وآمن، لا بأول تسجيل عشوائي أوSeed خفي عند Login/Startup. كيفية التنفيذ التقنية تُحدد بعد فحص الكود الفعلي، دون افتراض Schema أوMigration بعينها مسبقًا.
- لا ننفذ حاليًا نقل ملكية، ولاSuper Admin مركزي لجميع العملاء، ولاOrganizations/Tenants/Multi-tenancy. بيع حق الاستخدام مع احتفاظ خالد بالوصول المحمي يستلزم إيضاح هذا الوصول وحدوده للعميل في الاتفاق.
- هذه القاعدة **قرار منتج معتمد، وليست ادعاءً بأن الوظيفة بُنيت أو اختُبرت**؛ التنفيذ والاختبارات يتتبعان في `BUILD_PROGRESS.md`.

---

# 4. قواعد Groups

- الطالب له **Group واحدة فعّالة فقط في نفس الوقت**.
- يمكن إنشاء Student بدون Group بشكل مؤقت.
- Student بدون Group لا يحصل على Curriculum دراسي حتى يتم إسناده إلى Group.
- نقل Student من Group إلى Group أخرى عملية صريحة.
- النقل لا يمحو Progress أوHistory السابق.
- Multiple active Groups غير مدعومة في V2 الحالي.
- دعم أكثر من Group في المستقبل يحتاج قرارًا جديدًا صريحًا قبل تغيير Database أوBusiness Rules.

---

# 5. Backend Source of Truth

الـBackend هو المصدر النهائي للحقيقة في:

- Authentication.
- Authorization.
- Roles.
- Permissions.
- Subscription state.
- Publish state.
- Student progress النهائي.
- Group membership.
- Curriculum access.
- Recording metadata.
- Business-critical state.

لا يعتمد النظام على localStorage أوFrontend state أوHidden UI كمصدر نهائي للحقيقة.

---

# 6. No Hidden Writes

ممنوع أن تقوم:

- Login.
- Refresh.
- Startup.
- فتح صفحة.
- تحميل Session.
- تهيئة التطبيق.

بـCreate/Update/Delete لبيانات Business كـside effect غير معلن.

> Reads لا تتحول إلى Writes تلقائيًا.

---

# 7. Published Content Is Immutable

- Published Version لا يتم overwrite عليها.
- تعديل المحتوى يتم على Draft/Definition جديدة.
- Publish جديد ينتج Version جديدة.
- النسخ القديمة تظل قابلة للتتبع.

---

# 8. Lesson Library وCurriculum

- Lesson Library هي المصدر الأصلي للمحتوى.
- تعديل Lesson Definition لا يغير Published Version موجودة.
- المحتوى التاريخي لا يحذف بطريقة تكسر History.
- Curriculum Template قابل لإعادة الاستخدام.
- Group Curriculum مستقل عن Template.
- Save لا يساوي Publish.
- Publish ينشئ Published Version مستقلة.
- Scheduled publishing لا يظهر للطالب قبل موعده.
- النسخ المنشورة القديمة تبقى قابلة للتتبع.

---

# 9. Lesson Slot

التقدم لا يرتبط بـLessonId فقط.

```
Published Curriculum Version
→ Week
→ Day
→ Order
→ Lesson Slot
→ Lesson Version
```

المفهوم المنطقي للـSlot يتضمن:

```
slotId
publishedCurriculumVersionId
lessonVersionId
weekNumber
dayNumber
order
availability
```

---

# 10. Progress

المفتاح المنطقي للتقدم يعتمد على:

```
studentId
publishedCurriculumVersionId
slotId
stageKey
```

وليس `studentId + lessonId` فقط.
هذا يمنع خلط التقدم إذا أعيد استخدام نفس Lesson في أكثر من مكان أوCurriculum.

---

# 11. Idempotent Writes

أي Write يمكن إعادة إرساله بسبب Retry أوضعف الشبكة أوOffline sync يجب أن يكون Idempotent عندما يكون ذلك منطقيًا.
أمثلة:

- Publish.
- Save Progress.
- Complete Stage.
- Upload Completion.
- Scheduled Jobs.

> إعادة نفس العملية لا تنشئ نتيجة Business مكررة.

---

# 12. Concurrency

- لا نعتمد على Client timestamp وحده.
- العمليات التي قد تتعارض تحتاج revision/row version أوآلية مناسبة.
- Conflict لا يتم overwrite عليه بصمت.
- Backend يعيد Conflict واضح، والـUI يتعامل معه.

---

# 13. Backend Architecture

الـBackend يبدأ كـ:

> **ASP.NET Core Modular Monolith**

ولا نستخدم Microservices أوKubernetes أوRedis أوEvent Bus معقد لمجرد الشكل.

> نستخدم أصغر Architecture صحيحة وقابلة للتوسع بما يكفي.

## 13.1 الشجرة الأساسية للمشروع

هذه هي الشجرة الأساسية المعتمدة عند إنشاء V2. يمكن إضافة ملفات داخل الحدود الموجودة عند تنفيذ Feature فعلية، لكن لا يتم تغيير الحدود الرئيسية بصمت.

```text
shadowing-english-v2/
├── frontend/
├── backend/
├── tests/
│   ├── e2e/
│   ├── performance/
│   └── security/
├── docs/
│   ├── APPROVED_RULES.md
│   ├── BUILD_PROGRESS.md
│   ├── PROJECT_MAP.md
│   ├── ARCHITECTURE.md
│   ├── SECURITY.md
│   ├── PERFORMANCE.md
│   ├── OFFLINE_AND_MEDIA.md
│   ├── RUNBOOKS/
│   └── ADR/
├── infrastructure/
│   ├── azure/
│   ├── environments/
│   └── scripts/
├── .github/
│   └── workflows/
├── .editorconfig
├── .gitignore
├── README.md
└── LICENSE
```

## 13.2 شجرة Backend الأساسية

```text
backend/
├── ShadowingEnglish.Api/
│   ├── Bootstrap/
│   ├── Common/
│   ├── Diagnostics/
│   ├── Middleware/
│   ├── Modules/
│   │   ├── Auth/
│   │   ├── Users/
│   │   ├── Roles/
│   │   ├── RoleAvailability/
│   │   ├── Lessons/
│   │   ├── Curriculums/
│   │   ├── Groups/
│   │   ├── Progress/
│   │   ├── Recordings/
│   │   ├── Media/
│   │   ├── AI/
│   │   ├── Reports/
│   │   ├── Messaging/
│   │   ├── Subscriptions/
│   │   └── Settings/
│   ├── appsettings.json
│   ├── appsettings.Development.json
│   └── Program.cs
├── ShadowingEnglish.Core/
│   ├── Shared/
│   └── ModuleContracts/
├── ShadowingEnglish.Infrastructure/
│   ├── Database/
│   │   ├── Configurations/
│   │   ├── Migrations/
│   │   └── Seed/
│   ├── Storage/
│   ├── AIProviders/
│   ├── Jobs/
│   └── Observability/
└── ShadowingEnglish.Tests/
    ├── Unit/
    ├── Integration/
    └── Contract/
```

قواعد الشجرة:

- المشروع يظل Modular Monolith وله Deployable Backend واحد في البداية.
- لا ننشئ كل المجلدات الفرعية داخل كل Module بلا استخدام.
- عند تنفيذ Module يمكن إضافة `Endpoints` و`Application` و`Domain` و`Contracts` حسب حاجته الفعلية.
- لا ننشئ Generic Repository أوBase Service أوAbstraction لمجرد توقع استخدامها مستقبلًا.
- `Program.cs` للـcomposition والتهيئة، وليس لتجميع Business Logic.
- Settings الحساسة لا توضع داخل `appsettings.json` المحفوظ في Git.

---

# 14. Separation of Concerns

لا يتم خلط:

- UI.
- Business Logic.
- Data Access.
- Media.
- AI.
- Storage.
- Authentication.
- Diagnostics.

Frontend مسؤول عن UI وclient state والتواصل مع API.
Backend مسؤول عن Authorization وBusiness Rules وValidation وPersistence وSecure Integrations وFinal Truth.

---

# 15. Angular Architecture

- Angular Standalone.
- Feature-based structure.
- Route-level Lazy Loading.
- Deferred loading للأجزاء الثقيلة عند الحاجة.
- فصل UI عن data-access.
- Core / Shared / Features boundaries.
- لا Secrets في Frontend.

الـStudent initial bundle لا يحمل Admin/Teacher/Supervisor أوStages غير مطلوبة بلا داعٍ.

## 15.1 SCSS + Tailwind Styling Policy

المشروع يستخدم **SCSS وTailwind معًا** بحدود واضحة:

### Tailwind

يُستخدم أساسًا في:

- Layout.
- Flex/Grid.
- Spacing.
- Responsive breakpoints.
- Typography الأساسية.
- Sizing.
- Common visual states.
- سرعة بناء UI المتكرر.

### SCSS

يُستخدم أساسًا في:

- Styles المعقدة الخاصة بالـComponent.
- Animations وtransitions المركبة.
- WaveSurfer/media player customization.
- Selectors أوحالات يصعب التعبير عنها بوضوح في Tailwind.
- Shared tokens/mixins المحدودة التي لها استخدام فعلي.
- Third-party library overrides داخل Scope آمن.

### القواعد

- لا نكتب نفس Style مرة في Tailwind ومرة في SCSS.
- Global SCSS يقتصر على reset وtokens وtheme foundations وTailwind entry والضروريات العامة.
- Component-specific styles تبقى في ملف الـComponent `.scss`.
- نستخدم CSS variables للـdesign tokens المشتركة التي يحتاجها Tailwind وSCSS.
- لا نكثر من `@apply` حتى لا يتحول Tailwind إلى SCSS آخر مخفي.
- لا Inline styles إلا لقيمة ديناميكية لا يمكن تمثيلها بصورة سليمة.
- Default Angular style extension هو `.scss`.
- أي Library أوStyle global ثقيل يُقاس تأثيره قبل اعتماده.
- UI components المشتركة مثل Buttons وInputs وCards وLoading/Error/Empty states لها تصميم موحد، ولا يعاد اختراعها في كل صفحة.
- كل صفحة تحافظ على Responsive وAccessibility وconsistent visual hierarchy.

## 15.2 شجرة Frontend الأساسية

```text
frontend/
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── auth/
│   │   │   ├── config/
│   │   │   ├── diagnostics/
│   │   │   ├── guards/
│   │   │   ├── http/
│   │   │   ├── role-availability/
│   │   │   └── session/
│   │   ├── shared/
│   │   │   ├── layouts/
│   │   │   │   ├── admin-layout/
│   │   │   │   ├── teacher-layout/
│   │   │   │   ├── supervisor-layout/
│   │   │   │   └── student-layout/
│   │   │   ├── ui/
│   │   │   │   ├── buttons/
│   │   │   │   ├── forms/
│   │   │   │   ├── feedback/
│   │   │   │   └── page-states/
│   │   │   ├── directives/
│   │   │   ├── pipes/
│   │   │   ├── models/
│   │   │   └── utils/
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   │   └── pages/
│   │   │   │       └── login/
│   │   │   ├── admin/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── lessons/
│   │   │   │   ├── lesson-builder/
│   │   │   │   ├── ai-processing/
│   │   │   │   ├── curriculums/
│   │   │   │   ├── groups/
│   │   │   │   ├── students/
│   │   │   │   ├── teachers/
│   │   │   │   ├── supervisors/
│   │   │   │   ├── subscriptions/
│   │   │   │   └── settings/
│   │   │   ├── teacher/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── students/
│   │   │   │   ├── progress/
│   │   │   │   ├── recordings/
│   │   │   │   ├── feedback/
│   │   │   │   └── messages/
│   │   │   ├── supervisor/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── students/
│   │   │   │   ├── teachers/
│   │   │   │   ├── reports/
│   │   │   │   ├── weekly-summary/
│   │   │   │   └── messages/
│   │   │   └── student/
│   │   │       ├── dashboard/
│   │   │       ├── curriculum/
│   │   │       ├── lesson/
│   │   │       │   ├── overview/
│   │   │       │   ├── shadowing/
│   │   │       │   ├── vocabulary/
│   │   │       │   ├── listen-type/
│   │   │       │   ├── quiz/
│   │   │       │   └── conversation/
│   │   │       ├── progress/
│   │   │       ├── recordings/
│   │   │       ├── knowledge-bank/
│   │   │       └── messages/
│   │   ├── app.config.ts
│   │   ├── app.routes.ts
│   │   └── app.component.*
│   ├── styles/
│   │   ├── _tokens.scss
│   │   ├── _mixins.scss
│   │   └── _theme.scss
│   ├── environments/
│   ├── styles.scss
│   └── index.html
├── public/
├── angular.json
├── package.json
├── postcss.config.*
├── tailwind.config.*
└── tsconfig.json
```

ملاحظات:

- أسماء ملفات إعداد Tailwind/PostCSS النهائية تتبع النسخة المثبتة فعليًا، ولا ننشئ ملف Configuration غير مستخدم.
- صفحات Teacher وSupervisor موجودة في الشجرة، لكن يمكن منع Routes الخاصة بها من التحميل عند تعطيل الدور.
- الشجرة تحدد الحدود الأساسية، وليست أمرًا بإنشاء كل Service وModel وComponent متوقع من أول يوم.

## 15.3 قاعدة Initial Scaffolding وPage Shells

يتم إنشاء الشجرة الأساسية والصفحات المؤكدة مرة واحدة في بداية المشروع لتقليل التكرار، لكن لا يتم إنشاء مئات الملفات الوهمية.

كل Page shell مؤكدة يمكن أن تحتوي على:

```text
page-name/
├── page-name.page.ts
├── page-name.page.html
├── page-name.page.scss
└── page-name.page.spec.ts
```

والحد الأدنى داخلها:

- Standalone Angular Component.
- `ChangeDetectionStrategy.OnPush` عندما يناسب الصفحة.
- Route lazy-loaded.
- Layout الصحيح للدور.
- Role/availability guard المناسب.
- Page title وbasic metadata.
- Responsive semantic shell.
- Placeholder واضح مثل `Coming Soon` إذا لم يبدأ التنفيذ.
- Smoke test يتأكد من إنشاء الصفحة.
- لا API call ولاMock business data ولاSide effect لمجرد وجود الـShell.

قواعد الـScaffolding:

- كل Shell يجب أن يمر من Build وTests من أول Commit.
- لا unused imports أوbroken routes أوfake services.
- لا نسجل Diagnostics لعملية Business غير موجودة؛ Diagnostics تضاف عند إضافة العملية الحقيقية.
- لا ننشئ مسبقًا `store`, `api service`, `DTO`, `repository`, أوchild components إلا عند ظهور حاجة فعلية في الصفحة.
- لا ننشئ Shell لFeature غير معتمدة لمجرد أنها قد تكون مفيدة مستقبلًا.
- الصفحات غير المكتملة لا تعرض بيانات مزيفة وكأنها Production.
- حالة التنفيذ تُتبع في `BUILD_PROGRESS.md`.
- تعطيل Role يتم من نقطة مركزية، وليس عبر `if` مكرر داخل كل Component.

## 15.4 أسلوب تنفيذ الصفحات بعد الـScaffolding

```text
Create stable project tree and confirmed page shells once
→ Keep the complete solution building
→ Select one page/vertical slice
→ Confirm its scope and contract
→ Add only the data-access/state/components/models it needs
→ Connect Frontend + Backend + Database/Storage
→ Add Diagnostics + Tests + Security + Performance checks
→ Mark it DONE
→ Move to the next page
```

بهذه الطريقة لا نكرر إنشاء Route وPage وLayout كل مرة، وفي الوقت نفسه لا نملأ المشروع بكود متوقع سيتم حذفه أوإعادة بنائه لاحقًا.

---


## 15.5 Approved Frontend Tooling & Hosting Protection

تمت الموافقة على الأدوات التالية:

- **Angular CDK** للأجزاء التي تحتاج Drag & Drop أوAccessibility primitives أوVirtual Scrolling أوغيرها من CDK utilities.
- **ESLint** لجودة الكود والتحقق في Development/CI.
- **Prettier** لتوحيد Formatting في Development/CI.
- **Playwright** لاختبارات E2E وCritical flows في Development/CI.

قواعد إلزامية لحماية الأداء والسرعة والمساحة والاستضافة:

- Angular CDK لا يتم Import له بالكامل أوGlobal بشكل افتراضي؛ يتم استيراد الجزء المطلوب فقط داخل الـFeature التي تحتاجه، ويفضل داخل Lazy-loaded feature.
- استخدام Angular CDK لا يعني إضافة Angular Material.
- أي Runtime dependency جديدة يجب قياس أثرها على Bundle قبل اعتماد استخدامها الفعلي.
- ESLint وPrettier وPlaywright أدوات Development/CI ولا تدخل Browser production bundle.
- Playwright browsers وReports وTest artifacts لا يتم رفعها إلى Production hosting.
- Tailwind وSCSS أدوات Build-time؛ الاستضافة تستقبل CSS الناتج فقط.
- Production deployment لا يحتوي `node_modules` ولا Development/Test tooling؛ يتم نشر Frontend build output وBackend publish output فقط مع ملفات Runtime المطلوبة.
- أي Tool أوLibrary مستقبلية تؤثر على Runtime أوHosting size تخضع لنفس قواعد Performance/Bundle measurement قبل الاستخدام.

# 16. Progressive Loading

```
Lesson list
→ Lightweight metadata only

Lesson opened
→ Lesson metadata + stage status

Stage opened
→ Stage data only

Media requested
→ Required media/range only

Next likely content
→ Small controlled prefetch

Previously used content
→ Reuse local/cache when valid
```

> Never load all lessons when only visible cards are needed.

---

# 17. Lists & Pagination

القوائم الكبيرة تستخدم:

- Server-side pagination.
- Backend search/filter.
- Virtualization عند الحاجة الفعلية.

لا يتم إرجاع كل Lessons أوكل Stages أوكل Media في Request واحدة بلا داعٍ.

---

# 18. Data & Media Storage

- SQL للبيانات المنظمة والـmetadata.
- Object Storage للصور والصوت والفيديو والتسجيلات والملفات الكبيرة.

> Large media does not live inside SQL.

---

# 19. Media Streaming

- Media العادية تستخدم Streaming/Range عند الحاجة.
- لا يتم تنزيل الملف كاملًا قبل التشغيل بلا داعٍ.
- Pre-buffer محدود.
- Prefetch محدود للمحتوى التالي المتوقع.

مثال Shadowing:

```
Play segment 5
Prefetch segment 6
Do not automatically load segments 7-20
```

---

# 20. Offline-capable

التطبيق **Offline-capable** وليس Download-everything automatically.
الافتراضي:

- App shell يمكن أن يعمل Offline بعد أول تحميل ناجح.
- بعض البيانات الخفيفة يمكن إعادة استخدامها محليًا.
- Progress يمكن أن يكون Pending Sync.
- Media تعمل Streaming Online افتراضيًا.
- Full media تحفظ Offline فقط عند Download صريح من المستخدم.

---

# 21. Explicit Offline Download

إذا اختار الطالب `Download lesson` يتم تنزيل النسخة المطلوبة للاستخدام Offline.
إذا حمل الطالب مثلًا:

```
10 lessons = 100 MB
```

ثم أعاد دراستها، وكان المحتوى المحلي ما زال موجودًا ونفس النسخة، فلا يتم إعادة تنزيل نفس 100MB مرة أخرى.

> Repeat-study media bytes يجب أن تقترب من الصفر عندما تكون النسخة المحلية صالحة.

---

# 22. Versioned Assets

المفاهيم الأساسية لكل Asset منشورة:

```
assetId
contentHash
version
byteSize
contentType
```

إذا تغير Asset صغير فقط، لا يجب إعادة تنزيل Lesson كاملة.

---

# 23. Cache Responsibilities

```
HTTP/Browser Cache
→ transport/static caching

CacheStorage
→ app shell + explicit offline binaries

IndexedDB
→ manifests + local structured data + outbox

localStorage
→ small non-sensitive UI preferences only
```

ممنوع تخزين Secrets أوBusiness truth النهائي في localStorage.

---

# 24. User-scoped Local Data

عند Logout أوAccount switch لا يجوز للحساب الجديد رؤية:

- Progress cache.
- Private manifest.
- Recording metadata.
- Offline queue.
- Private lesson data.

الخاصة بالحساب السابق.

---

# 25. Offline Progress

- Progress المهم لا يضيع عند انقطاع الإنترنت.
- يوضع في Local Outbox.
- تتم مزامنته عند رجوع الاتصال.
- Retry لا ينشئ Duplicate.
- 401/403 يوقف Sync ويحتاج حل Session/Permission.
- Validation errors لا تدخل Retry loop بلا نهاية.
- Backend يظل Source of Truth النهائي.

---

# 26. AI Architecture

- Production AI keys في Backend فقط.
- AI providers خلف abstraction واضحة.
- AI Processing منفصل عن Lesson Builder.
- Heavy AI work لا يمنع فتح Student pages.
- Structured Output يتم Validate قبل الحفظ.
- AI لا ينشر Lesson أوCurriculum تلقائيًا.
- Admin review منفصل عن Publish.
- Retry/Fallback محدود ومراقب.
- AI jobs المهمة لها Status وDiagnostics.

---

# 27. Recordings

- Temporary attempts تبقى Local قدر الإمكان.
- لا يتم رفع كل محاولة تلقائيًا.
- Final/Selected Recording هي المرشح الأساسي للرفع.
- Binary في Object Storage.
- Metadata في SQL.
- الوصول للتسجيلات يحتاج Authorization.
- التسجيلات الخاصة لا تدخل Public Cache.
- Upload Completion يكون آمنًا وIdempotent.

---

# 28. Security First

- No secrets in Frontend.
- No secrets in Git.
- No secrets in Logs.
- Validate every input.
- Authorization in Backend.
- Least privilege.
- HTTPS في Staging/Production.
- File upload validation.
- Rate limiting للعمليات الحساسة.
- Secret scan في CI.
- Dependency/security scan في CI.

---

# 29. Diagnostics Mandatory

أي Logic مهم في Frontend أوBackend يجب أن يحتوي Diagnostics واضحة:

```
Start
Safe inputs
Relevant IDs
Result
Success / Failure
Duration
Errors
trace/correlation ID when appropriate
```

ولا يتم تسجيل Passwords أوTokens أوAPI keys أوFull signed URLs أوSecrets.

---

# 30. Performance Is Measured

لا نعتمد على الانطباع.
يتم قياس:

- Initial JS.
- Lazy chunks.
- Request count.
- Transferred bytes.
- LCP.
- INP.
- CLS.
- API p50/p95/p99 عند الحاجة.
- Largest response.
- Media transferred.
- Duplicate requests.
- Long tasks.
- Media start latency.

---

# 31. Cost/Bandwidth First-class

نقيس ونقلل:

- Data Out.
- Duplicate downloads.
- Duplicate requests.
- Unnecessary API calls.
- Media proxying.
- Storage waste.

ونتتبع عند الحاجة:

```
Repeat-study media bytes
MB / study hour
Cache hit rate
Origin egress
Recording upload volume
Storage usage
```

---

# 32. Performance Targets الحالية

Targets أولية إلى أن يتم إنشاء Baseline ثابت:

```
LCP                       < 2.5s
INP                       < 200ms
CLS                       < 0.1
Normal API p95            < 400ms target
Warm Shadowing playback   < 300ms target
Duplicate critical reqs   = 0
Unexpected startup writes = 0
```

أي رقم يصبح CI Gate فقط بعد تثبيت بيئة القياس والـBaseline.

---

# 33. Scalability

نفصل بين Registered Users وConcurrent Users.
لا نفترض أن 20,000 Registered = 20,000 Concurrent.
التوسع يعتمد على:

- Stateless API قدر الإمكان.
- efficient SQL.
- indexes.
- pagination.
- Object Storage.
- media offloading.
- background jobs للمهام الثقيلة.
- realistic load tests.

---

# 34. Same Architecture Across Environments

Local / Staging / Production تستخدم نفس:

- Business Rules.
- API Contracts.
- Architecture.

الاختلاف يكون في Configuration وSecrets وURLs وProviders وData الخاصة بالبيئة.

---

# 35. Database Rules

- EF Core migrations محفوظة في Git.
- لا Production schema changes عشوائية.
- UTC للتواريخ المهمة.
- Soft delete عندما يكون التاريخ مطلوبًا.
- Indexes مبنية على queries حقيقية.
- لا Generic Repository فوق EF Core بدون سبب حقيقي.
- Integration tests للعلاقات والقيود المهمة.
- Seed data explicit وidempotent.
- لا Seed hidden عند Login/Refresh.

---

# 36. Accessibility

المسارات الأساسية تستهدف Accessibility جيدة وWCAG 2.2 AA قدر الإمكان:

- Keyboard navigation.
- Visible focus.
- Labels.
- Contrast.
- Touch targets.
- Reduced motion.
- Screen reader feedback.
- عدم الاعتماد على اللون فقط.
- بديل عملي لـDrag & Drop.

---

# 37. Git Workflow

ممنوع العمل المباشر على `main`.
العمل:

```
feature/*
fix/*
perf/*
refactor/*
docs/*
```

ثم:

```
Commit
→ Push
→ Pull Request
→ CI
→ Review
→ Merge
```

عند العمل الفردي: PR self-review + checklist + CI.

---

# 38. CI

من البداية:

- Frontend build.
- Backend build.
- Formatting/Lint.
- Unit tests الموجودة.
- Secret scan.
- Dependency scan.

ثم تدريجيًا:

- Integration tests.
- API contract tests.
- Critical E2E.
- Migration tests.
- Bundle budgets.
- Performance regression.
- Accessibility automation.
- Security tests.

---

# 39. Production Development = Vertical Slices

تنفيذ Production الحقيقي يكون Feature-by-Feature:

```
Frontend
+ API Contract
+ Backend
+ Database/Storage
+ Integration
+ Authorization
+ Validation
+ Diagnostics
+ Tests
+ Performance
+ Security
+ Staging
+ Documentation
```

UI وحدها لا تعني DONE.

---

## 39.1 طريقة التنفيذ المعتمدة — Feature by Feature

- ننفذ كل Feature عبر الـDatabase/API contract والأدوار التي تستخدمها بدل إكمال كل Role بمعزل عن الآخر.
- مثال: Shadowing content من Admin → تجربة الطالب وحفظ تقدمه من Student → متابعة Teacher/Supervisor حسب الصلاحيات والنطاق الفعلي، مع الاختبارات والتشخيص.
- لا نفترض أن كل Feature تحتاج وظائف في الأدوار الأربعة؛ نضيف فقط ما تحتاجه فعلًا، ولا نعتبر Recording review مكتملة قبل تخزين وأذونات الوصول المطلوبة.
- خطة التنفيذ تبقى **خمسة أيام**؛ أي تغيير جوهري في تقسيمها أو نقل مهام يتطلب اتفاقًا، ولا يصبح جزءًا من Approved Rules بصمت.

---

# 40. Frontend Prototype

يمكن عمل Frontend-only Prototype/Demo لمشاهدة المنتج وUX.
لكن:

- منفصل عن Production implementation.
- Mock adapters واضحة.
- لا Production secrets.
- لا يعتمد عليه كـSource of Truth.
- Mock shortcuts لا تتحول إلى Production logic.

بعد Prototype، Production يتم Vertical Slices.

---

# 41. Strict Change Scope

قبل أي تعديل مهم:

```
1. Exact request
2. Files allowed to change
3. Files forbidden to touch
4. Why each changed file is needed
5. Exact logic being changed
6. Required tests
7. Final diff
8. If extra file/module is needed → stop and explain first
```

> No unrelated refactors.

---

# 42. No Unrelated Side Effects

تعديل Feature لا يغير Feature أخرى بدون سبب معلن واختبارات مناسبة.
يجب منع تكرار مشاكل مثل:

- Performance change يكسر Login.
- Theme/config change يكسر UI غير متعلق.
- Auth change يكسر Lesson flow بدون قصد.
- Refresh ينشئ duplicate lessons.

---

# 43. Testing Before DONE

حسب نوع التغيير:

- Unit.
- Integration.
- API contract.
- E2E critical paths.
- Security.
- Performance.
- Load.
- Browser/device checks.
- Staging verification.

---

# 44. Definition of Done

Feature لا تصبح `✅ DONE` إلا بعد اجتياز ما ينطبق عليها من:

```
⬜ Planning approved
⬜ Scope approved
⬜ UI/UX complete
⬜ Responsive
⬜ Accessibility basics
⬜ Frontend logic complete
⬜ API contract approved
⬜ Backend logic complete
⬜ Database/storage complete
⬜ Authorization
⬜ Validation
⬜ Error handling
⬜ Diagnostics
⬜ Unit tests
⬜ Integration tests
⬜ Critical E2E
⬜ Performance measured
⬜ Size measured
⬜ No duplicate requests
⬜ No hidden writes
⬜ Security check
⬜ Staging check
⬜ Documentation updated
⬜ Pull Request reviewed
⬜ CI green
```

---

# 45. Progress Status System

يتم استخدام الحالات التالية داخل `BUILD_PROGRESS.md`:

```
⬜ NOT STARTED
🟡 IN PROGRESS
✅ DONE
⛔ BLOCKED
```

ملف القواعد لا يستخدم لتتبع التقدم.

---

# 46. Documentation

الوثائق جزء من التنفيذ:

```
docs/
├── PROJECT_MAP.md
├── ARCHITECTURE.md
├── SECURITY.md
├── PERFORMANCE.md
├── OFFLINE_AND_MEDIA.md
├── BUILD_PROGRESS.md
├── RUNBOOKS/
└── ADR/
```

- Rules = كيف نبني.
- Project Map = ما أجزاء النظام.
- Build Progress = ماذا انتهى وماذا تبقى.
- ADR = لماذا اخترنا قرارًا تقنيًا مهمًا.

---

# 47. Progressive Engineering

لا نبني كل Infrastructure المتقدمة من أول يوم.
الترتيب العام:

```
Foundation
→ Thin Vertical Slice
→ Core Product Flows
→ Advanced Media/Offline
→ Remaining Student Features
→ Teacher/Supervisor/Admin expansion
→ Scale/Cost/Security hardening
```

> نبني أصغر جزء كامل وصحيح ثم نتوسع.

---

# 48. نقاط ليست Rules ثابتة بعد

هذه النقاط لا تعتبر قرارات ثابتة حتى تتم مناقشتها واعتمادها صراحة:

- Workbox كتنفيذ نهائي للـService Worker.
- تفاصيل Auth implementation النهائية.
- Signed URL/CDN authorization design النهائي.
- مدة Offline entitlement.
- CDN provider النهائي.
- AI provider النهائي.
- Multiple Active Groups.
- التقسيم التفصيلي لصلاحيات Teacher مقابل Supervisor.
- أي Framework/Infrastructure إضافي غير معتمد.

أي نموذج يمكنه اقتراح بدائل، لكنه لا يحول اقتراحًا إلى Rule بدون موافقة صاحب المشروع.

## 48.1 قرار تأجيل SaaS وMulti-tenancy

تحويل المشروع إلى SaaS فكرة مستقبلية **مؤجلة حاليًا** وليست جزءًا من Scope تنفيذ V2 الأول.

لذلك في النسخة الحالية:

- لا `Tenant` أو`Organization` model.
- لا `TenantId` يضاف لكل Table الآن.
- لا Tenant provisioning.
- لا Organization isolation أوSaaS client billing.
- لا Plans خاصة بالمؤسسات.
- لا Custom domains لكل عميل.
- لا Platform Admin منفصل لإدارة Tenants.

كلمة `Subscriptions` داخل V2 الحالية تعني اشتراك/وصول مستخدمي المنتج وفق Business model الحالي، ولا تعني SaaS organization billing تلقائيًا.

مع ذلك، للحفاظ على إمكانية التحول مستقبلًا:

- لا نضع اسم مدرس أوعميل داخل Business Logic.
- لا ننشئ Fork أوRepository منفصلًا لكل عميل.
- التخصيص المتكرر يتم عبر Settings وConfiguration وRole/Feature availability.
- Integrations تبقى خلف Interfaces واضحة عند وجود حاجة فعلية.
- أي تحول إلى SaaS يحتاج ADR مستقلًا وتحليل Data migration وSecurity isolation وBilling قبل إضافة Multi-tenancy.

> تأجيل SaaS لا يمنع التحول مستقبلًا؛ هو يمنع تحميل أول نسخة بتعقيد غير مطلوب قبل وجود أكثر من عميل فعلي يحتاج نموذج SaaS.

---

# 49. التعلم أثناء البناء

```
Auth → Authentication / Authorization
Lessons → Controllers / Services / DTOs
Database → EF Core / Relations / Migrations
Progress → CRUD / Transactions / Idempotency
Recordings → Uploads / Object Storage
Shadowing → Streaming / Range / Cache
AI → External APIs / Background Jobs
Scaling → Cache / Queues / Load Tests
Security → Validation / Rate Limiting / Secrets
Deployment → Environments / Azure / Monitoring
```

الأسلوب:

```
Problem
→ Concept
→ Simple explanation
→ Implement
→ Test
→ Break deliberately
→ Observe
→ Fix
→ Short note
```

---

# 50. القاعدة الختامية

> \*\*Backend source of truth
>
> - Admin / Teacher / Supervisor / Student as core roles
> - Teacher / Supervisor can be centrally disabled without deleting their data
> - one active Group per Student
> - immutable published versions
> - slot-based progress
> - modular monolith
> - SCSS + Tailwind with explicit styling boundaries
> - stable project tree + confirmed Page shells created once
> - detailed files are created only when their Feature needs them
> - progressive loading
> - explicit offline downloads
> - user-scoped local data
> - idempotent writes/sync
> - measured performance and bandwidth
> - strict change scope
> - vertical-slice Production delivery
> - one Codebase; no customer-specific forks
> - one protected Primary Admin per deployment; ordinary Admins may add Admins but cannot remove the owner
> - feature-by-feature delivery across the relevant roles
> - SaaS and Multi-tenancy postponed by explicit decision
> - no new rule without explicit approval.\*\*

---

# تعليمات للنموذج الذي سيراجع الملف

راجع القواعد نقديًا وابحث عن:

- Security gaps.
- Performance risks.
- Scalability issues.
- Cost/Bandwidth risks.
- Data consistency problems.
- Offline/cache risks.
- Product-rule contradictions.
- Over-engineering.
- Under-engineering.
- Missing failure cases.
- Team/maintainability risks.

لكن:

1. لا تعتبر أي اقتراح Rule جديدة.
2. لا تغير Approved Rule بصمت.
3. أي تغيير مقترح يجب أن يحتوي:
   - المشكلة.
   - السبب.
   - البديل.
   - المزايا.
   - العيوب.
   - تأثيره على المشروع.
4. صنف الملاحظات:
   - Critical
   - High
   - Medium
   - Low
5. افصل بين:
   - Bug/Risk.
   - Improvement.
   - Optional optimization.
   - Future idea.
