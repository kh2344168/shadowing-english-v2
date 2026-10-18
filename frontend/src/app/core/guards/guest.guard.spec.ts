import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RedirectCommand,
  Router,
  RouterStateSnapshot,
  provideRouter,
} from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';
import { AuthService, AuthSession } from '../auth/auth.service';
import { guestGuard } from './guest.guard';

describe('guestGuard', () => {
  async function check(session: AuthSession): Promise<boolean | RedirectCommand> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { session: () => of(session) } },
      ],
    });
    const result = TestBed.runInInjectionContext(() =>
      guestGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as Observable<boolean | RedirectCommand>;
    return firstValueFrom(result);
  }

  it('lets visitors see the login page', async () => {
    expect(await check({ authenticated: false, userId: null, roles: [] })).toBe(true);
  });

  it.each([
    ['Admin', '/admin/dashboard'],
    ['Student', '/student/dashboard'],
  ])('takes a signed-in %s back to their dashboard without retaining login in history', async (role, path) => {
    const result = await check({ authenticated: true, userId: 'user-1', roles: [role] });
    expect(result).toBeInstanceOf(RedirectCommand);
    const redirect = result as RedirectCommand;
    expect(redirect.redirectTo.toString()).toBe(TestBed.inject(Router).parseUrl(path).toString());
    expect(redirect.navigationBehaviorOptions?.replaceUrl).toBe(true);
  });
});
