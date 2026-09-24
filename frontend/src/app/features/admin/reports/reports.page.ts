import { ChangeDetectionStrategy, Component } from '@angular/core';
@Component({
 selector: 'app-admin-reports-page', standalone: true,
 templateUrl: './reports.page.html', styleUrl: './reports.page.scss',
 changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminReportsPage {}
