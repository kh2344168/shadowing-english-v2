import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-supervisor-weekly-summary-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './weekly-summary.page.html',
  styleUrl: './weekly-summary.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupervisorWeeklySummaryPage {}
