import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';

@Component({
  selector: 'app-logout-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="min-h-screen bg-slate-50 px-4 py-12 text-slate-900">
      <section class="mx-auto max-w-md rounded-2xl bg-white p-7 shadow-sm">
        <h1 class="text-2xl font-bold">Sign out</h1>
        <p class="mt-2 text-slate-600">End your current session?</p>
        @if (error()) { <p role="alert" class="mt-3 text-sm text-red-700">{{ error() }}</p> }
        <button type="button" class="mt-6 rounded-lg bg-indigo-700 px-4 py-2 text-white disabled:opacity-50"
          [disabled]="loading()" (click)="signOut()">{{ loading() ? 'Signing out...' : 'Sign out' }}</button>
        <a href="/" class="ml-4 text-sm text-indigo-700">Back</a>
      </section>
    </main>
  `,
})
export class LogoutPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly loading = signal(false);
  readonly error = signal('');

  async signOut(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    const started = Date.now();
    console.info('[Auth.UI.Logout.Start]');
    try {
      await firstValueFrom(this.auth.csrf());
      await firstValueFrom(this.auth.logout());
      console.info('[Auth.UI.Logout.Success]', { durationMs: Date.now() - started });
      await this.router.navigateByUrl('/login');
    } catch {
      this.error.set('Could not sign out. Please try again.');
      console.warn('[Auth.UI.Logout.Failed]', { durationMs: Date.now() - started });
    } finally {
      this.loading.set(false);
    }
  }
}
