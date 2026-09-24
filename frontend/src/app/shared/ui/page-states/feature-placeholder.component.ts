import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-feature-placeholder', standalone: true,
  template: `
    <section class="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9"
      [attr.aria-labelledby]="headingId" dir="rtl">
      <p class="text-xs font-bold tracking-wide text-emerald-800">SHADOWING ENGLISH / V2</p>
      <h1 [id]="headingId" class="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">{{ title }}</h1>
      <p class="mt-3 max-w-2xl text-sm leading-7 text-slate-600">{{ description }}</p>
      <div class="mt-7 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="status">
        هذه الصفحة هيكل جاهز للتطوير، وليست وظيفة مكتملة. لا توجد بيانات أو عمليات تجريبية.
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeaturePlaceholderComponent {
  @Input({ required: true }) title = '';
  @Input() description = 'سيتم تنفيذ هذه الوظيفة وربطها بالـBackend عند بدء الـFeature الخاصة بها.';
  readonly headingId = 'feature-shell-title';
}
