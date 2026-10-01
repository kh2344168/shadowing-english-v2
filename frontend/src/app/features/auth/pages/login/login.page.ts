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
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly loading = signal(false);
  readonly error = signal('');
  showPassword = false;
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
      console.info('[Auth.UI.Login.Success]', {
        userId: session.userId,
        durationMs: Date.now() - started,
      });
      if (session.roles.includes('Admin')) await this.router.navigateByUrl('/admin/dashboard');
      else if (session.roles.includes('Student'))
        await this.router.navigateByUrl('/student/dashboard');
      else this.error.set('حسابك ليس له دور مُفعّل حاليًا. تواصل مع المسؤول.');
    } catch {
      this.password = '';
      this.error.set('تعذر تسجيل الدخول. راجع بيانات الحساب وحاول مرة أخرى.');
      console.warn('[Auth.UI.Login.Failed]', { durationMs: Date.now() - started });
    } finally {
      this.loading.set(false);
    }
  }
}
