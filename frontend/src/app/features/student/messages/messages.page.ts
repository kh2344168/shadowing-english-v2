import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-student-messages-page',
  standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './messages.page.html',
  styleUrl: './messages.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentMessagesPage {}
