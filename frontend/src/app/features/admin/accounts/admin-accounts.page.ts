import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminAccount, AdminAccountsApi } from './admin-accounts.api';

@Component({
  selector: 'app-admin-accounts-page',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-accounts.page.html',
  styleUrl: './admin-accounts.page.scss',
})
export class AdminAccountsPage implements OnInit {
  private readonly api = inject(AdminAccountsApi);
  private readonly auth = inject(AuthService);
  readonly isPrimaryAdmin = signal(false);
  readonly admins = signal<AdminAccount[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly removing = signal<string | null>(null);
  readonly confirmRemoveId = signal<string | null>(null);
  readonly error = signal('');
  readonly success = signal('');
  email = '';
  password = '';

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const started = Date.now();
    this.loading.set(true);
    this.error.set('');
    console.info('[Admin.Accounts.UI.Load.Start]');
    try {
      const access = await firstValueFrom(this.api.me());
      this.isPrimaryAdmin.set(access.isPrimaryAdmin);
      this.admins.set(await firstValueFrom(this.api.list()));
      console.info('[Admin.Accounts.UI.Load.Success]', {
        isPrimaryAdmin: access.isPrimaryAdmin,
        count: this.admins().length,
        durationMs: Date.now() - started,
      });
    } catch (e) {
      this.error.set(this.describeError(e));
      console.warn('[Admin.Accounts.UI.Load.Failed]', { durationMs: Date.now() - started });
    } finally {
      this.loading.set(false);
    }
  }

  async create(): Promise<void> {
    if (this.saving() || this.loading()) return;
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    const started = Date.now();
    console.info('[Admin.Accounts.UI.Create.Start]'); // No email/password in logs.
    try {
      await firstValueFrom(this.auth.csrf());
      const created = await firstValueFrom(this.api.create(this.email.trim(), this.password));
      this.email = '';
      this.success.set('تم إنشاء حساب الأدمن. شارك بيانات الدخول معه بطريقة آمنة.');
      try {
        this.admins.set(await firstValueFrom(this.api.list()));
      } catch {
        this.success.set('تم إنشاء حساب الأدمن، لكن تعذر تحديث القائمة. افتح الصفحة مرة أخرى.');
      }
      console.info('[Admin.Accounts.UI.Create.Success]', {
        id: created.id,
        durationMs: Date.now() - started,
      });
    } catch (e) {
      this.error.set(this.describeError(e));
      console.warn('[Admin.Accounts.UI.Create.Failed]', { durationMs: Date.now() - started });
    } finally {
      this.password = '';
      this.saving.set(false);
    }
  }

  async remove(id: string): Promise<void> {
    if (!this.isPrimaryAdmin() || this.removing() || this.confirmRemoveId() !== id) return;
    this.error.set('');
    this.success.set('');
    this.removing.set(id);
    const started = Date.now();
    console.info('[Admin.Accounts.UI.Remove.Start]', { id });
    try {
      await firstValueFrom(this.auth.csrf());
      await firstValueFrom(this.api.remove(id));
      this.confirmRemoveId.set(null);
      this.admins.update((items) => items.filter((item) => item.id !== id));
      this.success.set('تم سحب صلاحية Admin. حساب المستخدم وبياناته لم يتم حذفهما.');
      console.info('[Admin.Accounts.UI.Remove.Success]', { id, durationMs: Date.now() - started });
    } catch (e) {
      this.error.set(this.describeError(e));
      console.warn('[Admin.Accounts.UI.Remove.Failed]', { id, durationMs: Date.now() - started });
    } finally {
      this.removing.set(null);
    }
  }

  private describeError(e: unknown): string {
    if (e instanceof HttpErrorResponse) {
      if (e.error?.error === 'primary_admin_not_configured')
        return 'حساب خالد الرئيسي لم يتم ربطه بعد. راجع دليل إعداد Primary Admin.';
      if (e.error?.error === 'admin_email_exists') return 'البريد الإلكتروني مسجل بالفعل.';
      if (e.error?.error === 'primary_admin_protected')
        return 'لا يمكن إزالة صلاحيات الأدمن الرئيسي.';
      if (e.error?.error === 'invalid_admin_account')
        return 'راجع البريد وكلمة المرور: 10 أحرف على الأقل، وحروف كبيرة وصغيرة ورقم ورمز.';
      if (e.status === 400) return 'البيانات غير صحيحة أو جلسة الحماية انتهت. حاول مرة أخرى.';
      if (e.status === 401 || e.status === 403) return 'ليس لديك صلاحية لتنفيذ هذه العملية.';
      if (e.status === 429) return 'عدد محاولات الإضافة كبير. حاول لاحقًا.';
    }
    return 'تعذر تنفيذ العملية. تحقق من اتصال الـBackend وحاول مرة أخرى.';
  }
}
