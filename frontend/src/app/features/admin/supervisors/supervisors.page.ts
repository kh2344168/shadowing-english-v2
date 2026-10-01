import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-admin-supervisors-page',
  standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './supervisors.page.html',
  styleUrl: './supervisors.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSupervisorsPage {}
