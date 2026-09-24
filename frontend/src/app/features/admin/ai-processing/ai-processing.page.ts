import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-admin-ai-processing-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './ai-processing.page.html',
  styleUrl: './ai-processing.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAIProcessingPage {}
