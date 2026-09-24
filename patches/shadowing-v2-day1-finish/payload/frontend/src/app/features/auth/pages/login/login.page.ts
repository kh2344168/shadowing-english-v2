import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="min-h-screen bg-slate-50 px-4 py-12 text-slate-900">
      <section class="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <p class="text-sm font-semibold text-indigo-700">SHADOWING ENGLISH / V2</p>
        <h1 class="mt-3 text-2xl font-bold">Sign in</h1>
        <p class="mt-2 text-sm text-slate-600">Use your assigned Student or Admin account.</p>
        <form class="mt-6 grid gap-4" (ngSubmit)="submit()">
          <label class="grid gap-1 text-sm font-medium" for="email">Email</label>
          <input id="email" name="email" type="email" autocomplete="username" required
            class="rounded-lg border border-slate-300 px-3 py-2" [(ngModel)]="email" [disabled]="loading()" />
          <label class="grid gap-1 text-sm font-medium" for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required
            class="rounded-lg border border-slate-300 px-3 py-2" [(ngModel)]="password" [disabled]="loading()" />
          @if (error()) { <p role="alert" class="text-sm text-red-700">{{ error() }}</p> }
          <button type="submit" class="rounded-lg bg-indigo-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
            [disabled]="loading()">{{ loading() ? 'Signing in...' : 'Sign in' }}</button>
        </form>
      </section>
    </main>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly loading = signal(false);
  readonly error = signal('');
  email = '';
  password = '';

  async submit(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    const started = Date.now();
    console.info('[Auth.UI.Login.Start]'); // Never log credentials or CSRF tokens.
    try {
      await firstValueFrom(this.auth.csrf());
      const session = await firstValueFrom(this.auth.login(this.email.trim(), this.password));
      this.password = '';
      console.info('[Auth.UI.Login.Success]', { userId: session.userId, durationMs: Date.now() - started });
      if (session.roles.includes('Admin')) await this.router.navigateByUrl('/admin/dashboard');
      else if (session.roles.includes('Student')) await this.router.navigateByUrl('/student/dashboard');
      else this.error.set('This account does not have an enabled role.');
    } catch {
      this.password = '';
      this.error.set('Sign-in failed. Check your credentials and try again.');
      console.warn('[Auth.UI.Login.Failed]', { durationMs: Date.now() - started });
    } finally {
      this.loading.set(false);
    }
  }
}
