import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-student-vocabulary-page',
  standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './vocabulary.page.html',
  styleUrl: './vocabulary.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentVocabularyPage {}
