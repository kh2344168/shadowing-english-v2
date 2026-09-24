import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-admin-dashboard-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="min-h-screen bg-slate-50 px-4 py-12 text-slate-900">
      <section class="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <p class="text-sm font-semibold text-indigo-700">SHADOWING ENGLISH / V2</p>
        <h1 class="mt-3 text-3xl font-bold">Admin Dashboard — Foundation</h1>
        <p class="mt-3 text-slate-600">Admin access is connected. Admin features are not implemented yet.</p>
        <a href="/admin/accounts" class="mt-6 mr-3 inline-block rounded-lg border border-indigo-700 px-4 py-2 text-indigo-700">إدارة الأدمنز</a>
        <a href="/logout" class="mt-6 inline-block rounded-lg bg-indigo-700 px-4 py-2 text-white">Sign out</a>
      </section>
    </main>
  `,
})
export class AdminDashboardPage {}
