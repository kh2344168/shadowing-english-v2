import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-supervisor-students-page',
  standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './students.page.html',
  styleUrl: './students.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupervisorStudentsPage {}
