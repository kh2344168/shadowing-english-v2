# Day 2 — تصميم V1 الحقيقي: التطبيق والرجوع الآمن

هذه **بديلة** للـPatch القديمة وليست إضافة فوقها. لا تطبقها قبل الرجوع إلى Day 1. لا توجد Migration أوتعديلات Backend/DB.

## 1) قبل أي تغيير

من جذر المشروع على جهازك:

```powershell
git status --short --branch
git log -3 --oneline --decorate
git branch --list
```

تأكد أن `main` يشير إلى Commit `Day 1 - Stable Foundation` وأن النسخة الاحتياطية `shadowing-v2-day1-finish` محفوظة. لو كان Patch القديم قد حُفظ في Commit على `main`، **لا** تستخدم `git reset --hard` أو `git clean -fd`؛ ارجع عبر Day 1 commit/النسخة الاحتياطية بعد مراجعة الحالة.

إذا كانت تغييرات التعديل الأول غير محفوظة في Commit وتريد الاحتفاظ بها:

```powershell
git stash push --include-untracked -m "Day2 rejected generic UI - saved for reference"
```

لو كانت Branch الحالية ليست `main`، وبعد التأكد من نظافة الـWorking Tree:

```powershell
git switch main
```

## 2) بدء فرع نظيف من Day 1

```powershell
git switch -c feature/day2-v1-design-port
git status
```

يجب أن يظهر `working tree clean`. لا تنشئ الفرع إذا كان `main` يحتوي Patch المرفوضة؛ استخدم Commit يوم1 كأساس أولًا.

## 3) تطبيق Patch

فك ضغط ZIP التصحيحية، وانسخ مجلدات `frontend/` و`docs/` و`tests/` إلى جذر مشروع V2. لا تستبدل إعدادات محلية خاصة. راجع أي تعارض في ملفات تعدلت بعد Day 1 قبل الاستبدال. الملف `APPLY_AND_ROLLBACK_AR.md` للتعليمات فقط.

```powershell
git status --short
npm run build:frontend
node --test tests/day2-shell-contract.test.cjs tests/day2-v1-layout-parity.test.cjs
npm run dev:api
```

شغّل `npm run dev:frontend` في Terminal آخر، وافتح `http://localhost:4200`.

## 4) لو التصميم غير مناسب

لو لم تحفظ التعديلات في Commit، احتفظ بها أولًا عبر `git stash push --include-untracked` بدل الحذف؛ ثم عد إلى `main`:

```powershell
git stash push --include-untracked -m "Day2 V1 visual review"
git switch main
```

لو التعديل محفوظ في Commit داخل Branch الميزة، التحويل إلى `main` يعرض نسخة Day 1 عندما يكون الـWorking Tree نظيفًا. Git لا يرجع قاعدة SQL تلقائيًا، لكن هذا الـPatch لا يغيرها.

## 5) ماذا تغير بصريًا؟

Admin: V1 original right 260px white sidebar and 64px topbar. Student: original horizontal topbar, mobile bottom nav. Teacher: white right 270px sidebar plus mobile bottom bar. Supervisor: dark green 270px sidebar. Actual V1 SCSS/template structures ported into V2, with compatible V2 routes and no V1 auth/data service port.

**حدود المطابقة:** استبدلت أيقونات FontAwesome في Student/Teacher/Supervisor بـMaterial Symbols للحفاظ على عدم إضافة Runtime package جديدة، ولذلك الأيقونات ليست pixel-identical. محتوى الصفحات الداخلية ما زال Page Shells وليس نسخًا كاملة من شاشة V1 بكل بياناتها. الاختبارات البنيوية ليست بديلًا لعرضها في Browser والتأكد من Responsive.
