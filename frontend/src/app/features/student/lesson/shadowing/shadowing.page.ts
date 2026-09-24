import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FeaturePlaceholderComponent } from '../../../../shared/ui/page-states/feature-placeholder.component';

@Component({
  selector: 'app-student-shadowing-page', standalone: true,
  imports: [FeaturePlaceholderComponent],
  templateUrl: './shadowing.page.html',
  styleUrl: './shadowing.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentShadowingPage {}
