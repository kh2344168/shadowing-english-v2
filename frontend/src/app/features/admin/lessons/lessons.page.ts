import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-admin-lessons-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './lessons.page.html',
  styleUrl: './lessons.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLessonsPage {}
