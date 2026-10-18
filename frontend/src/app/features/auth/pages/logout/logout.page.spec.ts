import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { LogoutPage } from './logout.page';

describe('LogoutPage', () => {
  it('signs out immediately and replaces the confirmation route with login', async () => {
    const csrf = vi.fn(() => of(undefined));
    const logout = vi.fn(() => of(undefined));
    await TestBed.configureTestingModule({
      imports: [LogoutPage],
      providers: [provideRouter([]), { provide: AuthService, useValue: { csrf, logout } }],
    }).compileComponents();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    const fixture = TestBed.createComponent(LogoutPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replaceUrl: true }));

    expect(csrf).toHaveBeenCalledOnce();
    expect(logout).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/login', { replaceUrl: true });
    expect(fixture.nativeElement.textContent).not.toContain('Sign out');
  });

  it('offers retry if the logout request fails without sending a duplicate request', async () => {
    const csrf = vi.fn(() => of(undefined));
    const logout = vi.fn().mockReturnValueOnce(throwError(() => new Error('offline'))).mockReturnValue(of(undefined));
    await TestBed.configureTestingModule({
      imports: [LogoutPage],
      providers: [provideRouter([]), { provide: AuthService, useValue: { csrf, logout } }],
    }).compileComponents();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    const fixture = TestBed.createComponent(LogoutPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.error()).toContain('تعذر تسجيل الخروج'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('تعذر تسجيل الخروج');
    expect(navigate).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('button').click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replaceUrl: true }));
    expect(logout).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith('/login', { replaceUrl: true });
  });
});
