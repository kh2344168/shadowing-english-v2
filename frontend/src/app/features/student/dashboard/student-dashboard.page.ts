import { ChangeDetectionStrategy, Component } from '@angular/core';
@Component({
 selector: 'app-student-dashboard-page', standalone: true,
 changeDetection: ChangeDetectionStrategy.OnPush,
 templateUrl: './student-dashboard.page.html',
 styleUrl: './student-dashboard.page.scss',
})
export class StudentDashboardPage {}
