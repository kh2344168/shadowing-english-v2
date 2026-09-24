import { Routes } from '@angular/router';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/pages/login/login.page').then(m => m.LoginPage),
  },
  {
    path: 'student/dashboard',
    canActivate: [roleGuard('Student')],
    loadComponent: () => import('./features/student/dashboard/student-dashboard.page').then(m => m.StudentDashboardPage),
  },
  {
    path: 'admin/dashboard',
    canActivate: [roleGuard('Admin')],
    loadComponent: () => import('./features/admin/dashboard/admin-dashboard.page').then(m => m.AdminDashboardPage),
  },
  {
    path: 'admin/accounts',
    canActivate: [roleGuard('Admin')],
    loadComponent: () => import('./features/admin/accounts/admin-accounts.page').then(m => m.AdminAccountsPage),
  },
  {
    path: 'logout',
    loadComponent: () => import('./features/auth/pages/logout/logout.page').then(m => m.LogoutPage),
  },
  { path: '**', redirectTo: 'login' },
];
