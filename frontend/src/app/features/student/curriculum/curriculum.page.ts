import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-student-curriculum-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './curriculum.page.html',
  styleUrl: './curriculum.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentCurriculumPage {}
