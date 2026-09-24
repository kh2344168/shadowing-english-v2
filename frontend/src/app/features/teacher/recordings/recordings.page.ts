import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-teacher-recordings-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './recordings.page.html',
  styleUrl: './recordings.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeacherRecordingsPage {}
