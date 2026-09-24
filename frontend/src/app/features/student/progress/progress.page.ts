import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-student-progress-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './progress.page.html',
  styleUrl: './progress.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentProgressPage {}
