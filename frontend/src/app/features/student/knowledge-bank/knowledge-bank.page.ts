import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-student-knowledge-bank-page',
  standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './knowledge-bank.page.html',
  styleUrl: './knowledge-bank.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentKnowledgeBankPage {}
