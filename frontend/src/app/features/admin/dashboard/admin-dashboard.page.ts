import { ChangeDetectionStrategy, Component } from '@angular/core';
@Component({
 selector: 'app-admin-dashboard-page', standalone: true,
 changeDetection: ChangeDetectionStrategy.OnPush,
 template: `<section class="v1-empty-page" dir="rtl" aria-labelledby="admin-dashboard-title">
   <span class="v1-empty-page__kicker">لوحة الإدارة</span>
   <h1 id="admin-dashboard-title">لوحة التحكم</h1>
   <p role="status">هيكل الواجهة جاهز وفق تصميم V1. إحصائيات الإدارة لم تُربط بعد بالـBackend.</p>
 </section>`,
})
export class AdminDashboardPage {}
