import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-teacher-feedback-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './feedback.page.html',
  styleUrl: './feedback.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeacherFeedbackPage {}
