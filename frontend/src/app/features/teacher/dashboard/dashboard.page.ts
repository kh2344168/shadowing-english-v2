import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-teacher-dashboard-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeacherDashboardPage {}
