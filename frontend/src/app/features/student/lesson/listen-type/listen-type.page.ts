import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-student-listen-type-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './listen-type.page.html',
  styleUrl: './listen-type.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentListenTypePage {}
