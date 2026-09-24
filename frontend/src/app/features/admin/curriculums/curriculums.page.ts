import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-admin-curriculums-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './curriculums.page.html',
  styleUrl: './curriculums.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCurriculumsPage {}
