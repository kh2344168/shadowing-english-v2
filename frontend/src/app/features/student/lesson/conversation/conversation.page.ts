import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-student-conversation-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './conversation.page.html',
  styleUrl: './conversation.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentConversationPage {}
