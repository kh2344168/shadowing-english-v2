import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-supervisor-teachers-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './teachers.page.html',
  styleUrl: './teachers.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupervisorTeachersPage {}
