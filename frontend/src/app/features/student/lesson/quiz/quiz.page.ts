import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-student-quiz-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './quiz.page.html',
  styleUrl: './quiz.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentQuizPage {}
