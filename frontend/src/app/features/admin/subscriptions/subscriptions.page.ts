import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-admin-subscriptions-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './subscriptions.page.html',
  styleUrl: './subscriptions.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSubscriptionsPage {}
