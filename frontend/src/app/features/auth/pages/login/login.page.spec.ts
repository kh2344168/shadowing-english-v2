import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { LoginPage } from './login.page';

describe('LoginPage', () => {
  it.each([
    ['Admin', '/admin/dashboard'],
    ['Student', '/student/dashboard'],
  ])('replaces login in the browser history after a %s signs in', async (role, path) => {
    const csrf = vi.fn(() => of(undefined));
    const login = vi.fn(() => of({ authenticated: true, userId: 'user-1', roles: [role] }));
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), { provide: AuthService, useValue: { csrf, login } }],
    }).compileComponents();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const page = TestBed.createComponent(LoginPage).componentInstance;
    page.email = 'student@example.test';
    page.password = 'example-password';

    await page.submit();

    expect(csrf).toHaveBeenCalledOnce();
    expect(login).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(path, { replaceUrl: true });
    expect(page.password).toBe('');
  });
});
