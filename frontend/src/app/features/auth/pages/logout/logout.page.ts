import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';

@Component({
  selector: 'app-logout-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <main class="min-h-screen bg-slate-50 px-4 py-12 text-slate-900" dir="rtl">
        <section class="mx-auto max-w-md rounded-2xl bg-white p-7 shadow-sm">
          <p role="alert" class="text-sm text-red-700">{{ error() }}</p>
          <button
            type="button"
            class="mt-6 rounded-lg bg-indigo-700 px-4 py-2 text-white disabled:opacity-50"
            [disabled]="loading()"
            (click)="signOut()"
          >
            إعادة المحاولة
          </button>
        </section>
      </main>
    }
  `,
})
export class LogoutPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly loading = signal(false);
  readonly error = signal('');

  ngOnInit(): void {
    void this.signOut();
  }

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
      await this.router.navigateByUrl('/login', { replaceUrl: true });
    } catch {
      this.error.set('تعذر تسجيل الخروج. حاول مرة أخرى.');
      console.warn('[Auth.UI.Logout.Failed]', { durationMs: Date.now() - started });
    } finally {
      this.loading.set(false);
    }
  }
}
