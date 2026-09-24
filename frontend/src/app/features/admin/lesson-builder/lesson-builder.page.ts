import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-admin-lesson-builder-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './lesson-builder.page.html',
  styleUrl: './lesson-builder.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLessonBuilderPage {}
