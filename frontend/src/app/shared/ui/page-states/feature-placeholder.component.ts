import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-feature-placeholder',
  standalone: true,
  template: `
    <section class="v2-placeholder-panel mx-auto" [attr.aria-labelledby]="headingId" dir="rtl">
      <span class="v2-placeholder-panel__kicker">شادوينج</span>
      <h1 [id]="headingId">{{ title }}</h1>
      <p>{{ description }}</p>
      <div
        class="mt-6 rounded-xl border border-[#BFE7E3] bg-[#EFFBF8] px-4 py-3 text-sm font-semibold text-[#005137]"
        role="status"
      >
        هذا القسم غير متاح حاليًا.
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeaturePlaceholderComponent {
  @Input({ required: true }) title = '';
  @Input() description = 'ستظهر محتويات هذه الصفحة عند إتاحتها.';
  readonly headingId = 'feature-shell-title';
}
