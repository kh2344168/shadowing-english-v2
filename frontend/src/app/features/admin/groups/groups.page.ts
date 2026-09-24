import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-admin-groups-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './groups.page.html',
  styleUrl: './groups.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminGroupsPage {}
