import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-student-overview-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './overview.page.html',
  styleUrl: './overview.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentLessonOverviewPage {}
