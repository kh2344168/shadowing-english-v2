import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/student/dashboard/student-dashboard.page').then(
        (m) => m.StudentDashboardPage,
      ),
  },
  { path: '**', redirectTo: '' },
];
