import { ChangeDetectionStrategy, Component } from '@angular/core';
@Component({
 selector: 'app-admin-weekly-summaries-page', standalone: true,
 templateUrl: './weekly-summaries.page.html', styleUrl: './weekly-summaries.page.scss',
 changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminWeeklySummariesPage {}
